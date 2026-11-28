import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE_CONFIG,
  formatApiError,
  formatBookLimitNote,
  hasReachedBookLimit,
  normalizePipelineConfig,
} from "./alpha-limits.js";

describe("normalizePipelineConfig", () => {
  it("returns safe fallback defaults when data is missing", () => {
    expect(normalizePipelineConfig(undefined)).toEqual(DEFAULT_PIPELINE_CONFIG);
    expect(normalizePipelineConfig(null)).toEqual(DEFAULT_PIPELINE_CONFIG);
  });

  it("merges valid server config values", () => {
    expect(
      normalizePipelineConfig({
        minPhotosPerRun: 3,
        maxPhotosPerRun: 8,
        maxBooksPerUser: 1,
      })
    ).toEqual({
      minPhotosPerRun: 3,
      maxPhotosPerRun: 8,
      maxBooksPerUser: 1,
    });
  });

  it("treats null or non-positive maxBooksPerUser as unlimited", () => {
    expect(
      normalizePipelineConfig({
        minPhotosPerRun: 5,
        maxPhotosPerRun: 10,
        maxBooksPerUser: null,
      })
    ).toEqual({
      minPhotosPerRun: 5,
      maxPhotosPerRun: 10,
      maxBooksPerUser: null,
    });

    expect(
      normalizePipelineConfig({
        minPhotosPerRun: 5,
        maxPhotosPerRun: 10,
        maxBooksPerUser: 0,
      }).maxBooksPerUser
    ).toBeNull();
  });

  it("falls back safely when server photo bounds are invalid", () => {
    expect(
      normalizePipelineConfig({
        minPhotosPerRun: -1,
        maxPhotosPerRun: 2,
      })
    ).toEqual({
      minPhotosPerRun: 5,
      maxPhotosPerRun: 10,
      maxBooksPerUser: null,
    });
  });
});

describe("hasReachedBookLimit", () => {
  it("returns false when maxBooksPerUser is null or invalid", () => {
    expect(hasReachedBookLimit([{ status: "draft" }], null)).toBe(false);
    expect(hasReachedBookLimit([{ status: "draft" }], undefined)).toBe(false);
    expect(hasReachedBookLimit([{ status: "draft" }], 0)).toBe(false);
  });

  it("returns false when books is not an array", () => {
    expect(hasReachedBookLimit(undefined, 1)).toBe(false);
    expect(hasReachedBookLimit(null, 1)).toBe(false);
  });

  it("counts non-cancelled books against maxBooksPerUser", () => {
    expect(hasReachedBookLimit([], 1)).toBe(false);
    expect(hasReachedBookLimit([{ status: "draft" }], 1)).toBe(true);
    expect(
      hasReachedBookLimit([{ status: "draft" }, { status: "ready" }], 2)
    ).toBe(true);
    expect(hasReachedBookLimit([{ status: "draft" }], 2)).toBe(false);
  });

  it("ignores cancelled books when checking the cap", () => {
    expect(hasReachedBookLimit([{ status: "cancelled" }], 1)).toBe(false);
    expect(
      hasReachedBookLimit([{ status: "cancelled" }, { status: "cancelled" }], 1)
    ).toBe(false);
    expect(
      hasReachedBookLimit([{ status: "cancelled" }, { status: "draft" }], 1)
    ).toBe(true);
  });
});

describe("formatApiError", () => {
  it("maps alpha_access_required to a friendly invite-only message", () => {
    expect(
      formatApiError({ code: "alpha_access_required", message: "Forbidden" })
    ).toBe(
      "Pictobook is currently in invite-only alpha. Contact us if you received an invite."
    );
  });

  it("maps book_limit_reached to a friendly alpha cap message", () => {
    expect(
      formatApiError({ code: "book_limit_reached", message: "Forbidden" })
    ).toBe("You've already created your free alpha book.");
  });

  it("maps invalid_photo_count using configured bounds", () => {
    expect(formatApiError({ code: "invalid_photo_count" })).toBe(
      "Please choose between 5 and 10 photos."
    );
    expect(
      formatApiError(
        { code: "invalid_photo_count" },
        { minPhotosPerRun: 3, maxPhotosPerRun: 12 }
      )
    ).toBe("Please choose between 3 and 12 photos.");
  });

  it("falls back to error.message or custom fallback for other errors", () => {
    expect(formatApiError({ message: "Network offline" })).toBe(
      "Network offline"
    );
    expect(formatApiError(null, { fallback: "Custom fallback" })).toBe(
      "Custom fallback"
    );
  });
});

describe("formatBookLimitNote", () => {
  it("uses singular copy for 1 free book and plural otherwise", () => {
    expect(formatBookLimitNote(1)).toBe(
      "Alpha includes 1 free book — open yours below"
    );
    expect(formatBookLimitNote(3)).toBe(
      "Alpha includes 3 free books — open yours below"
    );
  });
});
