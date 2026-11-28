export const DEFAULT_PIPELINE_CONFIG = Object.freeze({
  minPhotosPerRun: 5,
  maxPhotosPerRun: 10,
  maxBooksPerUser: null,
});

/**
 * Merge server pipeline config with safe fallback defaults.
 *
 * @param {Partial<{ minPhotosPerRun: number, maxPhotosPerRun: number, maxBooksPerUser: number | null }> | null | undefined} data
 * @returns {{ minPhotosPerRun: number, maxPhotosPerRun: number, maxBooksPerUser: number | null }}
 */
export function normalizePipelineConfig(data) {
  if (!data || typeof data !== "object") {
    return { ...DEFAULT_PIPELINE_CONFIG };
  }

  const minPhotosPerRun =
    typeof data.minPhotosPerRun === "number" &&
    Number.isInteger(data.minPhotosPerRun) &&
    data.minPhotosPerRun > 0
      ? data.minPhotosPerRun
      : DEFAULT_PIPELINE_CONFIG.minPhotosPerRun;

  const maxPhotosPerRun =
    typeof data.maxPhotosPerRun === "number" &&
    Number.isInteger(data.maxPhotosPerRun) &&
    data.maxPhotosPerRun >= minPhotosPerRun
      ? data.maxPhotosPerRun
      : Math.max(minPhotosPerRun, DEFAULT_PIPELINE_CONFIG.maxPhotosPerRun);

  const maxBooksPerUser =
    typeof data.maxBooksPerUser === "number" &&
    Number.isInteger(data.maxBooksPerUser) &&
    data.maxBooksPerUser > 0
      ? data.maxBooksPerUser
      : null;

  return { minPhotosPerRun, maxPhotosPerRun, maxBooksPerUser };
}

/**
 * Determine whether the user has reached their active book cap.
 * Cancelled books do not count toward the limit.
 *
 * @param {Array<{ status?: string }> | null | undefined} books
 * @param {number | null | undefined} maxBooksPerUser
 * @returns {boolean}
 */
export function hasReachedBookLimit(books, maxBooksPerUser) {
  if (
    typeof maxBooksPerUser !== "number" ||
    !Number.isFinite(maxBooksPerUser) ||
    maxBooksPerUser <= 0
  ) {
    return false;
  }
  if (!Array.isArray(books)) {
    return false;
  }
  const activeCount = books.filter(book => book?.status !== "cancelled").length;
  return activeCount >= maxBooksPerUser;
}

/**
 * Map API error codes to parent-friendly copy.
 *
 * @param {{ code?: string, message?: string } | null | undefined} error
 * @param {object} [opts]
 * @param {number} [opts.minPhotosPerRun]
 * @param {number} [opts.maxPhotosPerRun]
 * @param {string} [opts.fallback]
 * @returns {string}
 */
export function formatApiError(
  error,
  {
    minPhotosPerRun = DEFAULT_PIPELINE_CONFIG.minPhotosPerRun,
    maxPhotosPerRun = DEFAULT_PIPELINE_CONFIG.maxPhotosPerRun,
    fallback = "Something went wrong. Please try again.",
  } = {}
) {
  if (error?.code === "alpha_access_required") {
    return "Pictobook is currently in invite-only alpha. Contact us if you received an invite.";
  }
  if (error?.code === "book_limit_reached") {
    return "You've already created your free alpha book.";
  }
  if (error?.code === "invalid_photo_count") {
    return `Please choose between ${minPhotosPerRun} and ${maxPhotosPerRun} photos.`;
  }
  return error?.message ?? fallback;
}

/**
 * Subtle header note shown on the bookshelf when the alpha book cap is reached.
 *
 * @param {number | null | undefined} maxBooksPerUser
 * @returns {string}
 */
export function formatBookLimitNote(maxBooksPerUser) {
  if (maxBooksPerUser === 1) {
    return "Alpha includes 1 free book — open yours below";
  }
  return `Alpha includes ${maxBooksPerUser} free books — open yours below`;
}
