import React, { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { AppShell } from "../app-shell.jsx";
import { useBookPages } from "../hooks/use-book-pages.js";
import { useArtifactAccess } from "../hooks/use-artifact-access.js";
import styles from "./book-preview-page.module.css";

/**
 * The candidate a slot's current page should display. By the time a
 * customer reaches preview, page-review's canContinue was already true,
 * so every slot's current page carries an approvedCandidateId — fall
 * back to the first candidate only for a direct deep link that lands
 * here before that's resolved.
 */
function displayCandidate(page) {
  if (!page?.candidates?.length) return null;
  const candidateId =
    page.approvedCandidateId ?? page.candidates[0]?.candidateId;
  return page.candidates.find(c => c.candidateId === candidateId) ?? null;
}

/** Spreads real pages two at a time, starting from page 1 — no fake
 * cover (the real book model has no cover concept: getBookRun's pages
 * are exactly the reviewed content pages, nothing else). The last
 * spread holds a single page when the count is odd. */
function buildSpreads(slots) {
  const spreads = [];
  for (let i = 0; i < slots.length; i += 2) {
    spreads.push(slots.slice(i, i + 2));
  }
  return spreads;
}

/**
 * Step 6 (post-review) — Preview the finished book.
 * Read-only spread view: no decisions, no mutations. Consumes the same
 * resolved "current page per slot" list the review screen builds
 * (use-book-pages.js), rendered two pages per spread with prev/next
 * controls. Not wrapped in WizardShell, same reasoning as the review
 * page — this happens after the book is created, not as a wizard step.
 */
export function BookPreviewPage() {
  const { bookId, runId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const { slots, isLoading } = useBookPages(bookId, runId);
  const [spreadIndex, setSpreadIndex] = useState(0);

  const spreads = buildSpreads(slots);
  const spreadCount = spreads.length;
  const currentSpread = spreads[Math.min(spreadIndex, spreadCount - 1)] ?? [];
  const firstPageNumber =
    Math.min(spreadIndex, Math.max(spreadCount - 1, 0)) * 2 + 1;

  function handleBackToReview() {
    navigate({ to: "/books/new/pages", search: { bookId, runId } });
  }

  function handleChooseEdition() {
    // TODO: edition/checkout routes don't exist yet. This is a
    // placeholder destination until that scope is built, matching how
    // processing-page.jsx's redirect was a placeholder before it had a
    // real review screen to send customers to.
    navigate({ to: "/books" });
  }

  return (
    <AppShell>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Your book, start to finish</span>
        <h1 className={styles.heading}>Take a look through the book.</h1>
        <p className={styles.lead}>
          {slots.length} finished page{slots.length === 1 ? "" : "s"}, ready for
          printing.
        </p>
      </header>

      {isLoading ? (
        <p className={styles.loading}>Loading your book…</p>
      ) : (
        <>
          <div className={styles.spread} aria-live="polite">
            {currentSpread.map(slot => (
              <SpreadPage key={slot.originalPageId} slot={slot} />
            ))}
          </div>

          <div className={styles.controls}>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() => setSpreadIndex(index => Math.max(0, index - 1))}
              disabled={spreadIndex === 0}
              aria-label="Previous spread"
            >
              ← Previous spread
            </button>
            <span className={styles.pageCount}>
              {spreadCount === 0
                ? "No pages yet"
                : `Pages ${firstPageNumber}–${Math.min(firstPageNumber + 1, slots.length)} of ${slots.length}`}
            </span>
            <button
              type="button"
              className={styles.ghostBtn}
              onClick={() =>
                setSpreadIndex(index => Math.min(spreadCount - 1, index + 1))
              }
              disabled={spreadIndex >= spreadCount - 1}
              aria-label="Next spread"
            >
              Next spread →
            </button>
          </div>
        </>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleBackToReview}
        >
          Back to page review
        </button>
        <button
          type="button"
          className={styles.primaryBtn}
          onClick={handleChooseEdition}
        >
          Choose an edition <span aria-hidden="true">→</span>
        </button>
      </div>
    </AppShell>
  );
}

function SpreadPage({ slot }) {
  const page = slot.currentPage;
  const candidate = displayCandidate(page);
  const { url } = useArtifactAccess(candidate?.artifactId ?? null);

  return (
    <div className={styles.spreadPage}>
      {url ? (
        <img src={url} alt="" className={styles.pageImage} />
      ) : (
        <div className={styles.pagePlaceholder} aria-hidden="true" />
      )}
    </div>
  );
}
