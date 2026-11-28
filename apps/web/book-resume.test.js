import { afterEach, describe, expect, it, vi } from "vitest";
import { hasSavedOrderPhotos, resolveBookDestination } from "./book-resume.js";

function makeRun(overrides = {}) {
  return {
    runId: "run-123",
    status: "created",
    totalPageCount: 6,
    includedPageCount: 6,
    readyPageCount: 0,
    humanApprovedPageCount: 0,
    reviewComplete: false,
    uploadExpired: false,
    createdAt: "2026-11-28T00:00:00Z",
    completedAt: null,
    ...overrides,
  };
}

describe("resolveBookDestination", () => {
  it("routes a draft book with no latestRun to photo selection", () => {
    expect(
      resolveBookDestination({ bookId: "book-1", latestRun: null })
    ).toEqual({
      to: "/books/new/photos",
      search: { bookId: "book-1" },
      actionLabel: "Add photos →",
      statusLabel: "Draft",
    });

    expect(resolveBookDestination({ bookId: "book-1" })).toEqual({
      to: "/books/new/photos",
      search: { bookId: "book-1" },
      actionLabel: "Add photos →",
      statusLabel: "Draft",
    });
  });

  it("routes a created run with saved order and fresh uploads to page ordering", () => {
    const book = {
      bookId: "book-2",
      latestRun: makeRun({ status: "created", uploadExpired: false }),
    };

    expect(resolveBookDestination(book, { hasSavedOrder: true })).toEqual({
      to: "/books/new/order",
      search: { bookId: "book-2", runId: "run-123" },
      actionLabel: "Order pages →",
      statusLabel: "Draft",
    });
  });

  it("routes a created run without saved order back to photo selection", () => {
    const book = {
      bookId: "book-2",
      latestRun: makeRun({ status: "created", uploadExpired: false }),
    };

    expect(resolveBookDestination(book, { hasSavedOrder: false })).toEqual({
      to: "/books/new/photos",
      search: { bookId: "book-2" },
      actionLabel: "Choose photos →",
      statusLabel: "Draft",
    });
  });

  it("routes a created run with expired uploads back to photo selection even if order is saved", () => {
    const book = {
      bookId: "book-2",
      latestRun: makeRun({ status: "created", uploadExpired: true }),
    };

    expect(resolveBookDestination(book, { hasSavedOrder: true })).toEqual({
      to: "/books/new/photos",
      search: { bookId: "book-2" },
      actionLabel: "Choose photos →",
      statusLabel: "Draft",
    });
  });

  it("routes a running run to the processing page", () => {
    const book = {
      bookId: "book-3",
      latestRun: makeRun({ status: "running", readyPageCount: 2 }),
    };

    expect(resolveBookDestination(book)).toEqual({
      to: "/books/new/creating",
      search: { bookId: "book-3", runId: "run-123" },
      actionLabel: "View progress →",
      statusLabel: "In progress",
    });
  });

  it.each(["completed", "partially_completed"])(
    "routes a %s run with incomplete review to page review",
    status => {
      const book = {
        bookId: "book-4",
        latestRun: makeRun({
          status,
          reviewComplete: false,
          readyPageCount: 6,
        }),
      };

      expect(resolveBookDestination(book)).toEqual({
        to: "/books/new/pages",
        search: { bookId: "book-4", runId: "run-123" },
        actionLabel: "Review pages →",
        statusLabel: "Ready to review",
      });
    }
  );

  it.each(["completed", "partially_completed"])(
    "routes a %s run with complete review to book preview",
    status => {
      const book = {
        bookId: "book-5",
        latestRun: makeRun({
          status,
          reviewComplete: true,
          readyPageCount: 6,
          humanApprovedPageCount: 6,
        }),
      };

      expect(resolveBookDestination(book)).toEqual({
        to: "/books/new/preview",
        search: { bookId: "book-5", runId: "run-123" },
        actionLabel: "Open preview →",
        statusLabel: "Ready to print",
      });
    }
  );

  it("routes a failed run to the processing status page", () => {
    const book = {
      bookId: "book-6",
      latestRun: makeRun({ status: "failed" }),
    };

    expect(resolveBookDestination(book)).toEqual({
      to: "/books/new/creating",
      search: { bookId: "book-6", runId: "run-123" },
      actionLabel: "View status →",
      statusLabel: "Needs attention",
    });
  });

  it("routes a cancelled run to the processing status page", () => {
    const book = {
      bookId: "book-7",
      latestRun: makeRun({ status: "cancelled" }),
    };

    expect(resolveBookDestination(book)).toEqual({
      to: "/books/new/creating",
      search: { bookId: "book-7", runId: "run-123" },
      actionLabel: "View status →",
      statusLabel: "Cancelled",
    });
  });
});

describe("hasSavedOrderPhotos", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false when runId is missing", () => {
    expect(hasSavedOrderPhotos(null)).toBe(false);
    expect(hasSavedOrderPhotos(undefined)).toBe(false);
    expect(hasSavedOrderPhotos("")).toBe(false);
  });

  it("returns false when sessionStorage is unavailable", () => {
    vi.stubGlobal("sessionStorage", undefined);
    expect(hasSavedOrderPhotos("run-123")).toBe(false);
  });

  it("returns true when a non-empty photo array is stored for the run", () => {
    const store = new Map([
      ["pictobook_photos_run-123", JSON.stringify([{ photoId: "p1" }])],
    ]);
    vi.stubGlobal("sessionStorage", {
      getItem: key => store.get(key) ?? null,
    });

    expect(hasSavedOrderPhotos("run-123")).toBe(true);
    expect(hasSavedOrderPhotos("run-other")).toBe(false);
  });

  it("returns false for empty arrays, non-arrays, invalid JSON, or storage errors", () => {
    const store = new Map([
      ["pictobook_photos_empty", "[]"],
      ["pictobook_photos_obj", "{}"],
      ["pictobook_photos_bad", "{not-json"],
    ]);
    vi.stubGlobal("sessionStorage", {
      getItem: key => {
        if (key === "pictobook_photos_throw") throw new Error("blocked");
        return store.get(key) ?? null;
      },
    });

    expect(hasSavedOrderPhotos("empty")).toBe(false);
    expect(hasSavedOrderPhotos("obj")).toBe(false);
    expect(hasSavedOrderPhotos("bad")).toBe(false);
    expect(hasSavedOrderPhotos("throw")).toBe(false);
  });
});
