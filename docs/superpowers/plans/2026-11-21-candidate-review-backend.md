# Candidate Review — Backend (pipeline-cloudflare) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `apps/pipeline-cloudflare` the three pieces of new backend surface the candidate-review design needs: a per-kind regeneration/replacement cap, a new photo-replacement endpoint, and cross-run lineage exposed through `getBookRun`.

**Architecture:** All changes live in `apps/pipeline-cloudflare/src/api/pipelineApi.ts` (+ `router.ts` for one new route) and one new migration. The photo-replacement endpoint is built by mirroring the existing `createBookRun`/`startBookRun` upload-intent flow for a single photo, reusing `startBookRun` unchanged for the "finish and launch" half. Lineage (`book_run_regenerations`) gains a `kind` column so one table/mechanism covers both candidate-regenerations and photo-replacements.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), vitest with `cloudflare:test` (`applyD1Migrations`, `env.PIPELINE_DB`).

**Spec:** `docs/superpowers/specs/2026-11-21-candidate-review-design.md` — sections "Two separate caps", "Photo replacement (intake rejection recovery)", "Key mechanism: resolving 'the current page' across runs".

**Not in this plan:** `apps/web` (separate plan: `docs/superpowers/plans/2026-11-21-candidate-review-frontend.md`, depends on this one being merged first). The intake-rejection analysis fix is already merged separately (PR #27) and is a precondition, not part of this plan.

## Global Constraints

- Run all commands from the repo root with `pnpm --filter pipeline-cloudflare ...`.
- The regeneration cap and the photo-replacement cap are **independent**, 3 each, per `(bookId, requested_by)`.
- `book_run_regenerations.kind` defaults to `'candidate_regeneration'` for backward compatibility with existing rows/callers.
- Never commit secrets; `GEMINI_API_KEY` etc. stay in Wrangler secrets, not code.
- New SQL joins that scope by ownership must match the existing inline style in `regeneratePage`/`reviewCandidate` (join through to `books.owner_id`), not a new abstraction.

## Review Focus

- A photo-replacement call targeting a page that is **not** `intake_rejected`/`intake_needs_review` (e.g. already `approved`) — must be rejected, not silently accepted.
- The two caps must not leak into each other — hitting the regeneration cap must not block a photo replacement on a different page, and vice versa.
- `getBookRun` on the **primary** run must return `replacesPageId: null` and `regenerationKind: null` for every page — the lineage fields must not appear on runs that aren't regenerations/replacements.
- A stranger (non-owner) calling the new photo-replacement endpoint on someone else's book must get a 404, matching the existing ownership-check pattern used by `regeneratePage`/`reviewCandidate`.
- Idempotent replay of the photo-replacement call with the same `Idempotency-Key` must return the exact same response, not create a second run (the `mutate()` wrapper already guarantees this for every other mutation — a new endpoint must use it the same way).

---

## Task 1: `kind` column on `book_run_regenerations`

**Files:**

- Create: `apps/pipeline-cloudflare/migrations/0009_regeneration_kind.sql`
- Test: `apps/pipeline-cloudflare/test/wp6Api.test.ts` (new `it` block, near the existing `book_run_regenerations` assertions)

**Interfaces:**

- Produces: a `kind TEXT NOT NULL DEFAULT 'candidate_regeneration' CHECK (kind IN ('candidate_regeneration', 'photo_replacement'))` column, used by Tasks 2–4.

- [ ] **Step 1: Write the failing test**

```ts
it("defaults book_run_regenerations.kind and rejects invalid values", async () => {
  const timestamp = new Date("2026-11-10T12:00:00.000Z").toISOString();
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(
      `INSERT INTO books (book_id, owner_id, status, created_at, updated_at)
       VALUES ('book-kind-test', 'user-owner', 'review', ?, ?)`
    ).bind(timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO book_runs VALUES ('run-kind-a', 'book-kind-test', 'completed', 'pictobook-preschool-v0.1', 7000, 0, ?, ?, ?)`
    ).bind(timestamp, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO book_runs VALUES ('run-kind-b', 'book-kind-test', 'created', 'pictobook-preschool-v0.1', 7000, 0, ?, ?, NULL)`
    ).bind(timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO pages (page_id, run_id, photo_id, state, initial_candidate_count, repair_round_count, approved_candidate_id, approval_source, terminal_reason, created_at, updated_at)
       VALUES ('page-kind-a', 'run-kind-a', 'photo-kind-a', 'approved', 0, 0, NULL, NULL, NULL, ?, ?)`
    ).bind(timestamp, timestamp),
  ]);
  await env.PIPELINE_DB.prepare(
    `INSERT INTO book_run_regenerations (new_run_id, source_run_id, source_page_id, requested_by, created_at)
     VALUES ('run-kind-b', 'run-kind-a', 'page-kind-a', 'user-owner', ?)`
  )
    .bind(timestamp)
    .run();
  expect(
    await scalar(
      "SELECT kind FROM book_run_regenerations WHERE new_run_id = 'run-kind-b'"
    )
  ).toBe("candidate_regeneration");
  await expect(
    env.PIPELINE_DB.prepare(
      `UPDATE book_run_regenerations SET kind = 'not_a_real_kind' WHERE new_run_id = 'run-kind-b'`
    ).run()
  ).rejects.toThrow();
});
```

(Use whatever local `scalar()` helper the file already defines for single-value queries; if none exists yet, add one: `const scalar = async (sql: string) => Object.values((await env.PIPELINE_DB.prepare(sql).first()) ?? {})[0];`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter pipeline-cloudflare test -- -t "defaults book_run_regenerations.kind"`
Expected: FAIL — `no such column: kind`.

