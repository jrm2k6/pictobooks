import { objectKeys } from "../domain/objectKeys.js";
import { R2ArtifactStore } from "../storage/r2ArtifactStore.js";
import type { ExecutionProfile } from "./bookRun.js";

const SCHEMA_VERSION = "2026-11-10";

export type CreateSyntheticBookRunInput = {
  pageCount: number;
  executionProfile: ExecutionProfile;
};

export const createSyntheticBookRun = async (
  env: Env,
  input: CreateSyntheticBookRunInput
) => {
  if (
    !Number.isInteger(input.pageCount) ||
    input.pageCount < 1 ||
    input.pageCount > 3
  ) {
    throw new RangeError("Synthetic Book Runs require between 1 and 3 pages");
  }
  const suffix = crypto.randomUUID();
  const bookId = `book-${suffix}`;
  const runId = `run-${suffix}`;
  const now = new Date().toISOString();
  const candidateCostMicros = 1_000;
  const costCeilingMicros = input.pageCount * 7 * candidateCostMicros;
  const statements: D1PreparedStatement[] = [
    env.PIPELINE_DB.prepare(
      `INSERT INTO books (book_id, owner_id, status, created_at, updated_at)
       VALUES (?, 'synthetic-preview', 'draft', ?, ?)`
    ).bind(bookId, now, now),
    env.PIPELINE_DB.prepare(
      `INSERT INTO book_runs
       (run_id, book_id, status, style_pack_version, cost_ceiling_micros,
        cost_spent_micros, created_at, updated_at, completed_at)
       VALUES (?, ?, 'created', 'pictobook-preschool-v0.1', ?, 0, ?, ?, NULL)`
    ).bind(runId, bookId, costCeilingMicros, now, now),
    env.PIPELINE_DB.prepare(
      `INSERT INTO book_run_execution_configs
       (run_id, provider, model, execution_profile, candidate_cost_micros, created_at)
       VALUES (?, 'mock', 'mock-coloring-page-v1', ?, ?, ?)`
    ).bind(runId, input.executionProfile, candidateCostMicros, now),
  ];

  const pages: Array<{
    pageId: string;
    photoId: string;
    sourceArtifactId: string;
  }> = [];
  for (let ordinal = 1; ordinal <= input.pageCount; ordinal += 1) {
    const photoId = `photo-${ordinal}-${suffix}`;
    const pageId = `page-${ordinal}-${suffix}`;
    const sourceArtifactId = `source:${photoId}`;
    pages.push({ pageId, photoId, sourceArtifactId });
    statements.push(
      env.PIPELINE_DB.prepare(
        `INSERT INTO photos
         (photo_id, run_id, ordinal, source_artifact_id, intake_status, created_at)
         VALUES (?, ?, ?, NULL, 'pending', ?)`
      ).bind(photoId, runId, ordinal, now),
      env.PIPELINE_DB.prepare(
        `INSERT INTO pages
         (page_id, run_id, photo_id, state, initial_candidate_count,
          repair_round_count, approved_candidate_id, approval_source,
          terminal_reason, created_at, updated_at)
         VALUES (?, ?, ?, 'created', 0, 0, NULL, NULL, NULL, ?, ?)`
      ).bind(pageId, runId, photoId, now, now)
    );
  }
  await env.PIPELINE_DB.batch(statements);

  const artifacts = new R2ArtifactStore(
    env.PIPELINE_ARTIFACTS,
    env.PIPELINE_DB
  );
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    const source = new TextEncoder().encode(syntheticSourceSvg(index + 1));
    await artifacts.putImmutable({
      artifactId: page.sourceArtifactId,
      runId,
      pageId: page.pageId,
      objectKey: objectKeys.sourcePhoto({
        bookId,
        runId,
        photoId: page.photoId,
        revision: "v1.svg",
      }),
      artifactKind: "source_photo",
      schemaVersion: SCHEMA_VERSION,
      body: source,
      mimeType: "image/svg+xml",
      provider: "synthetic",
      model: "fixture-v1",
      retentionClass: "source",
      createdAt: now,
    });
    await env.PIPELINE_DB.prepare(
      "UPDATE photos SET source_artifact_id = ? WHERE photo_id = ?"
    )
      .bind(page.sourceArtifactId, page.photoId)
      .run();
  }

  return { bookId, runId, pageIds: pages.map(page => page.pageId) };
};

export const readBookRunStatus = async (
  env: Pick<Env, "PIPELINE_DB">,
  runId: string
) => {
  const run = await env.PIPELINE_DB.prepare(
    "SELECT * FROM book_runs WHERE run_id = ?"
  )
    .bind(runId)
    .first();
  if (!run) return null;
  const [pages, candidates, qaResults, providerAttempts, repairRounds, reviews] =
    await Promise.all([
      env.PIPELINE_DB.prepare(
        "SELECT * FROM pages WHERE run_id = ? ORDER BY page_id"
      )
        .bind(runId)
        .all(),
      env.PIPELINE_DB.prepare(
        `SELECT c.* FROM candidates c JOIN pages p ON p.page_id = c.page_id
         WHERE p.run_id = ? ORDER BY c.page_id, c.ordinal`
      )
        .bind(runId)
        .all(),
      env.PIPELINE_DB.prepare(
        `SELECT q.* FROM qa_results q
         JOIN candidates c ON c.candidate_id = q.candidate_id
         JOIN pages p ON p.page_id = c.page_id
         WHERE p.run_id = ? ORDER BY q.candidate_id, q.qa_kind`
      )
        .bind(runId)
        .all(),
      env.PIPELINE_DB.prepare(
        "SELECT * FROM provider_attempts WHERE run_id = ? ORDER BY started_at"
      )
        .bind(runId)
        .all(),
      env.PIPELINE_DB.prepare(
        `SELECT r.* FROM repair_rounds r JOIN pages p ON p.page_id = r.page_id
         WHERE p.run_id = ? ORDER BY r.page_id, r.round_number`
      )
        .bind(runId)
        .all(),
      env.PIPELINE_DB.prepare(
        `SELECT v.* FROM reviews v JOIN pages p ON p.page_id = v.page_id
         WHERE p.run_id = ? ORDER BY v.created_at DESC`
      )
        .bind(runId)
        .all(),
    ]);
  return {
    run,
    pages: pages.results,
    candidates: candidates.results,
    qaResults: qaResults.results,
    providerAttempts: providerAttempts.results,
    repairRounds: repairRounds.results,
    reviews: reviews.results,
  };
};

const syntheticSourceSvg = (ordinal: number): string =>
  `
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">
  <rect width="1200" height="1600" fill="#f7efe3"/>
  <circle cx="600" cy="600" r="360" fill="#d99c72"/>
  <rect x="250" y="980" width="700" height="460" rx="180" fill="#4c6f91"/>
  <text x="600" y="1500" text-anchor="middle" font-size="60">Synthetic page ${ordinal}</text>
</svg>`.trim();
