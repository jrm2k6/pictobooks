# Candidate Review — Frontend (apps/web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the real, API-wired candidate-review and preview screens in `apps/web`: a grid-hub + detail-drill-in review screen with per-page decisions, regeneration, photo-replacement recovery, two independent caps, and a read-only preview screen — replacing the current dead end where `processing-page.jsx` redirects straight to `/books`.

**Architecture:** One pure reconciliation function (`reconcile-page-slots.js`) resolves "the current page per slot" across however many runs a book has accumulated; one hook (`use-book-pages.js`) wires that function to live polling and is shared, read-only, by both the review and preview screens; one hook (`use-page-review.js`) adds review's mutations and gating on top. The screens themselves are presentational, following the existing `*-page.jsx` + `.module.css` convention.

**Tech Stack:** React 19, TanStack Router/Query, Vite. Vitest (new, added in Task 1, scoped specifically to the pure reconciliation function — the user explicitly chose this over testing it only through Playwright). Playwright for everything UI-shaped, matching existing convention in `apps/web/e2e/`.

**Spec:** `docs/superpowers/specs/2026-11-21-candidate-review-design.md` (whole document — this plan implements the `apps/web` side of it).

**Precondition:** The backend plan (`docs/superpowers/plans/2026-11-21-candidate-review-backend.md`) must be merged first — every task here calls API surface that plan creates (`createPhotoReplacement`, the two caps, `replacesPageId`/`regenerationKind` on `getBookRun`).

## Global Constraints

