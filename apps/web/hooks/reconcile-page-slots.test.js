import { describe, expect, it } from "vitest";
import {
  canContinueReview,
  reconcilePageSlots,
} from "./reconcile-page-slots.js";

const page = (pageId, overrides = {}) => ({
  pageId,
  state: "approved",
  replacesPageId: null,
  ...overrides,
});

const run = (runId, createdAt, pages, regenerationKind = null) => ({
  runId,
  createdAt,
  regenerationKind,
  pages,
});

describe("reconcilePageSlots", () => {
  it("returns the primary run's pages unchanged when there are no other runs", () => {
    const primaryRun = run("run-primary", "2026-11-21T00:00:00Z", [
      page("page-1"),
      page("page-2"),
    ]);
    const result = reconcilePageSlots({ primaryRun, otherRuns: [] });
    expect(result.slots).toEqual([
      {
        originalPageId: "page-1",
        currentRunId: "run-primary",
        currentPageId: "page-1",
        currentPage: primaryRun.pages[0],
        sourceArtifactId: null,
      },
      {
        originalPageId: "page-2",
        currentRunId: "run-primary",
        currentPageId: "page-2",
        currentPage: primaryRun.pages[1],
        sourceArtifactId: null,
      },
    ]);
    expect(result.regenerationsUsed).toBe(0);
    expect(result.replacementsUsed).toBe(0);
  });

  it("looks up sourceArtifactId from the current run's photos, by the current page's photoId", () => {
    const primaryRun = {
      ...run("run-primary", "2026-11-21T00:00:00Z", [
        page("page-1", { photoId: "photo-1" }),
      ]),
      photos: [{ photoId: "photo-1", sourceArtifactId: "source:original" }],
    };
    const result = reconcilePageSlots({ primaryRun, otherRuns: [] });
    expect(result.slots[0].sourceArtifactId).toBe("source:original");
  });

  it("tracks the replacement run's own sourceArtifactId, not the original photo's", () => {
    const primaryRun = {
      ...run("run-primary", "2026-11-21T00:00:00Z", [
        page("page-1", { photoId: "photo-1" }),
      ]),
      photos: [{ photoId: "photo-1", sourceArtifactId: "source:original" }],
    };
    const replacementRun = {
      ...run(
        "run-replace",
        "2026-11-21T01:00:00Z",
        [
          page("replace-page-1", {
            replacesPageId: "page-1",
            photoId: "photo-2",
            state: "created",
          }),
        ],
        "photo_replacement"
      ),
      photos: [{ photoId: "photo-2", sourceArtifactId: "source:replacement" }],
    };
    const result = reconcilePageSlots({
      primaryRun,
      otherRuns: [replacementRun],
    });
    expect(result.slots[0]).toMatchObject({
      currentRunId: "run-replace",
      sourceArtifactId: "source:replacement",
    });
  });

  it("resolves a slot to its regeneration run", () => {
    const primaryRun = run("run-primary", "2026-11-21T00:00:00Z", [
      page("page-1"),
    ]);
    const regenRun = run(
      "run-regen",
      "2026-11-21T01:00:00Z",
      [
        page("regen-page-1", {
          replacesPageId: "page-1",
          state: "needs_human_review",
        }),
      ],
      "candidate_regeneration"
    );
    const result = reconcilePageSlots({ primaryRun, otherRuns: [regenRun] });
    expect(result.slots[0]).toMatchObject({
      originalPageId: "page-1",
      currentRunId: "run-regen",
      currentPageId: "regen-page-1",
    });
    expect(result.regenerationsUsed).toBe(1);
    expect(result.replacementsUsed).toBe(0);
  });

  it("resolves a slot to its photo-replacement run", () => {
    const primaryRun = run("run-primary", "2026-11-21T00:00:00Z", [
      page("page-1"),
    ]);
    const replacementRun = run(
      "run-replace",
      "2026-11-21T01:00:00Z",
      [page("replace-page-1", { replacesPageId: "page-1", state: "created" })],
      "photo_replacement"
    );
    const result = reconcilePageSlots({
      primaryRun,
      otherRuns: [replacementRun],
    });
    expect(result.slots[0].currentRunId).toBe("run-replace");
    expect(result.regenerationsUsed).toBe(0);
    expect(result.replacementsUsed).toBe(1);
  });

  it("follows a multi-hop chain: replaced once, then regenerated again", () => {
    const primaryRun = run("run-primary", "2026-11-21T00:00:00Z", [
      page("page-1"),
    ]);
    const replacementRun = run(
      "run-replace",
      "2026-11-21T01:00:00Z",
      [page("replace-page-1", { replacesPageId: "page-1" })],
      "photo_replacement"
    );
    const regenRun = run(
      "run-regen-again",
      "2026-11-21T02:00:00Z",
      [page("regen-page-1", { replacesPageId: "replace-page-1" })],
      "candidate_regeneration"
    );
    const result = reconcilePageSlots({
      primaryRun,
      otherRuns: [replacementRun, regenRun],
    });
    expect(result.slots[0]).toMatchObject({
      originalPageId: "page-1",
      currentRunId: "run-regen-again",
      currentPageId: "regen-page-1",
    });
    expect(result.regenerationsUsed).toBe(1);
    expect(result.replacementsUsed).toBe(1);
  });

  it("picks the newest run when two runs both claim to replace the same page", () => {
    const primaryRun = run("run-primary", "2026-11-21T00:00:00Z", [
      page("page-1"),
    ]);
    const earlier = run(
      "run-earlier",
      "2026-11-21T01:00:00Z",
      [page("earlier-page-1", { replacesPageId: "page-1" })],
      "candidate_regeneration"
    );
    const later = run(
      "run-later",
      "2026-11-21T02:00:00Z",
      [page("later-page-1", { replacesPageId: "page-1" })],
      "candidate_regeneration"
    );
    const result = reconcilePageSlots({
      primaryRun,
      otherRuns: [earlier, later],
    });
    expect(result.slots[0].currentRunId).toBe("run-later");
  });

  it("skips a run whose upload expired without completing, resolving to the next-best candidate instead", () => {
    const primaryRun = run("run-primary", "2026-11-21T00:00:00Z", [
      page("page-1"),
    ]);
    const abandoned = {
      ...run(
        "run-abandoned",
        "2026-11-21T02:00:00Z",
        [page("abandoned-page-1", { replacesPageId: "page-1" })],
        "photo_replacement"
      ),
      uploadExpired: true,
    };
    const result = reconcilePageSlots({ primaryRun, otherRuns: [abandoned] });
    // Falls all the way back to the primary page — there was no earlier
    // live replacement to fall back to.
    expect(result.slots[0]).toMatchObject({
      originalPageId: "page-1",
      currentRunId: "run-primary",
      currentPageId: "page-1",
    });
    // An abandoned run must not count against the cap either — the backend
    // already excludes it from countRegenerations, so the client's count
    // has to match or the "X of 3 used" banner would lie.
    expect(result.replacementsUsed).toBe(0);
  });
});

describe("canContinueReview", () => {
  it("is false when any slot's current page isn't approved, true only when every slot is", () => {
    const approved = { currentPage: { state: "approved" } };
    const pending = { currentPage: { state: "needs_human_review" } };
    expect(canContinueReview([approved, approved])).toBe(true);
    expect(canContinueReview([approved, pending])).toBe(false);
    expect(canContinueReview([])).toBe(false);
    // Must be positive-predicate, not an exclusion list: an unresolved
    // intake_rejected page blocks continuing exactly like `rejected` does.
    expect(
      canContinueReview([{ currentPage: { state: "intake_rejected" } }])
    ).toBe(false);
  });
});