- [ ] **Step 3: Write the migration**

```sql
ALTER TABLE book_run_regenerations
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'candidate_regeneration'
  CHECK (kind IN ('candidate_regeneration', 'photo_replacement'));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter pipeline-cloudflare test -- -t "defaults book_run_regenerations.kind"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline-cloudflare/migrations/0009_regeneration_kind.sql apps/pipeline-cloudflare/test/wp6Api.test.ts
git commit -m "feat(pipeline-cloudflare): add kind column to book_run_regenerations"
```

---

## Task 2: Regeneration cap + `kind` on `regeneratePage`

**Files:**

- Modify: `apps/pipeline-cloudflare/src/api/pipelineApi.ts:778-900` (`regeneratePage`), and the `INSERT INTO book_run_regenerations` statement within it
- Test: `apps/pipeline-cloudflare/test/wp6Api.test.ts`

**Interfaces:**

- Consumes: `book_run_regenerations.kind` (Task 1).
- Produces: `private async countRegenerations(bookId: string, requestedBy: string, kind: "candidate_regeneration" | "photo_replacement"): Promise<number>` on `PipelineApi` — Task 3 reuses this unchanged.
- Produces: `ApiProblem(403, "regeneration_limit_reached")` as the error code the frontend plan's mutation wrapper matches on.

- [ ] **Step 1: Write the failing test**

```ts
it("caps regeneratePage at 3 per book per customer", async () => {
  const seeded = await seedReviewablePage(); // existing helper, needs_human_review page
  await api.reviewCandidate(
    owner,
    "approve-for-cap-001",
    seeded.bookId,
    seeded.pageId,
    {
      candidateId: seeded.candidateId,
      decision: "approved",
    }
  );
  for (let i = 0; i < 3; i += 1) {
    const result = await api.regeneratePage(
      owner,
      `regen-cap-${i}`,
      seeded.bookId,
      seeded.pageId
    );
    expect(result.status).toBe(202);
  }
  await expect(
    api.regeneratePage(owner, "regen-cap-4th", seeded.bookId, seeded.pageId)
  ).rejects.toMatchObject({ status: 403, code: "regeneration_limit_reached" });
  expect(
    await scalar(
      "SELECT count(*) FROM book_run_regenerations WHERE kind = 'candidate_regeneration'"
    )
  ).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter pipeline-cloudflare test -- -t "caps regeneratePage"`
Expected: FAIL — the 4th call currently succeeds (202), assertion fails.

- [ ] **Step 3: Implement the cap check and `kind` write in `regeneratePage`**

Add `countRegenerations`:

```ts
private async countRegenerations(
  bookId: string,
  requestedBy: string,
  kind: "candidate_regeneration" | "photo_replacement"
): Promise<number> {
  const row = await this.database
    .prepare(
      `SELECT count(*) AS count FROM book_run_regenerations br
       JOIN book_runs r ON r.run_id = br.new_run_id
       WHERE r.book_id = ? AND br.requested_by = ? AND br.kind = ?`
    )
    .bind(bookId, requestedBy, kind)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
```

