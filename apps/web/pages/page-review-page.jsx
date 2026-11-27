import React, { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AppShell } from "../app-shell.jsx";
import {
  canApprovePage,
  displayCandidate,
  sameApprovalTarget,
  usePageReview,
} from "../hooks/use-page-review.js";
import { includedPageSlots } from "../hooks/reconcile-page-slots.js";
import { useArtifactAccess } from "../hooks/use-artifact-access.js";
import styles from "./page-review-page.module.css";

// TODO: replace with the real support destination once one exists.
const SUPPORT_LINK = "mailto:support@pictobook.com";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

// Mirrors use-book-pages.js's own ACTIVE_PAGE_STATES set — duplicated
// locally rather than imported, same pattern processing-page.jsx already
// uses for its own local TERMINAL_COMPLETE/TERMINAL_FAILED sets, since this
// is a display-only concern for this screen.
const ACTIVE_PAGE_STATES = new Set([
  "created",
  "analyzing",
  "generating",
  "print_qa",
  "style_qa",
  "repairing",
]);

/**
 * Step 5 (post-creation) — Review each page.
 * Grid-hub + inline detail: the grid is the landing view, opening a card
 * drills into a focused detail panel for that page's decision. Not wrapped
 * in WizardShell — review happens after the book is created, not as a
 * step of the intake wizard.
 */
