/**
 * Pure routing helpers for resuming an existing book from the bookshelf
 * or from a direct `/books/:bookId` link.
 */

/**
 * Checks sessionStorage for saved photo metadata from PhotoSelectionPage.
 * Safe in SSR / non-browser environments and when storage is restricted.
 *
 * @param {string | null | undefined} runId
 * @returns {boolean}
 */
export function hasSavedOrderPhotos(runId) {
  if (!runId) return false;
  try {
    const raw = sessionStorage.getItem(`pictobook_photos_${runId}`);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0;
  } catch {
    return false;
  }
}

/**
 * Resolves the next wizard/review/preview destination for a book summary.
 *
 * @param {import('./api-client.js').BookSummary} book
 * @param {{ hasSavedOrder?: boolean }} [options]
 * @returns {{
 *   to: string,
 *   search: Record<string, string>,
 *   actionLabel: string,
 *   statusLabel: string,
 * }}
 */
export function resolveBookDestination(book, { hasSavedOrder = false } = {}) {
  const { bookId, latestRun } = book;

  if (!latestRun) {
    return {
      to: "/books/new/photos",
      search: { bookId },
      actionLabel: "Add photos →",
      statusLabel: "Draft",
    };
  }

  const { runId, status, uploadExpired, reviewComplete } = latestRun;

  if (status === "created") {
    if (!uploadExpired && hasSavedOrder) {
      return {
        to: "/books/new/order",
        search: { bookId, runId },
        actionLabel: "Order pages →",
        statusLabel: "Draft",
      };
    }
    return {
      to: "/books/new/photos",
      search: { bookId },
      actionLabel: "Choose photos →",
      statusLabel: "Draft",
    };
  }

  if (status === "running") {
    return {
      to: "/books/new/creating",
      search: { bookId, runId },
      actionLabel: "View progress →",
      statusLabel: "In progress",
    };
  }

  if (status === "completed" || status === "partially_completed") {
    if (reviewComplete) {
      return {
        to: "/books/new/preview",
        search: { bookId, runId },
        actionLabel: "Open preview →",
        statusLabel: "Ready to print",
      };
    }
    return {
      to: "/books/new/pages",
      search: { bookId, runId },
      actionLabel: "Review pages →",
      statusLabel: "Ready to review",
    };
  }

  if (status === "failed" || status === "cancelled") {
    return {
      to: "/books/new/creating",
      search: { bookId, runId },
      actionLabel: "View status →",
      statusLabel: status === "cancelled" ? "Cancelled" : "Needs attention",
    };
  }

  return {
    to: "/books/new/photos",
    search: { bookId },
    actionLabel: "Open →",
    statusLabel: "Draft",
  };
}