In `regeneratePage`, immediately after `this.assertGenerationProviderAvailable();` (pipelineApi.ts:786): if `(await this.countRegenerations(bookId, principal.userId, "candidate_regeneration")) >= 3`, `throw new ApiProblem(403, "regeneration_limit_reached");`.

In the existing `INSERT INTO book_run_regenerations` statement (pipelineApi.ts:874-887), add `kind` as a 6th bound column with value `"candidate_regeneration"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter pipeline-cloudflare test -- -t "caps regeneratePage"`
Expected: PASS

- [ ] **Step 5: Run the full suite to check for regressions**

Run: `pnpm --filter pipeline-cloudflare test`
Expected: all PASS (existing `regeneratePage` tests, e.g. the one at wp6Api.test.ts:569-577, must still pass unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline-cloudflare/src/api/pipelineApi.ts apps/pipeline-cloudflare/test/wp6Api.test.ts
git commit -m "feat(pipeline-cloudflare): cap regeneratePage at 3 per book per customer"
```

---

## Task 3: `createPhotoReplacement` endpoint

**Files:**

- Modify: `apps/pipeline-cloudflare/src/api/pipelineApi.ts` (new method, placed near `regeneratePage`)
- Modify: `apps/pipeline-cloudflare/src/api/router.ts` (new route, mirroring the `regenerations` route at router.ts:310-322)
- Test: `apps/pipeline-cloudflare/test/wp6Api.test.ts`

**Interfaces:**

- Consumes: `countRegenerations` (Task 2), `this.signIntent(intent: UploadIntentRow)` (existing, pipelineApi.ts:1256), `validatePhotos` (existing, pipelineApi.ts:1467), `objectKeys.sourcePhoto` (existing import), `this.maximumCostPerPageMicros()` (existing), `this.generation.*` fields (existing: `provider`, `model`, `styleJudgeModel`, `candidateCostMicros`, `styleJudgeCostMicros`, `initialCandidateCount`).
- Produces: `PipelineApi.createPhotoReplacement(principal, key, bookId, pageId, input: { contentType, byteSize, sha256 }): Promise<ApiResponse>`, returning `{ status: 201, body: { bookId, runId, pageId, sourcePageId, upload } }` where `upload` has the same shape `signIntent` already returns (`{ uploadIntentId, photoId, artifactId, uploadUrl, expiresAt, requiredHeaders }`). Route: `POST /v1/books/:bookId/pages/:pageId/photo-replacements`.

- [ ] **Step 1: Write the failing test**

Add a `seedIntakeRejectedPage()` helper next to `seedReviewablePage` (same file), walking the trigger's allowed path instead of the QA path:

```ts
const seedIntakeRejectedPage = async () => {
  const timestamp = new Date("2026-11-10T12:00:00.000Z").toISOString();
  const bookId = "book-intake-owner";
  const runId = "run-intake-owner";
  const photoId = "photo-intake-owner";
  const pageId = "page-intake-owner";
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(
      `INSERT INTO books (book_id, owner_id, status, created_at, updated_at)
       VALUES (?, ?, 'review', ?, ?)`
    ).bind(bookId, "user-owner", timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO book_runs VALUES (?, ?, 'partially_completed', 'pictobook-preschool-v0.1', 7000, 0, ?, ?, ?)"
    ).bind(runId, bookId, timestamp, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO photos VALUES (?, ?, 1, ?, 'pending', ?)"
    ).bind(photoId, runId, `source:${photoId}`, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO pages
       (page_id, run_id, photo_id, state, initial_candidate_count,
        repair_round_count, approved_candidate_id, approval_source,
        terminal_reason, created_at, updated_at)
       VALUES (?, ?, ?, 'created', 0, 0, NULL, NULL, NULL, ?, ?)`
    ).bind(pageId, runId, photoId, timestamp, timestamp),
  ]);
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'analyzing' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'intake_rejected', terminal_reason = 'too_dark' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  return { bookId, runId, pageId };
};
```

```ts
it("creates a photo-replacement upload for an intake-rejected page", async () => {
  const seeded = await seedIntakeRejectedPage();
  const created = await api.createPhotoReplacement(
    owner,
    "photo-replacement-001",
    seeded.bookId,
    seeded.pageId,
    { contentType: "image/jpeg", byteSize: 1024, sha256: "a".repeat(64) }
  );
  expect(created.status).toBe(201);
  expect(created.body.sourcePageId).toBe(seeded.pageId);
  expect(
    String((created.body.upload as { uploadUrl: string }).uploadUrl)
  ).toContain("signature=test");
  expect(
    await scalar("SELECT kind FROM book_run_regenerations WHERE new_run_id = ?")
  ); // adapt scalar() to take bound params, or inline the runId from created.body.runId
  expect(await scalar("SELECT state FROM pages WHERE page_id = ?")); // same — assert the new page row is 'created', not 'intake_rejected'
});

it("rejects a photo replacement for a page that isn't intake-rejected", async () => {
  const seeded = await seedReviewablePage(); // needs_human_review, not intake_rejected
  await expect(
    api.createPhotoReplacement(
      owner,
      "photo-replacement-002",
      seeded.bookId,
      seeded.pageId,
      {
        contentType: "image/jpeg",
        byteSize: 1024,
        sha256: "b".repeat(64),
      }
    )
  ).rejects.toMatchObject({ status: 409, code: "page_not_replaceable" });
});

it("caps photo replacements at 3 per book, independently of regeneratePage's cap in both directions", async () => {
  const reviewable = await seedReviewablePage();
  await api.reviewCandidate(
    owner,
    "approve-indep-001",
    reviewable.bookId,
    reviewable.pageId,
    {
      candidateId: reviewable.candidateId,
      decision: "approved",
    }
  );
  for (let i = 0; i < 3; i += 1) {
    expect(
      (
        await api.regeneratePage(
          owner,
          `regen-indep-${i}`,
          reviewable.bookId,
          reviewable.pageId
        )
      ).status
    ).toBe(202);
  }
  // seedIntakeRejectedPage uses a different bookId than seedReviewablePage, so make
  // this one share reviewable.bookId instead, by seeding its page directly into that book.
  const intakeRejectedPageId = "page-indep-intake";
  const timestamp = new Date("2026-11-10T12:00:00.000Z").toISOString();
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(
      "INSERT INTO book_runs VALUES ('run-indep-intake', ?, 'partially_completed', 'pictobook-preschool-v0.1', 7000, 0, ?, ?, ?)"
    ).bind(reviewable.bookId, timestamp, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO photos VALUES ('photo-indep-intake', 'run-indep-intake', 1, 'source:photo-indep-intake', 'pending', ?)"
    ).bind(timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO pages (page_id, run_id, photo_id, state, initial_candidate_count, repair_round_count, approved_candidate_id, approval_source, terminal_reason, created_at, updated_at)
       VALUES (?, 'run-indep-intake', 'photo-indep-intake', 'created', 0, 0, NULL, NULL, NULL, ?, ?)`
    ).bind(intakeRejectedPageId, timestamp, timestamp),
  ]);
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'analyzing' WHERE page_id = ?"
  )
    .bind(intakeRejectedPageId)
    .run();
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'intake_rejected', terminal_reason = 'too_dark' WHERE page_id = ?"
  )
    .bind(intakeRejectedPageId)
    .run();
  // regeneratePage's cap is already maxed on this book — createPhotoReplacement must still work.
  for (let i = 0; i < 3; i += 1) {
    expect(
      (
        await api.createPhotoReplacement(
          owner,
          `photo-replacement-cap-${i}`,
          reviewable.bookId,
          intakeRejectedPageId,
          {
            contentType: "image/jpeg",
            byteSize: 1024,
            sha256: `${i}`.repeat(64),
          }
        )
      ).status
    ).toBe(201);
  }
  await expect(
    api.createPhotoReplacement(
      owner,
      "photo-replacement-cap-4th",
      reviewable.bookId,
      intakeRejectedPageId,
      { contentType: "image/jpeg", byteSize: 1024, sha256: "c".repeat(64) }
    )
  ).rejects.toMatchObject({
    status: 403,
    code: "photo_replacement_limit_reached",
  });
  // and regeneratePage must still be blocked by its own already-maxed cap, unaffected by the 3 replacements
  await expect(
    api.regeneratePage(
      owner,
      "regen-indep-still-capped",
      reviewable.bookId,
      reviewable.pageId
    )
  ).rejects.toMatchObject({ status: 403, code: "regeneration_limit_reached" });
});

