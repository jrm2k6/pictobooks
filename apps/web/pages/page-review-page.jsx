import React, { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AppShell } from "../app-shell.jsx";
import { usePageReview } from "../hooks/use-page-review.js";
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

const NEEDS_ATTENTION_STATES = new Set([
  "needs_human_review",
  "rejected",
  "provider_failed",
  "budget_exhausted",
  "intake_rejected",
  "intake_needs_review",
]);

/** Highest styleQa.score wins — same selection rule use-page-review.js's
 * tryAgainMutation uses when it has to pick a candidate to reject. */
function pickBestCandidate(candidates) {
  if (!candidates?.length) return null;
  return candidates.reduce((best, candidate) =>
    (candidate.styleQa?.score ?? -Infinity) > (best.styleQa?.score ?? -Infinity)
      ? candidate
      : best
  ).candidateId;
}

/** The candidate this screen should display for a page: the one the
 * customer already approved, or (if no decision has been made yet) the
 * best-scoring one — matching the candidate `tryAgain` would reject. */
function displayCandidate(page) {
  if (!page.candidates?.length) return null;
  const candidateId =
    page.approvedCandidateId ?? pickBestCandidate(page.candidates);
  return page.candidates.find(c => c.candidateId === candidateId) ?? null;
}

function statusPillFor(state) {
  if (ACTIVE_PAGE_STATES.has(state)) {
    return { label: "Making a new version…", tone: styles.pillPending };
  }
  if (state === "approved") {
    return { label: "Ready to keep", tone: styles.pillReady };
  }
  if (NEEDS_ATTENTION_STATES.has(state)) {
    return { label: "Needs a change", tone: styles.pillAttention };
  }
  return { label: state, tone: "" };
}

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

  const selectedSlot =
    review.slots.find(s => s.originalPageId === selectedOriginalPageId) ?? null;

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
            Keep a page as-is, ask for another version, or replace a photo that
            didn't work out. Every page needs a decision before you can
            continue.
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

      {review.isLoading ? (
        <p className={styles.loading}>Loading your pages…</p>
      ) : review.isError ? (
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
          <div className={styles.grid} aria-label="Book pages">
            {review.slots.map(slot => (
              <PageCard
                key={slot.originalPageId}
                slot={slot}
                onOpen={() => setSelectedOriginalPageId(slot.originalPageId)}
              />
            ))}
          </div>

          <div className={styles.footer}>
            <span className={styles.footerNote}>
              Every page must be kept or resolved before you can continue.
            </span>
            <button
              type="button"
              className={styles.ctaBtn}
              disabled={!review.canContinue}
              onClick={handleContinue}
            >
              Continue →
            </button>
          </div>
        </>
      )}
    </AppShell>
  );
}

function PageCard({ slot, onOpen }) {
  const page = slot.currentPage;
  const candidate = displayCandidate(page);
  const { url } = useArtifactAccess(candidate?.artifactId ?? null);
  const pill = statusPillFor(page.state);

  return (
    <button
      type="button"
      className={styles.card}
      onClick={onOpen}
      aria-label={`Open page review, status: ${pill.label}`}
    >
      <div className={styles.thumbWrap}>
        {url ? (
          <img src={url} alt="" className={styles.thumb} />
        ) : (
          <div className={styles.thumbPlaceholder} aria-hidden="true" />
        )}
      </div>
      <span className={`${styles.pill} ${pill.tone}`}>
        <span className={styles.pillDot} aria-hidden="true" />
        {pill.label}
      </span>
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const page = slot.currentPage;
  const state = page.state;
  const isActive = ACTIVE_PAGE_STATES.has(state);

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

  async function run(action) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err.message ?? "Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  function handleFileChange(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!file) return;
    run(() => review.replacePhoto(slot.currentPageId, file));
  }

  return (
    <div className={styles.detail}>
      <button type="button" className={styles.backLink} onClick={onBack}>
        ← Back to all pages
      </button>

      <div className={styles.detailImageWrap}>
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
        {isActive && (
          <span className={styles.pendingBadge}>Making a new version…</span>
        )}

        {!isActive && state === "approved" && (
          <>
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={pending}
              onClick={() =>
                run(() =>
                  review.keepPage(slot.currentPageId, page.approvedCandidateId)
                )
              }
            >
              Keep this page
            </button>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={pending || review.regenerationsRemaining === 0}
              onClick={() => run(() => review.tryAgain(slot.currentPageId))}
            >
              Try another version
            </button>
          </>
        )}

        {!isActive && state === "needs_human_review" && (
          <>
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={pending}
              onClick={() =>
                run(() =>
                  review.keepPage(
                    slot.currentPageId,
                    candidate?.candidateId ?? null
                  )
                )
              }
            >
              Use this page anyway
            </button>
            <RetryOrSupport
              remaining={review.regenerationsRemaining}
              pending={pending}
              onClick={() => run(() => review.tryAgain(slot.currentPageId))}
            />
          </>
        )}

        {!isActive && state === "rejected" && (
          <RetryOrSupport
            remaining={review.regenerationsRemaining}
            pending={pending}
            onClick={() => run(() => review.tryAgain(slot.currentPageId))}
          />
        )}

        {!isActive &&
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

        {!isActive &&
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
