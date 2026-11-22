import React, { useEffect } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { WizardShell } from "./wizard-shell.jsx";
import { useBookRun } from "../hooks/use-book-run.js";
import styles from "./processing-page.module.css";

const TERMINAL_COMPLETE = new Set(["completed", "partially_completed"]);
const TERMINAL_FAILED = new Set(["failed", "cancelled"]);

/**
 * Step 4 of 4 — Processing.
 * Polls useBookRun every 2 s while the run is active.
 * Redirects to /books on completion; shows error state on failure.
 */
export function ProcessingPage() {
  const { bookId, runId } = useSearch({ strict: false });
  const navigate = useNavigate();

  const { data: run, isError, error } = useBookRun(bookId, runId);

  // Redirect when the run reaches a terminal state
  useEffect(() => {
    if (!run) return;
    if (TERMINAL_COMPLETE.has(run.status)) {
      navigate({ to: "/books/new/pages", search: { bookId, runId } });
    }
  }, [run?.status]);

  const totalPages = run?.totalPageCount ?? 0;
  const readyPages = run?.readyPageCount ?? 0;
  const progress =
    totalPages > 0 ? Math.round((readyPages / totalPages) * 100) : 0;
  const isFailed = run ? TERMINAL_FAILED.has(run.status) : false;

  return (
    <WizardShell step={4}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Creating your book</span>
        <h1 className={styles.heading}>Your pages are taking shape.</h1>
        <p className={styles.lead}>
          We're turning each photo into a page. You can leave this screen and
          come back at any time.
        </p>
      </header>

      {isFailed || isError ? (
        <div className={styles.errorState} role="alert">
          <div className={styles.errorIcon} aria-hidden="true">
            !
          </div>
          <div>
            <strong className={styles.errorTitle}>Something went wrong</strong>
            <p className={styles.errorDetail}>
              {error?.message ??
                "The book run failed. Please try creating a new book."}
            </p>
          </div>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => navigate({ to: "/books" })}
          >
            Back to my books
          </button>
        </div>
      ) : (
        <>
          <div
            className={styles.progressSummary}
            role="group"
            aria-label={`${readyPages} of ${totalPages || "?"} pages created`}
          >
            <div className={styles.progressCount}>
              {readyPages}
              <span className={styles.progressTotal}>
                {" "}
                / {totalPages || "…"}
              </span>
            </div>
            <div className={styles.progressInfo}>
              <strong>Pages created</strong>
              <small>Your photos stay attached to the right page.</small>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Book creation progress"
                aria-valuemin={0}
                aria-valuemax={totalPages}
                aria-valuenow={readyPages}
              >
                <div
                  className={styles.progressFill}
                  style={{ width: totalPages > 0 ? `${progress}%` : "0%" }}
                />
              </div>
            </div>
            <span className={styles.statusPill}>
              <span className={styles.statusDot} aria-hidden="true" />
              In progress
            </span>
          </div>

          <div className={styles.spinner} aria-hidden="true">
            <div className={styles.spinnerRing} />
          </div>

          <div className={styles.callout} role="status">
            <span className={styles.calloutIcon} aria-hidden="true">
              i
            </span>
            <span>
              <strong>No need to keep this tab open.</strong> The remaining
              pages can finish while you do something else.
            </span>
          </div>

          <div className={styles.footer}>
            <span className={styles.footerNote}>
              About 3 minutes remaining · we'll redirect you when done
            </span>
            <button
              type="button"
              className={styles.secondaryBtn}
              onClick={() => navigate({ to: "/books" })}
            >
              Go to my books
            </button>
          </div>
        </>
      )}
    </WizardShell>
  );
}