it("rejects a stranger's photo-replacement call on someone else's book", async () => {
  const seeded = await seedIntakeRejectedPage();
  await expect(
    api.createPhotoReplacement(
      stranger,
      "photo-replacement-stranger-001",
      seeded.bookId,
      seeded.pageId,
      {
        contentType: "image/jpeg",
        byteSize: 1024,
        sha256: "d".repeat(64),
      }
    )
  ).rejects.toMatchObject({ status: 404, code: "page_not_found" });
});

it("replays a photo-replacement call idempotently instead of creating a second run", async () => {
  const seeded = await seedIntakeRejectedPage();
  const first = await api.createPhotoReplacement(
    owner,
    "photo-replacement-idempotent-001",
    seeded.bookId,
    seeded.pageId,
    { contentType: "image/jpeg", byteSize: 1024, sha256: "e".repeat(64) }
  );
  const replayed = await api.createPhotoReplacement(
    owner,
    "photo-replacement-idempotent-001",
    seeded.bookId,
    seeded.pageId,
    { contentType: "image/jpeg", byteSize: 1024, sha256: "e".repeat(64) }
  );
  expect(replayed).toEqual(first);
  expect(
    await scalar(
      "SELECT count(*) FROM book_run_regenerations WHERE kind = 'photo_replacement'"
    )
  ).toBe(1);
});
```

(Adjust `scalar()`'s signature to accept bound parameters, or inline the id directly in the SQL string via template literal, matching whichever style is simpler given the rest of the file.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter pipeline-cloudflare test -- -t "photo-replacement"`
Expected: FAIL — `api.createPhotoReplacement is not a function`.

