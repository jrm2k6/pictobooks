import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";
import { useBookPages } from "./use-book-pages.js";
import {
  canContinueReview,
  includedPageSlots,
} from "./reconcile-page-slots.js";
import { sha256Hex } from "../sha256.js";

const CAP = 3;

/** Plain async function, no React — independently testable (Step 2). */
export async function replacePhotoSequence({
  api,
  bookId,
  pageId,
  file,
  sha256Hex: hashFn,
}) {
  const sha256 = await hashFn(file);
  const { runId, upload } = await api.createPhotoReplacement(bookId, pageId, {
    contentType: file.type,
    byteSize: file.size,
    sha256,
  });
  await api.uploadPhoto(upload.uploadUrl, upload.requiredHeaders, file);
  await api.startBookRun(bookId, runId);
}

export function usePageReview(bookId, primaryRunId) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { slots, regenerationsUsed, replacementsUsed, isLoading, isError } =
    useBookPages(bookId, primaryRunId);

  const queryKey = ["book-pages", bookId, primaryRunId];
  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const approveCandidate = ({ pageId, candidateId, originalPageId }) =>
    api.reviewCandidate(bookId, pageId, {
      candidateId,
      decision: "approved",
      originalPageId,
    });

  const keepMutation = useMutation({
    mutationFn: approveCandidate,
    onSettled: invalidate,
  });

  const readyApprovals = readyApprovalTargets(slots);

  const bulkApproval = useMutation({
    mutationKey: ["bulk-approve-pages", bookId, primaryRunId],
    mutationFn: async selection => {
      await queryClient.refetchQueries(
        { queryKey, exact: true },
        { throwOnError: true }
      );
      const latest = queryClient.getQueryData(queryKey);
      const selectedBySlot = new Map(
        selection.map(target => [target.originalPageId, target])
      );
      const targets = readyApprovalTargets(latest?.slots ?? []).filter(target =>
        sameApprovalTarget(target, selectedBySlot.get(target.originalPageId))
      );
      const results = await Promise.allSettled(targets.map(approveCandidate));
      const failedPageIds = targets
        .filter((_, index) => results[index].status === "rejected")
        .map(target => target.pageId);
      return {
        approved: targets.length - failedPageIds.length,
        total: targets.length,
        failedPageIds,
        skipped: selection.length - targets.length,
      };
    },
    onSettled: invalidate,
  });

  const tryAgainMutation = useMutation({
    mutationFn: async pageId => {
      const slot = slots.find(s => s.currentPageId === pageId);
      if (slot.currentPage.state === "rejected") {
        // The paired reviewCandidate(rejected) call already went through on a
        // previous attempt; reviewCandidate is one-way, so only retry the
        // regeneratePage half.
        return api.regeneratePage(bookId, pageId);
      }
      // Only reject-then-regenerate when the page was actually flagged by QA
      // and hasn't been rejected yet; a plain "approved" page or an already-
      // rejected page (regenerate-only retry) skips the reviewCandidate call.
      if (slot.currentPage.state === "needs_human_review") {
        const candidateId = pickBestCandidate(slot.currentPage.candidates);
        await api.reviewCandidate(bookId, pageId, {
          candidateId,
          decision: "rejected",
        });
      }
      return api.regeneratePage(bookId, pageId);
    },
    onSettled: invalidate,
  });

  const replaceMutation = useMutation({
    mutationFn: ({ pageId, file }) =>
      replacePhotoSequence({ api, bookId, pageId, file, sha256Hex }),
    onSettled: invalidate,
  });

  const inclusionMutation = useMutation({
    mutationFn: ({ originalPageId, included }) =>
      api.setPageInclusion(bookId, primaryRunId, originalPageId, included),
    onSettled: invalidate,
  });

  const canContinue = canContinueReview(slots);
  const readyPageIds = new Set(readyApprovals.map(target => target.pageId));
  const unresolvedBulkFailures =
    bulkApproval.data?.failedPageIds.filter(pageId => readyPageIds.has(pageId))
      .length ?? 0;

  return {
    slots,
    isLoading,
    isError,
    regenerationsUsed,
    regenerationsRemaining: Math.max(0, CAP - regenerationsUsed),
    replacementsUsed,
    replacementsRemaining: Math.max(0, CAP - replacementsUsed),
    canContinue,
    readyApprovals,
    isBulkApproving: bulkApproval.isPending,
    bulkApprovalResult: bulkApproval.data,
    isBulkApprovalError: bulkApproval.isError,
    unresolvedBulkFailures,
    approveSelectedPages: selection => bulkApproval.mutateAsync(selection),
    setPageInclusion: (originalPageId, included) =>
      inclusionMutation.mutateAsync({ originalPageId, included }),
    keepPage: (pageId, candidateId) =>
      keepMutation.mutateAsync({ pageId, candidateId }),
    tryAgain: pageId => tryAgainMutation.mutateAsync(pageId),
    replacePhoto: (pageId, file) =>
      replaceMutation.mutateAsync({ pageId, file }),
  };
}

function readyApprovalTargets(slots) {
  return includedPageSlots(slots).flatMap(slot => {
    const page = slot.currentPage;
    const candidate = displayCandidate(page);
    if (!canApprovePage(page, candidate) || page.approvalSource === "human") {
      return [];
    }
    return [
      {
        originalPageId: slot.originalPageId,
        pageId: slot.currentPageId,
        candidateId: candidate.candidateId,
      },
    ];
  });
}

export function sameApprovalTarget(target, selection) {
  return (
    target.pageId === selection?.pageId &&
    target.candidateId === selection?.candidateId
  );
}

/** Highest styleQa.score wins — matches the server's own best-candidate
 * selection as closely as the API response allows (ordinal isn't exposed). */
function pickBestCandidate(candidates) {
  return candidates.reduce((best, candidate) =>
    (candidate.styleQa?.score ?? -Infinity) > (best.styleQa?.score ?? -Infinity)
      ? candidate
      : best
  ).candidateId;
}

/** Show the exact approved candidate when present, otherwise the best-scoring candidate. */
export function displayCandidate(page) {
  if (!page.candidates?.length) return null;
  const candidateId =
    page.approvedCandidateId ?? pickBestCandidate(page.candidates);
  return (
    page.candidates.find(candidate => candidate.candidateId === candidateId) ??
    null
  );
}

export function canApprovePage(page, candidate) {
  return (
    Boolean(candidate) &&
    (page.state === "approved" || page.state === "needs_human_review")
  );
}
