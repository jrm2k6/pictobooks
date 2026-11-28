import React, { useEffect } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { AppShell } from "../app-shell.jsx";
import { useBooks } from "../hooks/use-books.js";
import { hasSavedOrderPhotos, resolveBookDestination } from "../book-resume.js";
import styles from "../books-page.module.css";

/**
 * Direct-link resolver for `/books/$bookId`.
 * Looks up the book in the user's library and redirects to the right
 * wizard, review, or preview route based on its latest run.
 */
export function BookResumePage() {
  const { bookId } = useParams({ strict: false });
  const navigate = useNavigate();
  const { data: books, isLoading, isError, error } = useBooks();

  useEffect(() => {
    if (isLoading || isError || !books) return;

    const book = books.find(b => b.bookId === bookId);
    if (!book) {
      navigate({ to: "/books", replace: true });
      return;
    }

    const dest = resolveBookDestination(book, {
      hasSavedOrder: hasSavedOrderPhotos(book.latestRun?.runId),
    });
    navigate({ to: dest.to, search: dest.search, replace: true });
  }, [bookId, books, isLoading, isError, navigate]);

  return (
    <AppShell>
      {isError ? (
        <div className={styles.errorState} role="alert">
          <div className={styles.emptyCopy}>
            <p className={styles.errorMsg}>
              {error?.message ?? "Could not open this book. Please try again."}
            </p>
            <Link to="/books" className={styles.openBtn}>
              ← Back to your bookshelf
            </Link>
          </div>
        </div>
      ) : (
        <div
          className={styles.skeletonGrid}
          aria-busy="true"
          aria-live="polite"
        >
          <div className={styles.skeletonCard}>
            <div className={styles.skeletonThumb} />
            <div className={styles.skeletonLines}>
              <div className={styles.skeletonLine} style={{ width: "55%" }} />
              <div className={styles.skeletonLine} style={{ width: "35%" }} />
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