- [ ] **Step 3: Implement `createPhotoReplacement` in `pipelineApi.ts`**

Mirror `regeneratePage` (pipelineApi.ts:778-900) and `createBookRun`'s per-photo insert (pipelineApi.ts:415-485), but: single photo, `source_artifact_id = NULL` / `intake_status = 'pending'` (new upload, not a reused artifact), no `launcher.start()` call, and the cap/precondition checks below.

```ts
createPhotoReplacement(
  principal: Principal,
  key: string,
  bookId: string,
  pageId: string,
  input: { contentType: "image/jpeg" | "image/png" | "image/webp"; byteSize: number; sha256: string }
): Promise<ApiResponse> {
  return this.mutate(principal, key, `photo_replacement:${pageId}`, async stable => {
    validatePhotos([input]);
    if ((await this.countRegenerations(bookId, principal.userId, "photo_replacement")) >= 3) {
      throw new ApiProblem(403, "photo_replacement_limit_reached");
    }
    const source = await this.database
      .prepare(
        `SELECT p.run_id AS source_run_id, p.state, r.style_pack_version
         FROM pages p
         JOIN book_runs r ON r.run_id = p.run_id
         JOIN books b ON b.book_id = r.book_id
         WHERE p.page_id = ? AND r.book_id = ? AND b.owner_id = ?`
      )
      .bind(pageId, bookId, principal.userId)
      .first<{ source_run_id: string; state: string; style_pack_version: string }>();
    if (!source) throw new ApiProblem(404, "page_not_found");
    if (!["intake_rejected", "intake_needs_review"].includes(source.state)) {
      throw new ApiProblem(409, "page_not_replaceable");
    }
    // ...insert book_runs / book_run_execution_configs / photos / pages / upload_intents / book_run_regenerations,
    // following createBookRun's per-photo pattern and regeneratePage's execution-config pattern. kind: "photo_replacement".
    // ...sign the intent via this.signIntent(intent); return { status: 201, body: { bookId, runId, pageId: newPageId, sourcePageId: pageId, upload } }.
  });
}
```

(The elided middle follows `createBookRun`'s insert statements for one photo at ordinal 1 and `regeneratePage`'s `book_run_execution_configs` insert exactly — no new values to invent, just the same two patterns combined for one photo instead of N.)

Add the route in `router.ts`, right after the `regenerations` block (router.ts:310-322):

