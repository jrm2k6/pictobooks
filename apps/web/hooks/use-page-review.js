import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";
import { useBookPages } from "./use-book-pages.js";
import { canContinueReview } from "./reconcile-page-slots.js";
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
  const { slots, regenerationsUsed, replacementsUsed, isLoading } =
    useBookPages(bookId, primaryRunId);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["book-pages", bookId, primaryRunId],
    });

  const keepMutation = useMutation({
    mutationFn: ({ pageId, candidateId }) =>
      api.reviewCandidate(bookId, pageId, {
        candidateId,
        decision: "approved",
      }),
    onSuccess: invalidate,
  });

  const tryAgainMutation = useMutation({
    mutationFn: async pageId => {
      const slot = slots.find(s => s.currentPageId === pageId);
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
    onSuccess: invalidate,
  });

  const replaceMutation = useMutation({
    mutationFn: ({ pageId, file }) =>
      replacePhotoSequence({ api, bookId, pageId, file, sha256Hex }),
    onSuccess: invalidate,
  });

  const canContinue = canContinueReview(slots);

  return {
    slots,
    isLoading,
    regenerationsUsed,
    regenerationsRemaining: Math.max(0, CAP - regenerationsUsed),
    replacementsUsed,
    replacementsRemaining: Math.max(0, CAP - replacementsUsed),
    canContinue,
    keepPage: (pageId, candidateId) =>
      keepMutation.mutateAsync({ pageId, candidateId }),
    tryAgain: pageId => tryAgainMutation.mutateAsync(pageId),
    replacePhoto: (pageId, file) =>
      replaceMutation.mutateAsync({ pageId, file }),
  };
}

/** Highest styleQa.score wins — matches the server's own best-candidate
 * selection as closely as the API response allows (ordinal isn't exposed). */
function pickBestCandidate(candidates) {
  return candidates.reduce((best, candidate) =>
    (candidate.styleQa.score ?? -Infinity) > (best.styleQa.score ?? -Infinity)
      ? candidate
      : best
  ).candidateId;
}
