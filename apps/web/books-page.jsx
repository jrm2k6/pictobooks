import React from "react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "./app-shell.jsx";
import { useBooks } from "./hooks/use-books.js";
import { hasSavedOrderPhotos, resolveBookDestination } from "./book-resume.js";
import styles from "./books-page.module.css";

/* ── Loading skeleton ─────────────────────────────────────────────────── */
function BooksSkeleton() {
  return (
    <div className={styles.skeletonGrid}>
      {[0, 1, 2].map(i => (
        <div key={i} className={styles.skeletonCard}>
          <div className={styles.skeletonThumb} />
          <div className={styles.skeletonLines}>
            <div className={styles.skeletonLine} style={{ width: "70%" }} />
            <div className={styles.skeletonLine} style={{ width: "45%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Empty state ──────────────────────────────────────────────────────── */
function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyArt}>
        <div className={styles.emptyBlob} aria-hidden="true" />
        <div className={styles.emptyIcon} aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
            <rect
              x="6"
              y="8"
              width="28"
              height="24"
              rx="3"
              fill="oklch(from var(--color-coral) l c h / 0.12)"
              stroke="var(--color-coral)"
              strokeWidth="1.5"
            />
            <path
              d="M12 16h16M12 21h16M12 26h10"
              stroke="var(--color-coral)"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      <div className={styles.emptyCopy}>
        <span className={styles.emptyEyebrow}>
          A book made from your moments
        </span>
        <h1 className={styles.emptyHeading}>
          Your family stories belong on the page.
        </h1>
        <p className={styles.emptyBody}>
          Choose five to ten photos. We'll turn them into a coloring book your
          child can make their own.
        </p>
        <ul className={styles.checkList}>
          <li>A page inspired by every photo</li>
          <li>Made for ages 3–12</li>
          <li>Preview before you order</li>
        </ul>
        <Link to="/books/new" className={styles.ctaBtn}>
          Start a book →
        </Link>
      </div>
    </div>
  );
}

/* ── Book card ────────────────────────────────────────────────────────── */
function formatRunProgress(latestRun) {
  if (!latestRun) return null;
  const total = latestRun.includedPageCount ?? latestRun.totalPageCount;
  if (total == null) return null;

  const pageWord = total === 1 ? "page" : "pages";

  if (latestRun.status === "created") {
    if (total === 0) return null;
    const photoWord = total === 1 ? "photo" : "photos";
    return `${total} ${photoWord} selected`;
  }

  if (
    latestRun.status === "completed" ||
    latestRun.status === "partially_completed"
  ) {
    const approved = latestRun.humanApprovedPageCount ?? 0;
    if (latestRun.reviewComplete || approved > 0) {
      return `${approved} of ${total} ${pageWord} approved`;
    }
    return `${latestRun.readyPageCount ?? 0} of ${total} ${pageWord} ready to review`;
  }

  return `${latestRun.readyPageCount ?? 0} of ${total} ${pageWord} ready`;
}

function BookCard({ book }) {
  const dest = resolveBookDestination(book, {
    hasSavedOrder: hasSavedOrderPhotos(book.latestRun?.runId),
  });
  const isProcessing = book.latestRun?.status === "running";
  const progressCopy = formatRunProgress(book.latestRun);

  return (
    <article className={styles.bookCard}>
      <div className={styles.bookCardThumb} aria-hidden="true">
        <div className={styles.bookCardThumbInner} />
        {/* Cover placeholder — replace with real artifact URL when available */}
        <svg
          className={styles.bookIcon}
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
        >
          <rect
            x="4"
            y="4"
            width="20"
            height="20"
            rx="2"
            fill="oklch(from var(--color-coral) l c h / 0.15)"
            stroke="var(--color-coral)"
            strokeWidth="1.5"
          />
          <path
            d="M8 10h12M8 14h12M8 18h8"
            stroke="var(--color-coral)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </div>

      <div className={styles.bookCardBody}>
        <div className={styles.bookCardMeta}>
          {isProcessing ? (
            <span className={styles.activePill}>
              <span className={styles.activeDot} aria-hidden="true" />
              {dest.statusLabel}
            </span>
          ) : (
            <span className={styles.statusLabel}>{dest.statusLabel}</span>
          )}
        </div>
        <h2 className={styles.bookCardTitle}>
          {book.title ??
            (book.childName ? `${book.childName}'s book` : "Untitled book")}
        </h2>
        {book.childName && (
          <p className={styles.bookCardSub}>
            Created for {book.childName}
            {book.childAge ? ` · Age ${book.childAge}` : ""}
          </p>
        )}
        {progressCopy && <p className={styles.bookCardSub}>{progressCopy}</p>}
      </div>

      <div className={styles.bookCardActions}>
        <Link to={dest.to} search={dest.search} className={styles.openBtn}>
          {dest.actionLabel}
        </Link>
      </div>
    </article>
  );
}

/* ── Books list ───────────────────────────────────────────────────────── */
function BookList({ books }) {
  return (
    <>
      <header className={styles.listHeader}>
        <div>
          <h1 className={styles.listHeading}>Your bookshelf</h1>
          <p className={styles.listSub}>
            Pick up where you left off, or turn new photos into a book.
          </p>
        </div>
        <Link to="/books/new" className={styles.ctaBtn}>
          Create a book →
        </Link>
      </header>

      <div className={styles.bookGrid}>
        {books.map(book => (
          <BookCard key={book.bookId} book={book} />
        ))}
      </div>

      <div className={styles.infoCallout}>
        <span className={styles.infoIcon} aria-hidden="true">
          i
        </span>
        <span>
          Photos stay private to your books. You choose which pages to keep
          before ordering.
        </span>
      </div>
    </>
  );
}

/* ── BooksPage ────────────────────────────────────────────────────────── */
export function BooksPage() {
  const { data: books, isLoading, isError, error } = useBooks();

  return (
    <AppShell>
      {isLoading && <BooksSkeleton />}

      {isError && (
        <div className={styles.errorState} role="alert">
          <p className={styles.errorMsg}>
            {error?.message ??
              "Could not load your books. Please try refreshing."}
          </p>
        </div>
      )}

      {!isLoading && !isError && books?.length === 0 && <EmptyState />}

      {!isLoading && !isError && books?.length > 0 && (
        <BookList books={books} />
      )}
    </AppShell>
  );
}