```ts
const photoReplacements = url.pathname.match(
  /^\/v1\/books\/([^/]+)\/pages\/([^/]+)\/photo-replacements$/
);
if (request.method === "POST" && photoReplacements) {
  const body = await readJson<{
    contentType?: string;
    byteSize?: number;
    sha256?: string;
  }>(request);
  if (!body.contentType || !body.byteSize || !body.sha256) {
    throw new ApiProblem(400, "invalid_photo_replacement");
  }
  return api.createPhotoReplacement(
    principal,
    idempotencyKey(request),
    safePathId(photoReplacements[1]),
    safePathId(photoReplacements[2]),
    body as {
      contentType: "image/jpeg" | "image/png" | "image/webp";
      byteSize: number;
      sha256: string;
    }
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter pipeline-cloudflare test -- -t "photo-replacement"`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `pnpm --filter pipeline-cloudflare test && pnpm --filter pipeline-cloudflare check`
Expected: all PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline-cloudflare/src/api/pipelineApi.ts apps/pipeline-cloudflare/src/api/router.ts apps/pipeline-cloudflare/test/wp6Api.test.ts
git commit -m "feat(pipeline-cloudflare): add photo-replacement endpoint for intake-rejected pages"
```

---

## Task 4: Lineage on `getBookRun` (`replacesPageId`, `regenerationKind`)

**Files:**

- Modify: `apps/pipeline-cloudflare/src/api/pipelineApi.ts:557-651` (`getBookRun`)
- Test: `apps/pipeline-cloudflare/test/wp6Api.test.ts`

**Interfaces:**

- Consumes: `book_run_regenerations` rows created by Tasks 2 and 3.
- Produces: `getBookRun`'s response body gains `regenerationKind: "candidate_regeneration" | "photo_replacement" | null` (top-level) and every entry in `pages[]` gains `replacesPageId: string | null`. The frontend plan's reconciliation function consumes both by name exactly as written here.

- [ ] **Step 1: Write the failing test**

```ts
it("exposes replacesPageId and regenerationKind for a regeneration run, and null for the primary run", async () => {
  const seeded = await seedReviewablePage();
  await api.reviewCandidate(
    owner,
    "approve-for-lineage-001",
    seeded.bookId,
    seeded.pageId,
    {
      candidateId: seeded.candidateId,
      decision: "approved",
    }
  );
  const regenerated = await api.regeneratePage(
    owner,
    "regen-for-lineage-001",
    seeded.bookId,
    seeded.pageId
  );
  const newRunView = await api.getBookRun(
    owner,
    seeded.bookId,
    String(regenerated.body.runId)
  );
  expect(newRunView.body.regenerationKind).toBe("candidate_regeneration");
  expect(
    (newRunView.body.pages as Array<{ replacesPageId: string | null }>)[0]!
      .replacesPageId
  ).toBe(seeded.pageId);

  const primaryView = await api.getBookRun(owner, seeded.bookId, seeded.runId);
  expect(primaryView.body.regenerationKind).toBeNull();
  expect(
    (primaryView.body.pages as Array<{ replacesPageId: string | null }>).every(
      page => page.replacesPageId === null
    )
  ).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter pipeline-cloudflare test -- -t "exposes replacesPageId"`
Expected: FAIL — `regenerationKind`/`replacesPageId` are `undefined`.

- [ ] **Step 3: Implement in `getBookRun`**

After the existing `readBookRunStatus` call (pipelineApi.ts:563-567), add one query:

```ts
const lineage = await this.database
  .prepare(
    `SELECT kind, source_page_id FROM book_run_regenerations WHERE new_run_id = ?`
  )
  .bind(runId)
  .first<{ kind: string; source_page_id: string }>();
```

In the response body (pipelineApi.ts:631-649), add `regenerationKind: lineage?.kind ?? null` at the top level, and inside `mappedPages`'s `return { ... }` (pipelineApi.ts:621-629), add `replacesPageId: lineage?.source_page_id ?? null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter pipeline-cloudflare test -- -t "exposes replacesPageId"`
Expected: PASS

- [ ] **Step 5: Run the full suite**

Run: `pnpm --filter pipeline-cloudflare test && pnpm --filter pipeline-cloudflare check && pnpm lint && pnpm exec prettier --check apps/pipeline-cloudflare`
Expected: all PASS/clean.

- [ ] **Step 6: Commit**

```bash
git add apps/pipeline-cloudflare/src/api/pipelineApi.ts apps/pipeline-cloudflare/test/wp6Api.test.ts
git commit -m "feat(pipeline-cloudflare): expose regeneration/replacement lineage on getBookRun"
```