export function PageReviewPage() {
  const { bookId, runId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const review = usePageReview(bookId, runId);
  const [selectedOriginalPageId, setSelectedOriginalPageId] = useState(null);
  const [selection, setSelection] = useState(null);
  const readyBySlot = new Map(
    review.readyApprovals.map(target => [target.originalPageId, target])
  );
  const selectedTargets =
    selection === null
      ? []
      : review.readyApprovals.filter(target =>
          sameApprovalTarget(target, selection.get(target.originalPageId))
        );

  const selectedSlot =
    review.slots.find(s => s.originalPageId === selectedOriginalPageId) ?? null;

  const includedSlots = includedPageSlots(review.slots);
  const includedCount = includedSlots.length;
  const remaining = includedSlots.filter(
    ({ currentPage }) =>
      currentPage.state !== "approved" || currentPage.approvalSource !== "human"
  ).length;
  const continueReason = review.isBulkApproving
    ? "Wait for page approvals to finish."
    : review.canContinue
      ? null
      : includedCount === 0
        ? "Keep at least one page to continue."
        : `Approve or remove the remaining ${remaining} ${remaining === 1 ? "page" : "pages"} to continue.`;

  function toggleSelection(target) {
    setSelection(previous => {
      if (!previous) return previous;
      const next = new Map(previous);
      if (sameApprovalTarget(target, next.get(target.originalPageId))) {
        next.delete(target.originalPageId);
      } else {
        next.set(target.originalPageId, target);
      }
      return next;
    });
  }

  async function approveSelection() {
    if (review.isBulkApproving || selectedTargets.length === 0) return;
    try {
      const result = await review.approveSelectedPages(selectedTargets);
      setSelection(
        result.failedPageIds.length
          ? new Map(
              selectedTargets
                .filter(target => result.failedPageIds.includes(target.pageId))
                .map(target => [target.originalPageId, target])
            )
          : null
      );
    } catch {
      // Keep the selection so the user can retry after the preflight error.
    }
  }

  function handleContinue() {
    navigate({ to: "/books/new/preview", search: { bookId, runId } });
  }

  return (
    <AppShell>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Review your pages</span>
        <h1 className={styles.heading}>
          {selectedSlot
            ? "Review this page"
            : "Check each page before you continue."}
        </h1>
        {!selectedSlot && (
          <p className={styles.lead}>
            Approve the pages you want to keep, or remove them from the book.
            You can add removed pages back any time during review.
          </p>
        )}
      </header>

      {review.regenerationsRemaining === 0 && (
        <div className={styles.capBanner} role="status">
          You've used all 3 free revisions for this book — our team can help
          with anything that still needs a change.
        </div>
      )}
      {review.replacementsRemaining === 0 && (
        <div className={styles.capBanner} role="status">
          You've used all 3 photo replacements for this book — our team can help
          if a photo still needs to change.
        </div>
      )}

      {review.isError && review.slots.length > 0 && (
        <p className={styles.capBanner} role="alert">
          Couldn’t refresh your pages. Showing the last loaded version.
        </p>
      )}

      {review.isLoading ? (
        <p className={styles.loading}>Loading your pages…</p>
      ) : review.isError && review.slots.length === 0 ? (
        <p className={styles.errorMsg} role="alert">
          Something went wrong loading this book. Try reloading the page.
        </p>
      ) : selectedSlot ? (
        <PageDetail
          slot={selectedSlot}
          review={review}
          onBack={() => setSelectedOriginalPageId(null)}
        />
      ) : (
        <>
          <BulkApprovalAction
            review={review}
            selecting={selection !== null}
            selectedCount={selectedTargets.length}
            onStart={() => setSelection(new Map())}
            onCancel={() => setSelection(null)}
            onApprove={approveSelection}
          />
          <div
            className={styles.grid}
            aria-label={selection ? "Select pages to approve" : "Book pages"}
          >
            {review.slots.map((slot, index) => {
              const target = readyBySlot.get(slot.originalPageId);
              return (
                <PageCard
                  key={slot.originalPageId}
                  slot={slot}
                  pageNumber={index + 1}
                  selecting={selection !== null}
                  selected={Boolean(
                    target &&
                      sameApprovalTarget(
                        target,
                        selection?.get(slot.originalPageId)
                      )
                  )}
                  disabled={
                    review.isBulkApproving || Boolean(selection && !target)
                  }
                  onOpen={() => {
                    if (selection) {
                      if (target) toggleSelection(target);
                    } else {
                      setSelectedOriginalPageId(slot.originalPageId);
                    }
                  }}
                />
              );
            })}
          </div>

          <div className={styles.footer}>
            <span className={styles.footerNote}>
              {includedCount} {includedCount === 1 ? "page" : "pages"} in the
              book.
              {includedCount > 0
                ? " Approve the included pages to continue."
                : " Add a page to continue."}
            </span>
            <ContinueAction
              reason={continueReason}
              onContinue={handleContinue}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}

function BulkApprovalAction({
  review,
  selecting,
  selectedCount,
  onStart,
  onCancel,
  onApprove,
}) {
  const {
    readyApprovals,
    isBulkApproving,
    bulkApprovalResult,
    isBulkApprovalError,
    unresolvedBulkFailures,
  } = review;
  const skipped = bulkApprovalResult?.skipped ?? 0;
  const approved = bulkApprovalResult?.approved ?? 0;
  const completed =
    bulkApprovalResult && bulkApprovalResult.failedPageIds.length === 0;

  return (
    <div className={styles.bulkApproval}>
      {selecting ? (
        <>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={isBulkApproving || selectedCount === 0}
            onClick={onApprove}
          >
            {isBulkApproving
              ? "Approving pages…"
              : `Approve selected (${selectedCount})`}
          </button>
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={isBulkApproving}
            onClick={onCancel}
          >
            Cancel selection
          </button>
        </>
      ) : (
        readyApprovals.length > 0 && (
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onStart}
          >
            Select pages to approve
          </button>
        )
      )}
      <p className={styles.bulkMessage} role="status">
        {isBulkApproving
          ? "Checking and approving selected pages."
          : completed && approved > 0
            ? `${approved} ${approved === 1 ? "page" : "pages"} approved.`
            : ""}
      </p>
      {!isBulkApproving && skipped > 0 && (
        <p className={styles.bulkMessage} role="status">
          {skipped === 1
            ? "One selected page was skipped because it changed."
            : `${skipped} selected pages were skipped because they changed.`}
        </p>
      )}
      {isBulkApprovalError && !review.isError && (
        <p className={styles.errorMsg} role="alert">
          Couldn’t confirm your selection. Try again.
        </p>
      )}
      {!isBulkApproving && unresolvedBulkFailures > 0 && (
        <p className={styles.errorMsg} role="alert">
          {approved} of {bulkApprovalResult.total} pages approved in this batch.
          {unresolvedBulkFailures === 1
            ? " One page still needs approval."
            : ` ${unresolvedBulkFailures} pages still need approval.`}
          {" Try again or review those pages individually."}
        </p>
      )}
    </div>
  );
}

function ContinueAction({ reason, onContinue }) {
  const tooltipId = useId();
  const wrapperRef = useRef(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!reason || !open) return;
    function dismissOnEscape(event) {
      if (event.key === "Escape") setOpen(false);
    }
    function dismissOutside(event) {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("keydown", dismissOnEscape);
    document.addEventListener("pointerdown", dismissOutside);
    return () => {
      document.removeEventListener("keydown", dismissOnEscape);
      document.removeEventListener("pointerdown", dismissOutside);
    };
  }, [reason, open]);

  return (
    <div
      className={styles.continueWrap}
      ref={wrapperRef}
      onPointerEnter={event => {
        if (reason && event.pointerType !== "touch") setOpen(true);
      }}
      onPointerLeave={event => {
        if (!event.currentTarget.contains(document.activeElement))
          setOpen(false);
      }}
    >
      <button
        type="button"
        className={styles.ctaBtn}
        aria-disabled={reason ? true : undefined}
        aria-describedby={reason ? tooltipId : undefined}
        onFocus={() => {
          if (reason) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onClick={() => {
          if (reason) {
            setOpen(true);
            return;
          }
          onContinue();
        }}
      >
        Continue →
      </button>
      {reason && (
        <span
          id={tooltipId}
          className={styles.continueTooltip}
          role="tooltip"
          hidden={!open}
        >
          {reason}
        </span>
      )}
    </div>
  );
}

function PageCard({ slot, pageNumber, selecting, selected, disabled, onOpen }) {
  const page = slot.currentPage;
  const candidate = displayCandidate(page);
  const { url } = useArtifactAccess(candidate?.artifactId ?? null);
  const isApproved =
    slot.included !== false &&
    page.state === "approved" &&
    page.approvalSource === "human";

  return (
    <button
      type="button"
      className={styles.card}
      disabled={disabled}
      onClick={onOpen}
      aria-label={
        selecting
          ? `Page ${pageNumber}`
          : isApproved
            ? "Open approved page review"
            : "Open page review"
      }
      aria-pressed={selecting ? selected : undefined}
    >
      <div className={styles.thumbWrap}>
        {url ? (
          <img src={url} alt="" className={styles.thumb} />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden="true" />
        )}
        {selected && (
          <span className={styles.selectionMark} aria-hidden="true">
            ✓
          </span>
        )}
        {isApproved && (
          <span
            className={`${styles.pill} ${styles.pillReady} ${styles.thumbnailStatus}`}
          >
            <span className={styles.pillDot} aria-hidden="true" />
            Approved
          </span>
        )}
      </div>
    </button>
  );
}

/** A "Try again"-shaped action: a retry button while the regeneration cap
 * has room left, otherwise a contact-support link in its place — the book-
 * wide cap-reached banner above already explains why. */
function RetryOrSupport({ remaining, pending, onClick, label = "Try again" }) {
  if (remaining === 0) {
    return (
      <a className={styles.ghostBtn} href={SUPPORT_LINK}>
        Contact support
      </a>
    );
  }
  return (
    <button
      type="button"
      className={styles.primaryBtn}
      disabled={pending}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PageDetail({ slot, review, onBack }) {
  const [compare, setCompare] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const pending = pendingAction !== null;
  const [error, setError] = useState(null);

  const page = slot.currentPage;
  const state = page.state;
  const isActive = ACTIVE_PAGE_STATES.has(state);
  const included = slot.included !== false;
  const isHumanApproved =
    state === "approved" && page.approvalSource === "human";
  const imageStatus = !included
    ? "Removed from book"
    : isHumanApproved
      ? "Approved"
      : "";

  const candidate = displayCandidate(page);
  const { url: candidateUrl } = useArtifactAccess(
    candidate?.artifactId ?? null
  );
  // sourceArtifactId comes straight from reconcilePageSlots, which looks it
  // up from the current run's `photos` list by the current page's photoId —
  // useArtifactAccess's own `enabled: Boolean(artifactId)` guard already
  // handles a null id (e.g. a lookup miss) the same way it handles any
  // other missing artifact id.
  const { url: sourceUrl } = useArtifactAccess(slot.sourceArtifactId);
  const hasCandidate = Boolean(candidate);
  const canApprove = canApprovePage(page, candidate);
  const removesPage = included && (isHumanApproved || !canApprove);

  async function run(action, name = "change") {
    setPendingAction(name);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setPendingAction(null);
    }
  }

  function handleFileChange(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    run(() => review.replacePhoto(slot.currentPageId, file));
  }

  async function toggleSelection() {
    if (removesPage) {
      await review.setPageInclusion(slot.originalPageId, false);
      return;
    }
    if (canApprove && !isHumanApproved) {
      await review.keepPage(slot.currentPageId, candidate.candidateId);
    }
    if (!included) {
      await review.setPageInclusion(slot.originalPageId, true);
    }
  }

  return (
    <div className={styles.detail}>
      <button
        type="button"
        className={styles.backLink}
        disabled={pending}
        onClick={onBack}
      >
        ← Back to all pages
      </button>

      <div className={styles.detailImageWrap}>
        <span
          className={
            imageStatus
              ? `${styles.pill} ${styles.detailStatus} ${included ? styles.pillReady : styles.pillAttention}`
              : styles.approvalAnnouncement
          }
          role="status"
        >
          {imageStatus && (
            <>
              <span className={styles.pillDot} aria-hidden="true" />
              {imageStatus}
            </>
          )}
        </span>
        {compare || !hasCandidate
          ? sourceUrl && (
              <img
                src={sourceUrl}
                alt="Your original photo"
                className={styles.detailImage}
              />
            )
          : candidateUrl && (
              <img
                src={candidateUrl}
                alt="Coloring page candidate"
                className={styles.detailImage}
              />
            )}
      </div>

      {hasCandidate && (
        <div className={styles.compareRow}>
          <span>
            {compare ? "Your original photo" : "Coloring page preview"}
          </span>
          <button
            type="button"
            className={styles.ghostBtn}
            onClick={() => setCompare(v => !v)}
            aria-pressed={compare}
          >
            {compare ? "Show page" : "Compare with photo"}
          </button>
        </div>
      )}

      {error && (
        <p className={styles.errorMsg} role="alert">
          {error}
        </p>
      )}

      <div className={styles.detailActions}>
        <button
          type="button"
          className={removesPage ? styles.secondaryBtn : styles.primaryBtn}
          disabled={pending}
          onClick={() => run(toggleSelection, "selection")}
        >
          {pendingAction === "selection"
            ? "Saving…"
            : removesPage
              ? "Remove from book"
              : "Keep this page"}
        </button>

        {included && isActive && (
          <span className={styles.pendingBadge}>Making a new version…</span>
        )}

        {included && state === "approved" && (
          <button
            type="button"
            className={styles.secondaryBtn}
            disabled={pending || review.regenerationsRemaining === 0}
            onClick={() => run(() => review.tryAgain(slot.currentPageId))}
          >
            Try another version
          </button>
        )}

        {included && state === "needs_human_review" && (
          <RetryOrSupport
            remaining={review.regenerationsRemaining}
            pending={pending}
            onClick={() => run(() => review.tryAgain(slot.currentPageId))}
          />
        )}

        {included && state === "rejected" && (
          <RetryOrSupport
            remaining={review.regenerationsRemaining}
            pending={pending}
            onClick={() => run(() => review.tryAgain(slot.currentPageId))}
          />
        )}

        {included &&
          (state === "provider_failed" || state === "budget_exhausted") && (
            <>
              {review.regenerationsRemaining > 0 && (
                <button
                  type="button"
                  className={styles.primaryBtn}
                  disabled={pending}
                  onClick={() => run(() => review.tryAgain(slot.currentPageId))}
                >
                  Try again
                </button>
              )}
              <a className={styles.ghostBtn} href={SUPPORT_LINK}>
                Contact support
              </a>
            </>
          )}

        {included &&
          (state === "intake_rejected" || state === "intake_needs_review") && (
            <>
              {page.terminalReason && (
                <p className={styles.terminalReason}>{page.terminalReason}</p>
              )}
              {review.replacementsRemaining > 0 ? (
                <label className={styles.uploadBtn}>
                  Upload a different photo
                  <input
                    type="file"
                    accept={ACCEPTED_TYPES}
                    hidden
                    disabled={pending}
                    onChange={handleFileChange}
                  />
                </label>
              ) : (
                <a className={styles.ghostBtn} href={SUPPORT_LINK}>
                  Contact support
                </a>
              )}
            </>
          )}
      </div>
    </div>
  );
}