- Run all commands from the repo root with `pnpm --filter web ...`.
- Follow the existing `*-page.jsx` / `.module.css` pairing convention (see `processing-page.jsx`).
- The new review/preview screens use `AppShell` directly, **not** `WizardShell` (`wizard-shell.jsx` hardcodes "Step N of 4 · Create your book", which doesn't fit a post-creation screen).
- Mutation headers follow the existing pattern in `api-client.js`'s `request()`: `Authorization: Bearer <token>`, `Idempotency-Key` via `withIdempotency: true`.
- `apps/web`'s existing Playwright tests are shallow route/rendering checks against fabricated ids (no live backend seeding) — this plan's e2e tests follow that same convention; the backend plan's vitest suite is what actually exercises cap/lineage/state-transition correctness end to end.
- **Avoid `useEffect`.** Every existing data-fetching hook in this codebase (`use-book-run.js`, `use-books.js`, etc.) uses TanStack Query, not `useEffect`+`useState` — no task in this plan should reach for `useEffect` to fetch, derive, or sync state that `useQuery`/`useMutation` already covers. Reserve it, if ever, for a true external-system subscription with no query-shaped equivalent — and none of this plan's tasks have one.

## Review Focus

- A customer who reloads mid-review (closes the tab, reopens `/books/new/pages?bookId=...&runId=...`) must still see the right per-page state — this is exactly what `reconcile-page-slots.js` has to get right from `listBookRuns` + `getBookRun` alone, with no client memory of what happened earlier in the session.
- Two runs that both claim to replace the same original page (a double-click race, or a retry after a dropped response) must resolve to one, not throw or show both.
- `canContinue` must be `false` whenever _any_ slot's current page isn't `approved` — written as a positive predicate ("every slot resolves to approved"), not a list of which states are excluded, per the design doc's explicit correction on this point.
- Hitting the regeneration cap must disable "Try again" everywhere but leave "Upload a different photo" untouched, and vice versa for the replacement cap — they're independent, and a wrong guess here silently merges two budgets the design doc deliberately split.
- The `replacePhoto` three-step sequence (`createPhotoReplacement` → `uploadPhoto` → `startBookRun`) must not call `startBookRun` if the upload itself fails — a half-done sequence must surface as a retryable error, not silently leave an orphaned run the UI never polls.

---

## Task 1: `reconcile-page-slots.js` — pure reconciliation function, with vitest

**Files:**

- Create: `apps/web/vitest.config.js`
- Modify: `apps/web/package.json` (add `vitest` devDependency, add `"test": "vitest run"` script)
- Create: `apps/web/hooks/reconcile-page-slots.js`
- Test: `apps/web/hooks/reconcile-page-slots.test.js`

**Interfaces:**

- Produces: `reconcilePageSlots({ primaryRun, otherRuns }): { slots: PageSlot[], regenerationsUsed: number, replacementsUsed: number }`, where `PageSlot = { originalPageId: string, currentRunId: string, currentPageId: string, currentPage: object }`. `primaryRun` and each entry of `otherRuns` are `getBookRun` response bodies (shape: `{ runId, createdAt, regenerationKind, pages: [{ pageId, state, replacesPageId, ... }], ... }`, per the backend plan's Task 4). Tasks 3 and 4 consume this signature unchanged.
- Produces: `canContinueReview(slots: PageSlot[]): boolean`, defined as "every slot's `currentPage.state` is `approved`" — written positively, not as a list of excluded states, per the design doc's explicit correction. Task 4 consumes this unchanged.

- [ ] **Step 1: Add vitest**

```bash
pnpm --filter web add -D vitest
```

Add to `apps/web/package.json` scripts: `"test": "vitest run"`.

Create `apps/web/vitest.config.js`:

```js
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.js"],
  },
});
```

- [ ] **Step 2: Write the failing tests**

```js
import { describe, expect, it } from "vitest";
import { reconcilePageSlots } from "./reconcile-page-slots.js";

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
      },
      {
        originalPageId: "page-2",
        currentRunId: "run-primary",
        currentPageId: "page-2",
        currentPage: primaryRun.pages[1],
      },
    ]);
    expect(result.regenerationsUsed).toBe(0);
    expect(result.replacementsUsed).toBe(0);
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter web test`
Expected: FAIL — `Cannot find module './reconcile-page-slots.js'`.

- [ ] **Step 4: Implement `reconcilePageSlots` in `apps/web/hooks/reconcile-page-slots.js`**

```js
export function reconcilePageSlots({ primaryRun, otherRuns }) {
  const byTarget = new Map();
  for (const run of otherRuns) {
    const page = run.pages[0];
    if (!page?.replacesPageId) continue;
    const list = byTarget.get(page.replacesPageId) ?? [];
    list.push({ run, page });
    byTarget.set(page.replacesPageId, list);
  }

  const resolve = pageId => {
    const candidates = byTarget.get(pageId);
    if (!candidates?.length) return null;
    return candidates.reduce((latest, candidate) =>
      new Date(candidate.run.createdAt) > new Date(latest.run.createdAt)
        ? candidate
        : latest
    );
  };

  const slots = primaryRun.pages.map(originalPage => {
    let current = { run: primaryRun, page: originalPage };
    for (
      let next = resolve(current.page.pageId);
      next;
      next = resolve(current.page.pageId)
    ) {
      current = next;
    }
    return {
      originalPageId: originalPage.pageId,
      currentRunId: current.run.runId,
      currentPageId: current.page.pageId,
      currentPage: current.page,
    };
  });

  return {
    slots,
    regenerationsUsed: otherRuns.filter(
      r => r.regenerationKind === "candidate_regeneration"
    ).length,
    replacementsUsed: otherRuns.filter(
      r => r.regenerationKind === "photo_replacement"
    ).length,
  };
}

export function canContinueReview(slots) {
  return (
    slots.length > 0 &&
    slots.every(slot => slot.currentPage.state === "approved")
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter web test`
Expected: PASS (all 5 tests)

- [ ] **Step 6: Commit**

```bash
git add apps/web/vitest.config.js apps/web/package.json apps/web/hooks/reconcile-page-slots.js apps/web/hooks/reconcile-page-slots.test.js
git commit -m "feat(web): add page-slot reconciliation function with vitest coverage"
```

---

## Task 2: `api-client.js` additions + `use-artifact-access.js`

**Files:**

- Modify: `apps/web/api-client.js`
- Create: `apps/web/hooks/use-artifact-access.js`

**Interfaces:**

- Produces, on the object `useApiClient()` returns: `listBookRuns(bookId)`, `reviewCandidate(bookId, pageId, { candidateId, decision, notes })`, `regeneratePage(bookId, pageId)`, `createPhotoReplacement(bookId, pageId, { contentType, byteSize, sha256 })`, `getArtifactAccess(artifactId)`. Tasks 3 and 4 call these by name exactly as listed.
- Produces: `useArtifactAccess(artifactId): { url: string | null, isLoading: boolean }` — `url` is a `blob:` URL safe to put directly in an `<img src>`, since `getArtifactAccess`'s own URL still requires the Bearer token to fetch (recall from the earlier handoff work: it is not a plain public URL). Tasks 5 and 6 use this for every candidate/source/cover thumbnail.

- [ ] **Step 1: Implement the five methods**

Add to the object returned by `useApiClient()` (`api-client.js:92-150`), following the existing `request(...)` pattern:

```js
/** GET /v1/books/:bookId/runs → { runs: BookRunSummary[] } — note: the
 * Worker returns raw snake_case columns here (the one endpoint that
 * does), so this method maps them to camelCase before returning. */
listBookRuns: async bookId => {
  const result = await request("GET", `/v1/books/${bookId}/runs`);
  return {
    runs: result.runs.map(run => ({
      runId: run.run_id,
      bookId: run.book_id,
      status: run.status,
      stylePackVersion: run.style_pack_version,
      costCeilingMicros: run.cost_ceiling_micros,
      costSpentMicros: run.cost_spent_micros,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      completedAt: run.completed_at,
    })),
  };
},

/** POST /v1/books/:bookId/pages/:pageId/reviews → { reviewId, pageId, candidateId, decision } */
reviewCandidate: (bookId, pageId, data) =>
  request("POST", `/v1/books/${bookId}/pages/${pageId}/reviews`, {
    body: data,
    withIdempotency: true,
  }),

/** POST /v1/books/:bookId/pages/:pageId/regenerations → { bookId, sourcePageId, runId, pageId } */
regeneratePage: (bookId, pageId) =>
  request("POST", `/v1/books/${bookId}/pages/${pageId}/regenerations`, {
    withIdempotency: true,
  }),

/** POST /v1/books/:bookId/pages/:pageId/photo-replacements → { bookId, runId, pageId, sourcePageId, upload } */
createPhotoReplacement: (bookId, pageId, data) =>
  request("POST", `/v1/books/${bookId}/pages/${pageId}/photo-replacements`, {
    body: data,
    withIdempotency: true,
  }),

/** GET /v1/artifacts/:id/access → { access: SignedArtifactRequest } — still
 * requires the Bearer token even once you have the URL back. */
getArtifactAccess: artifactId => request("GET", `/v1/artifacts/${artifactId}/access`),
```

- [ ] **Step 2: Implement `useArtifactAccess`**

No `useEffect`: the fetch-then-blob-URL conversion is exactly what `useQuery`'s `queryFn` is for, same as every other data-fetching hook in this codebase.

```js
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";

/**
 * getArtifactAccess returns a signed URL that still requires the Bearer
 * token to fetch — this hook does that authenticated fetch once and hands
 * back a local blob: URL an <img> can use directly. staleTime: Infinity
 * because artifact content never changes once uploaded, so there's no
 * reason to refetch or recreate the blob URL for the same id. Blob URLs
 * aren't explicitly revoked (that would need an unmount effect this hook
 * deliberately doesn't have) — the browser reclaims them on navigation,
 * and a single review screen only ever holds a handful at once.
 */
export function useArtifactAccess(artifactId) {
  const api = useApiClient();
  const query = useQuery({
    queryKey: ["artifact-access", artifactId],
    queryFn: async () => {
      const { access } = await api.getArtifactAccess(artifactId);
      const response = await fetch(access.url, {
        method: access.method,
        headers: access.headers,
      });
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },
    enabled: Boolean(artifactId),
    staleTime: Infinity,
  });

  return { url: query.data ?? null, isLoading: query.isLoading };
}
```

- [ ] **Step 3: Verify**

No automated test for either file in isolation (`api-client.js` has none today; `useArtifactAccess` calls `useAuth()`/`useEffect`, which need React-hook test infra this repo doesn't have — see the design doc's test-strategy decision, which scoped vitest to the pure functions in Tasks 1 and 4 only). Verified instead by Tasks 5–6, which use both through real screens and the Playwright suite.

Run: `pnpm --filter web build` (confirms no syntax/type errors reach the bundler)
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/web/api-client.js apps/web/hooks/use-artifact-access.js
git commit -m "feat(web): add listBookRuns, reviewCandidate, regeneratePage, createPhotoReplacement, getArtifactAccess to api-client, plus useArtifactAccess hook"
```

---

## Task 3: `use-book-pages.js` — shared read-only hook

**Files:**

- Create: `apps/web/hooks/use-book-pages.js`

**Interfaces:**

- Consumes: `reconcilePageSlots` (Task 1), `listBookRuns`/`getBookRun` (Task 2 / existing `use-book-run.js` pattern).
- Produces: `useBookPages(bookId, primaryRunId): { slots, regenerationsUsed, replacementsUsed, isLoading }`. Task 4's `usePageReview` and Task 6's preview page both call this by name.

- [ ] **Step 1: Implement**

```js
import { useQuery } from "@tanstack/react-query";
import { useApiClient, UnauthorizedError } from "../api-client.js";
import { useNavigate } from "@tanstack/react-router";
import { reconcilePageSlots } from "./reconcile-page-slots.js";

/**
 * Resolves the current page per slot for a book, across however many
 * regeneration/photo-replacement runs it has accumulated beyond its
 * primary run. Shared by the review and preview screens.
 */
export function useBookPages(bookId, primaryRunId) {
  const api = useApiClient();
  const navigate = useNavigate();

  const query = useQuery({
    queryKey: ["book-pages", bookId, primaryRunId],
    queryFn: async () => {
      try {
        const [primaryRun, { runs }] = await Promise.all([
          api.getBookRun(bookId, primaryRunId),
          api.listBookRuns(bookId),
        ]);
        const otherRunIds = runs
          .map(run => run.runId)
          .filter(runId => runId !== primaryRunId);
        const otherRuns = await Promise.all(
          otherRunIds.map(runId => api.getBookRun(bookId, runId))
        );
        return reconcilePageSlots({ primaryRun, otherRuns });
      } catch (err) {
        if (err instanceof UnauthorizedError) {
          navigate({ to: "/sign-in" });
          return null;
        }
        throw err;
      }
    },
    enabled: Boolean(bookId && primaryRunId),
    refetchInterval: query => {
      const data = query.state.data;
      if (!data) return false;
      // Keep polling while any slot is mid-generation (same statuses
      // use-book-run.js treats as active for a single run).
      const ACTIVE_PAGE_STATES = new Set([
        "created",
        "analyzing",
        "generating",
        "print_qa",
        "style_qa",
        "repairing",
      ]);
      return data.slots.some(slot =>
        ACTIVE_PAGE_STATES.has(slot.currentPage.state)
      )
        ? 2000
        : false;
    },
  });

  return {
    slots: query.data?.slots ?? [],
    regenerationsUsed: query.data?.regenerationsUsed ?? 0,
    replacementsUsed: query.data?.replacementsUsed ?? 0,
    isLoading: query.isLoading,
  };
}
```

- [ ] **Step 2: Verify**

No automated test for this task in isolation — see Task 2's note; this hook is exercised by Task 5's Playwright coverage (and transitively by Task 6's).

Run: `pnpm --filter web build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/web/hooks/use-book-pages.js
git commit -m "feat(web): add useBookPages hook wiring page-slot reconciliation to live polling"
```

---

## Task 4: `use-page-review.js` + shared `sha256Hex` extraction

**Files:**

- Modify: `apps/web/pages/photo-selection-page.jsx:14-18` (extract `sha256Hex`)
- Create: `apps/web/sha256.js`
- Create: `apps/web/hooks/use-page-review.js`
- Test: `apps/web/hooks/use-page-review.test.js`

**Interfaces:**

- Consumes: `useBookPages` (Task 3), `canContinueReview` (Task 1), `reviewCandidate`/`regeneratePage`/`createPhotoReplacement`/`uploadPhoto`/`startBookRun` (Task 2 / existing `api-client.js`).
- Produces: `replacePhotoSequence({ api, bookId, pageId, file, sha256Hex }): Promise<void>` (plain async function, no React — independently testable; Step 2 below). Produces: `usePageReview(bookId, primaryRunId): { slots, regenerationsUsed, regenerationsRemaining, replacementsUsed, replacementsRemaining, canContinue, keepPage(pageId, candidateId), tryAgain(pageId), replacePhoto(pageId, file) }`. Task 5's review screen calls this by name.

- [ ] **Step 1: Extract `sha256Hex` into a shared file**

Move the existing `sha256Hex` function out of `photo-selection-page.jsx:14-18` into `apps/web/sha256.js`:

```js
export async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}
```

Update `photo-selection-page.jsx` to `import { sha256Hex } from "../sha256.js";` and delete its local copy.

- [ ] **Step 2: Write the failing test for `replacePhotoSequence`**

```js
import { describe, expect, it, vi } from "vitest";
import { replacePhotoSequence } from "./use-page-review.js";

describe("replacePhotoSequence", () => {
  it("uploads then starts the run, in order", async () => {
    const calls = [];
    const api = {
      createPhotoReplacement: vi.fn(async () => {
        calls.push("createPhotoReplacement");
        return {
          runId: "run-x",
          upload: { uploadUrl: "https://x", requiredHeaders: {} },
        };
      }),
      uploadPhoto: vi.fn(async () => {
        calls.push("uploadPhoto");
      }),
      startBookRun: vi.fn(async () => {
        calls.push("startBookRun");
      }),
    };
    await replacePhotoSequence({
      api,
      bookId: "book-1",
      pageId: "page-1",
      file: { type: "image/jpeg", size: 100 },
      sha256Hex: async () => "a".repeat(64),
    });
    expect(calls).toEqual([
      "createPhotoReplacement",
      "uploadPhoto",
      "startBookRun",
    ]);
    expect(api.startBookRun).toHaveBeenCalledWith("book-1", "run-x");
  });

  it("does not start the run when the upload fails", async () => {
    const api = {
      createPhotoReplacement: vi.fn(async () => ({
        runId: "run-x",
        upload: { uploadUrl: "https://x", requiredHeaders: {} },
      })),
      uploadPhoto: vi.fn(async () => {
        throw new Error("network drop");
      }),
      startBookRun: vi.fn(async () => {}),
    };
    await expect(
      replacePhotoSequence({
        api,
        bookId: "book-1",
        pageId: "page-1",
        file: { type: "image/jpeg", size: 100 },
        sha256Hex: async () => "a".repeat(64),
      })
    ).rejects.toThrow("network drop");
    expect(api.startBookRun).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test -- use-page-review`
Expected: FAIL — `replacePhotoSequence` is not exported yet.

- [ ] **Step 4: Implement `replacePhotoSequence` and `usePageReview`**

```js
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "../api-client.js";
import { useBookPages } from "./use-book-pages.js";
import { canContinueReview } from "./reconcile-page-slots.js";
import { sha256Hex } from "../sha256.js";

const CAP = 3;

/** Plain async function, no React — independently testable (Step 2). */
export async function replacePhotoSequence({
  api,
  bookId,
  pageId,
  file,
  sha256Hex: hashFn,
}) {
  const sha256 = await hashFn(file);
  const { runId, upload } = await api.createPhotoReplacement(bookId, pageId, {
    contentType: file.type,
    byteSize: file.size,
    sha256,
  });
  await api.uploadPhoto(upload.uploadUrl, upload.requiredHeaders, file);
  await api.startBookRun(bookId, runId);
}

export function usePageReview(bookId, primaryRunId) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { slots, regenerationsUsed, replacementsUsed, isLoading } =
    useBookPages(bookId, primaryRunId);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["book-pages", bookId, primaryRunId],
    });

  const keepMutation = useMutation({
    mutationFn: ({ pageId, candidateId }) =>
      api.reviewCandidate(bookId, pageId, {
        candidateId,
        decision: "approved",
      }),
    onSuccess: invalidate,
  });

  const tryAgainMutation = useMutation({
    mutationFn: async pageId => {
      const slot = slots.find(s => s.currentPageId === pageId);
      // Only reject-then-regenerate when the page was actually flagged by QA
      // and hasn't been rejected yet; a plain "approved" page or an already-
      // rejected page (regenerate-only retry) skips the reviewCandidate call.
      if (slot.currentPage.state === "needs_human_review") {
        const candidateId = pickBestCandidate(slot.currentPage.candidates);
        await api.reviewCandidate(bookId, pageId, {
          candidateId,
          decision: "rejected",
        });
      }
      return api.regeneratePage(bookId, pageId);
    },
    onSuccess: invalidate,
  });

  const replaceMutation = useMutation({
    mutationFn: ({ pageId, file }) =>
      replacePhotoSequence({ api, bookId, pageId, file, sha256Hex }),
    onSuccess: invalidate,
  });

  const canContinue = canContinueReview(slots);

  return {
    slots,
    isLoading,
    regenerationsUsed,
    regenerationsRemaining: Math.max(0, CAP - regenerationsUsed),
    replacementsUsed,
    replacementsRemaining: Math.max(0, CAP - replacementsUsed),
    canContinue,
    keepPage: (pageId, candidateId) =>
      keepMutation.mutateAsync({ pageId, candidateId }),
    tryAgain: pageId => tryAgainMutation.mutateAsync(pageId),
    replacePhoto: (pageId, file) =>
      replaceMutation.mutateAsync({ pageId, file }),
  };
}

/** Highest styleQa.score wins — matches the server's own best-candidate
 * selection as closely as the API response allows (ordinal isn't exposed). */
function pickBestCandidate(candidates) {
  return candidates.reduce((best, candidate) =>
    (candidate.styleQa.score ?? -Infinity) > (best.styleQa.score ?? -Infinity)
      ? candidate
      : best
  ).candidateId;
}
```

Note: this implementation does not yet special-case "`rejected`, no replacement in flight" (retry the paired `regeneratePage` call alone, without calling `reviewCandidate` again) — `tryAgainMutation` as written only looks at `needs_human_review`. Task 5's Review Focus test below exercises this gap; fix it there once the review screen makes the missing branch concrete (a page whose `currentPage.state === "rejected"` should call `api.regeneratePage` directly, skipping `reviewCandidate`).

- [ ] **Step 5: Run the `replacePhotoSequence` test to verify it passes**

Run: `pnpm --filter web test -- use-page-review`
Expected: PASS (both tests from Step 2)

- [ ] **Step 6: Verify the rest of the hook**

The `keepMutation`/`tryAgainMutation`/`canContinue` wiring has no automated test in isolation (same reasoning as Tasks 2–3) — exercised by Task 5's Playwright coverage, where the `rejected`-retry branch above gets filled in and tested together.

Run: `pnpm --filter web build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/pages/photo-selection-page.jsx apps/web/sha256.js apps/web/hooks/use-page-review.js apps/web/hooks/use-page-review.test.js
git commit -m "feat(web): add usePageReview hook with keep/tryAgain/replacePhoto actions"
```

---

## Task 5: `page-review-page.jsx` — the review screen

**Files:**

- Create: `apps/web/pages/page-review-page.jsx`
- Create: `apps/web/pages/page-review-page.module.css`
- Modify: `apps/web/pages/processing-page.jsx:25`
- Modify: `apps/web/app.jsx` (import + route)
- Modify: `apps/web/hooks/use-page-review.js` (fill in the `rejected`-retry branch flagged in Task 4)
- Modify: `docs/customer-screen-api-map.yaml`
- Test: `apps/web/e2e/page-review.spec.js`

**Interfaces:**

- Consumes: `usePageReview` (Task 4), `useArtifactAccess` (Task 2).
- Produces: route `/books/new/pages`, component `PageReviewPage`. Its "Continue" action navigates to `/books/new/preview` — that route doesn't exist until Task 6 lands, so wire the `navigate()` call now pointing at it regardless.

- [ ] **Step 1: Fill in the `rejected`-retry branch in `use-page-review.js`**

In `tryAgainMutation`'s `mutationFn` (Task 4), add a branch before the existing `needs_human_review` check:

```js
if (slot.currentPage.state === "rejected") {
  // The paired reviewCandidate(rejected) call already went through on a
  // previous attempt; reviewCandidate is one-way, so only retry the
  // regeneratePage half.
  return api.regeneratePage(bookId, pageId);
}
```

- [ ] **Step 2: Write the failing e2e test**

Mirror the shallow rendering style already used in `apps/web/e2e/book-creation.spec.js` (navigate with fabricated ids, assert static structure — this repo's e2e suite doesn't seed live backend state):

```js
import { expect, test } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

test.describe("page review", () => {
  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "ticket",
        ticket: process.env.E2E_CLERK_TICKET,
      },
    });
    await page.goto("/books");
  });

  test.afterEach(async ({ page }) => {
    await clerk.signOut({ page });
  });

  test("renders the review grid heading", async ({ page }) => {
    await page.goto("/books/new/pages?bookId=test-book-id&runId=test-run-id");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("does not use the wizard step chrome", async ({ page }) => {
    await page.goto("/books/new/pages?bookId=test-book-id&runId=test-run-id");
    await expect(page.getByText(/Step \d of \d/)).toHaveCount(0);
  });
});
```

(Copy the exact `beforeEach`/`afterEach` Clerk sign-in boilerplate from `apps/web/e2e/book-creation.spec.js:45-60` rather than retyping it — it must match exactly for the testing token to work.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter web test:e2e -- page-review.spec.js`
Expected: FAIL — route doesn't exist (404/blank page).

- [ ] **Step 4: Implement `PageReviewPage`**

Grid-hub + detail-drill-in, per the design doc's "Approach" and "Decision actions per page state" sections:

- Landing view: one card per `slots` entry (thumbnail via `useArtifactAccess(artifactId)`, status pill from `currentPage.state`), click opens detail.
- Detail view: candidate image, compare-with-source toggle, and the actions for that state:
  - `approved`: "Keep" → `keepPage`, "Try another version" → `tryAgain`.
  - `needs_human_review`: "Use this page anyway" → `keepPage`, "Try again" → `tryAgain`.
  - `rejected` / mid-flight (a run exists replacing this slot but hasn't resolved to `approved` yet): no actions, "Making a new version…" badge.
  - `rejected`, no replacement in flight (`tryAgain` not yet called again): "Try again" → `tryAgain` (now handled per Step 1).
  - `provider_failed` / `budget_exhausted`: "Try again" → `tryAgain`, "Contact support" link — **unless** `regenerationsRemaining === 0`, in which case only "Contact support" shows.
  - `intake_rejected` / `intake_needs_review`: show `currentPage.terminalReason`, "Upload a different photo" (file input → `replacePhoto`) — **unless** `replacementsRemaining === 0`, in which case only "Contact support" shows.
- A persistent banner when `regenerationsRemaining === 0` ("You've used all 3 free revisions for this book…") and a separate one when `replacementsRemaining === 0`, independent of each other.
- "Continue" button on the grid: `disabled={!canContinue}`, `onClick` navigates to `/books/new/preview` with `{ bookId, runId: primaryRunId }` search params.
- No `WizardShell` — wrap content in `AppShell` directly (`import { AppShell } from "../app-shell.jsx"`).

Route and wiring in `app.jsx`:

```js
import { PageReviewPage } from "./pages/page-review-page.jsx";
// ...
const pageReviewRoute = createRoute({
  getParentRoute: () => authedLayout,
  path: "/books/new/pages",
  component: PageReviewPage,
});
// add pageReviewRoute to authedLayout.addChildren([...])
```

In `processing-page.jsx:25`, change:

```js
navigate({ to: "/books/new/pages", search: { bookId, runId } });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web test:e2e -- page-review.spec.js`
Expected: PASS

- [ ] **Step 6: Update `docs/customer-screen-api-map.yaml`**

Per the design doc: replace the existing `review` / `needs-attention` two-screen entries (route `/books/new/pages/review` and `/books/new/pages/needs-attention`) with one entry for this screen at route `/books/new/pages`, component `apps/web/pages/page-review-page.jsx`, listing the real operations it now uses (`getBookRun`, `listBookRuns`, `getArtifactAccess`, `reviewCandidate`, `regeneratePage`, `createPhotoReplacement`) in place of the old single-screen, single-decision description.

- [ ] **Step 7: Commit**

```bash
git add apps/web/pages/page-review-page.jsx apps/web/pages/page-review-page.module.css apps/web/pages/processing-page.jsx apps/web/app.jsx apps/web/hooks/use-page-review.js apps/web/e2e/page-review.spec.js docs/customer-screen-api-map.yaml
git commit -m "feat(web): add real candidate-review screen, replacing the dead end after processing"
```

---

## Task 6: `book-preview-page.jsx` — the preview screen

**Files:**

- Create: `apps/web/pages/book-preview-page.jsx`
- Create: `apps/web/pages/book-preview-page.module.css`
- Modify: `apps/web/app.jsx` (import + route)
- Modify: `docs/customer-screen-api-map.yaml`
- Test: `apps/web/e2e/book-preview.spec.js`

**Interfaces:**

- Consumes: `useBookPages` (Task 3), `useArtifactAccess` (Task 2) — read-only, no mutations.
- Produces: route `/books/new/preview`, component `BookPreviewPage`.

- [ ] **Step 1: Write the failing e2e test**

```js
import { expect, test } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

test.describe("book preview", () => {
  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "ticket",
        ticket: process.env.E2E_CLERK_TICKET,
      },
    });
    await page.goto("/books");
  });

  test.afterEach(async ({ page }) => {
    await clerk.signOut({ page });
  });

  test("renders the preview heading and a back-to-review link", async ({
    page,
  }) => {
    await page.goto("/books/new/preview?bookId=test-book-id&runId=test-run-id");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /back to page review/i })
    ).toBeVisible();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web test:e2e -- book-preview.spec.js`
Expected: FAIL — route doesn't exist.

- [ ] **Step 3: Implement `BookPreviewPage`**

Based on `apps/web/screens/BookPreviewScreen.jsx`, minus the fake cover (the real book model has no cover concept — spread real pages two at a time, starting from page 1; the last spread has one page when the count is odd):

- Read `slots` from `useBookPages(bookId, primaryRunId)`; render each slot's `currentPage` candidate image via `useArtifactAccess`, two per spread, with prev/next spread controls.
- "Back to page review" → navigate to `/books/new/pages`.
- "Choose an edition" → `TODO`: edition/checkout routes don't exist yet; navigate target is a placeholder (leave as a comment, matching how `processing-page.jsx`'s redirect was a placeholder before this plan).
- No `WizardShell`, same reasoning as Task 5.

```js
import { PageReviewPage } from "./pages/page-review-page.jsx";
import { BookPreviewPage } from "./pages/book-preview-page.jsx";
// ...
const bookPreviewRoute = createRoute({
  getParentRoute: () => authedLayout,
  path: "/books/new/preview",
  component: BookPreviewPage,
});
// add bookPreviewRoute to authedLayout.addChildren([...])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web test:e2e -- book-preview.spec.js`
Expected: PASS

- [ ] **Step 5: Update `docs/customer-screen-api-map.yaml`**

Per the design doc: update the existing `preview` entry's `component` to `apps/web/pages/book-preview-page.jsx` and drop its fake-cover behavior note (the real screen has no cover concept — see Task 6 Step 3).

- [ ] **Step 6: Run the full suite**

Run: `pnpm --filter web test && pnpm --filter web test:e2e && pnpm --filter web build`
Expected: all PASS, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/pages/book-preview-page.jsx apps/web/pages/book-preview-page.module.css apps/web/app.jsx apps/web/e2e/book-preview.spec.js docs/customer-screen-api-map.yaml
git commit -m "feat(web): add real book preview screen after candidate review"
```
