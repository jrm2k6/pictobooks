import { objectKeys } from "../domain/objectKeys.js";
import {
  DEFAULT_INITIAL_CANDIDATE_COUNT,
  MAX_INITIAL_CANDIDATE_COUNT,
  MAX_REPAIR_ROUNDS,
  MIN_INITIAL_CANDIDATE_COUNT,
  REPAIR_CANDIDATE_COUNT,
  maximumCandidateCount,
  maximumPageCostMicros,
} from "../domain/generationPolicy.js";
import { R2ArtifactStore } from "../storage/r2ArtifactStore.js";
import { readBookRunStatus } from "../wp5/syntheticBookRun.js";
import { sha256Hex, type Principal } from "./auth.js";
import type { ArtifactSigner, SignedArtifactRequest } from "./r2Presigner.js";
import { updatePhotoOrder as persistPhotoOrder } from "./photoOrderOperation.js";
import {
  d1UploadIntentRefreshStore,
  refreshLocalUploadIntent,
  UploadIntentRefreshError,
} from "./uploadIntentRefresh.js";

const SCHEMA_VERSION = "2026-11-10";
const UPLOAD_EXPIRY_SECONDS = 15 * 60;
const DOWNLOAD_EXPIRY_SECONDS = 5 * 60;
const MAX_PHOTOS = 24;

export type ApiResponse = { status: number; body: Record<string, unknown> };

export type BookRunLauncher = { start(runId: string): Promise<void> };
export type GenerationProviderConfig = {
  provider: "mock" | "gemini";
  model: string;
  styleJudgeModel: string;
  candidateCostMicros: number;
  styleJudgeCostMicros: number;
  initialCandidateCount: number;
  apiKeyConfigured: boolean;
};

export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message = code
  ) {
    super(message);
    this.name = "ApiProblem";
  }
}

type PhotoUploadInput = {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  byteSize: number;
  sha256: string;
};

type UploadIntentRow = {
  upload_intent_id: string;
  book_id: string;
  run_id: string;
  photo_id: string;
  artifact_id: string;
  object_key: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
};

export class PipelineApi {
  private readonly artifacts: R2ArtifactStore;

  constructor(
    private readonly database: D1Database,
    private readonly bucket: R2Bucket,
    private readonly signer: ArtifactSigner,
    private readonly launcher: BookRunLauncher,
    private readonly now: () => Date = () => new Date(),
    private readonly generation: GenerationProviderConfig = {
      provider: "mock",
      model: "mock-coloring-page-v1",
      styleJudgeModel: "mock-style-v1",
      candidateCostMicros: 1000,
      styleJudgeCostMicros: 0,
      initialCandidateCount: DEFAULT_INITIAL_CANDIDATE_COUNT,
      apiKeyConfigured: false,
    },
    private readonly localCustomerApi = false
  ) {
    this.artifacts = new R2ArtifactStore(bucket, database);
  }

  getPipelineConfig(): ApiResponse {
    const maxCandidatesPerPage = maximumCandidateCount(
      this.generation.initialCandidateCount
    );
    return {
      status: 200,
      body: {
        provider: this.generation.provider,
        model: this.generation.model,
        styleJudgeModel: this.generation.styleJudgeModel,
        initialCandidateCount: this.generation.initialCandidateCount,
        repairCandidateCount: REPAIR_CANDIDATE_COUNT,
        maxRepairRounds: MAX_REPAIR_ROUNDS,
        maxCandidatesPerPage,
        maxCostPerPageMicros: this.maximumCostPerPageMicros(),
      },
    };
  }

  createBook(principal: Principal, key: string): Promise<ApiResponse> {
    return this.mutate(principal, key, "create_book", async stable => {
      const bookId = `book-${stable}`;
      const now = this.isoNow();
      await this.database
        .prepare(
          `INSERT INTO books (book_id, owner_id, status, created_at, updated_at)
           VALUES (?, ?, 'draft', ?, ?) ON CONFLICT(book_id) DO NOTHING`
        )
        .bind(bookId, principal.userId, now, now)
        .run();
      return { status: 201, body: { bookId } };
    });
  }

  async listBooks(principal: Principal): Promise<ApiResponse> {
    const books = await this.database.prepare(
      `SELECT b.book_id, b.status, b.created_at, b.updated_at,
              (SELECT count(*) FROM book_runs r WHERE r.book_id = b.book_id) AS run_count
       FROM books b WHERE b.owner_id = ? ORDER BY b.updated_at DESC LIMIT 100`
    ).bind(principal.userId).all();
    return { status: 200, body: { books: books.results } };
  }

  async listBookRuns(principal: Principal, bookId: string): Promise<ApiResponse> {
    await this.requireOwnedBook(principal.userId, bookId);
    const runs = await this.database.prepare(
      `SELECT run_id, book_id, status, style_pack_version, cost_ceiling_micros,
              cost_spent_micros, created_at, updated_at, completed_at
       FROM book_runs WHERE book_id = ? ORDER BY created_at DESC LIMIT 100`
    ).bind(bookId).all();
    return { status: 200, body: { runs: runs.results } };
  }

  updatePhotoOrder(
    principal: Principal,
    key: string,
    bookId: string,
    runId: string,
    photoIds: string[]
  ): Promise<ApiResponse> {
    return this.mutate(principal, key, `photo_order:${runId}`, async () => ({
      status: 200,
      body: await persistPhotoOrder(
        this.database,
        principal.userId,
        bookId,
        runId,
        photoIds,
        this.isoNow()
      ),
    }));
  }

  refreshUploadIntent(
    principal: Principal,
    key: string,
    bookId: string,
    runId: string,
    uploadIntentId: string,
    origin: string
  ): Promise<ApiResponse> {
    if (!this.localCustomerApi) {
      throw new ApiProblem(404, "route_not_found");
    }
    return this.mutate(
      principal,
      key,
      `refresh_upload_intent:${uploadIntentId}`,
      async () => {
        try {
          return {
            status: 200,
            body: await refreshLocalUploadIntent(
              d1UploadIntentRefreshStore(this.database),
              {
                ownerId: principal.userId,
                bookId,
                runId,
                uploadIntentId,
                origin,
                now: this.now(),
              }
            ),
          };
        } catch (error) {
          if (error instanceof UploadIntentRefreshError) {
            throw new ApiProblem(error.status, error.code);
          }
          throw error;
        }
      }
    );
  }

  async listCanonicalReferences(principal: Principal, stylePackVersion?: string): Promise<ApiResponse> {
    const refs = await this.database.prepare(
      `SELECT cr.canonical_reference_id, cr.candidate_id, cr.style_pack_version,
              cr.style_pack_revision, cr.artifact_id, cr.promoted_at
       FROM canonical_references cr
       JOIN candidates c ON c.candidate_id = cr.candidate_id
       JOIN pages p ON p.page_id = c.page_id
       JOIN book_runs r ON r.run_id = p.run_id
       JOIN books b ON b.book_id = r.book_id
       WHERE b.owner_id = ? AND cr.retired_at IS NULL
         AND (? IS NULL OR cr.style_pack_version = ?)
       ORDER BY cr.style_pack_version, cr.style_pack_revision DESC LIMIT 200`
    ).bind(principal.userId, stylePackVersion ?? null, stylePackVersion ?? null).all();
    return { status: 200, body: { canonicalReferences: refs.results } };
  }

  createBookRun(
    principal: Principal,
    key: string,
    bookId: string,
    input: {
      photos: PhotoUploadInput[];
      stylePackVersion?: string;
      costCeilingMicros?: number;
    }
  ): Promise<ApiResponse> {
    return this.mutate(
      principal,
      key,
      `create_book_run:${bookId}`,
      async stable => {
        await this.requireOwnedBook(principal.userId, bookId);
        this.assertGenerationProviderAvailable();
        validatePhotos(input.photos);
        if (this.localCustomerApi && (input.photos.length < 5 || input.photos.length > 10)) {
          throw new ApiProblem(400, "invalid_photo_count");
        }
        const runId = `run-${stable}`;
        const now = this.isoNow();
        const defaultPerPageCeiling = this.maximumCostPerPageMicros();
        const costCeiling = Math.min(
          input.costCeilingMicros ?? input.photos.length * defaultPerPageCeiling,
          input.photos.length * defaultPerPageCeiling
        );
        if (!Number.isSafeInteger(costCeiling) || costCeiling < 0) {
          throw new ApiProblem(400, "invalid_cost_ceiling");
        }
        const stylePackVersion =
          input.stylePackVersion ?? "pictobook-preschool-v0.1";
        if (!isSafeId(stylePackVersion)) {
          throw new ApiProblem(400, "invalid_style_pack_version");
        }
        const statements: D1PreparedStatement[] = [
          this.database
            .prepare(
              `INSERT INTO book_runs
             (run_id, book_id, status, style_pack_version, cost_ceiling_micros,
              cost_spent_micros, created_at, updated_at, completed_at)
             VALUES (?, ?, 'created', ?, ?, 0, ?, ?, NULL)
             ON CONFLICT(run_id) DO NOTHING`
            )
            .bind(runId, bookId, stylePackVersion, costCeiling, now, now),
          this.database
            .prepare(
              `INSERT INTO book_run_execution_configs
             (run_id, provider, model, style_judge_model, execution_profile,
              candidate_cost_micros, style_judge_cost_micros,
              initial_candidate_count, created_at)
             VALUES (?, ?, ?, ?, 'mock_pass_after_repair', ?, ?, ?, ?)
             ON CONFLICT(run_id) DO NOTHING`
            )
            .bind(runId, this.generation.provider, this.generation.model,
              this.generation.styleJudgeModel, this.generation.candidateCostMicros,
              this.generation.styleJudgeCostMicros,
              this.generation.initialCandidateCount, now),
        ];
        const intents: UploadIntentRow[] = [];
        for (let index = 0; index < input.photos.length; index += 1) {
          const photo = input.photos[index]!;
          const ordinal = index + 1;
          const photoId = `photo-${ordinal}-${stable}`;
          const pageId = `page-${ordinal}-${stable}`;
          const artifactId = `source:${photoId}`;
          const objectKey = objectKeys.sourcePhoto({
            bookId,
            runId,
            photoId,
            revision: "v1",
          });
          const intent: UploadIntentRow = {
            upload_intent_id: `upload-${ordinal}-${stable}`,
            book_id: bookId,
            run_id: runId,
            photo_id: photoId,
            artifact_id: artifactId,
            object_key: objectKey,
            content_type: photo.contentType,
            byte_size: photo.byteSize,
            sha256: photo.sha256,
            expires_at: new Date(
              this.now().getTime() + UPLOAD_EXPIRY_SECONDS * 1000
            ).toISOString(),
            completed_at: null,
            created_at: now,
          };
          intents.push(intent);
          statements.push(
            this.database
              .prepare(
                `INSERT INTO photos
               (photo_id, run_id, ordinal, source_artifact_id, intake_status, created_at)
               VALUES (?, ?, ?, NULL, 'pending', ?) ON CONFLICT(photo_id) DO NOTHING`
              )
              .bind(photoId, runId, ordinal, now),
            this.database
              .prepare(
                `INSERT INTO pages
               (page_id, run_id, photo_id, state, initial_candidate_count,
                repair_round_count, approved_candidate_id, approval_source,
                terminal_reason, created_at, updated_at)
               VALUES (?, ?, ?, 'created', 0, 0, NULL, NULL, NULL, ?, ?)
               ON CONFLICT(page_id) DO NOTHING`
              )
              .bind(pageId, runId, photoId, now, now),
            this.database
              .prepare(
                `INSERT INTO upload_intents
               (upload_intent_id, owner_id, book_id, run_id, photo_id, artifact_id,
                object_key, content_type, byte_size, sha256, expires_at,
                completed_at, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
               ON CONFLICT(upload_intent_id) DO NOTHING`
              )
              .bind(
                intent.upload_intent_id,
                principal.userId,
                bookId,
                runId,
                photoId,
                artifactId,
                objectKey,
                photo.contentType,
                photo.byteSize,
                photo.sha256,
                intent.expires_at,
                now
              )
          );
        }
        await this.database.batch(statements);
        const uploads = await Promise.all(
          intents.map(intent => this.signIntent(intent))
        );
        return { status: 201, body: { bookId, runId, uploads } };
      }
    );
  }

  startBookRun(
    principal: Principal,
    key: string,
    bookId: string,
    runId: string
  ): Promise<ApiResponse> {
    return this.mutate(principal, key, `start_book_run:${runId}`, async () => {
      await this.requireOwnedRun(principal.userId, bookId, runId);
      const result = await this.database
        .prepare(
          "SELECT * FROM upload_intents WHERE run_id = ? ORDER BY photo_id"
        )
        .bind(runId)
        .all<UploadIntentRow>();
      if (result.results.length === 0) {
        throw new ApiProblem(409, "run_has_no_uploads");
      }
      const now = this.isoNow();
      for (const intent of result.results) {
        const object = await this.bucket.head(intent.object_key);
        if (!object) throw new ApiProblem(409, "upload_missing");
        if (
          object.size !== intent.byte_size ||
          object.httpMetadata?.contentType !== intent.content_type ||
          metadataValue(object.customMetadata, "artifactId", "artifactid") !==
            intent.artifact_id ||
          metadataValue(object.customMetadata, "sha256", "sha256") !==
            intent.sha256
        ) {
          throw new ApiProblem(409, "upload_metadata_mismatch");
        }
        await this.artifacts.registerExternalImmutable({
          artifactId: intent.artifact_id,
          runId,
          objectKey: intent.object_key,
          artifactKind: "source_photo",
          schemaVersion: SCHEMA_VERSION,
          sha256: intent.sha256,
          byteSize: intent.byte_size,
          mimeType: intent.content_type,
          retentionClass: "source",
          createdAt: intent.created_at,
        });
        await this.database.batch([
          this.database
            .prepare(
              "UPDATE photos SET source_artifact_id = ? WHERE photo_id = ? AND source_artifact_id IS NULL"
            )
            .bind(intent.artifact_id, intent.photo_id),
          this.database
            .prepare(
              "UPDATE upload_intents SET completed_at = coalesce(completed_at, ?) WHERE upload_intent_id = ?"
            )
            .bind(now, intent.upload_intent_id),
        ]);
      }
      await this.launcher.start(runId);
      return { status: 202, body: { bookId, runId, status: "started" } };
    });
  }

  async getBookRun(
    principal: Principal,
    bookId: string,
    runId: string
  ): Promise<ApiResponse> {
    await this.requireOwnedRun(principal.userId, bookId, runId);
    const run = await readBookRunStatus({ PIPELINE_DB: this.database }, runId);
    if (!run) throw new ApiProblem(404, "run_not_found");
    const [photos, artifacts] = await Promise.all([
      this.database.prepare("SELECT * FROM photos WHERE run_id = ? ORDER BY ordinal")
        .bind(runId).all(),
      this.database.prepare("SELECT artifact_id, page_id, artifact_kind, mime_type, byte_size, created_at FROM artifacts WHERE run_id = ? AND deleted_at IS NULL ORDER BY created_at")
        .bind(runId).all(),
    ]);
    return { status: 200, body: { ...run, photos: photos.results, artifacts: artifacts.results } };
  }

  reviewCandidate(
    principal: Principal,
    key: string,
    bookId: string,
    pageId: string,
    input: {
      candidateId: string;
      decision: "approved" | "rejected" | "changes_requested";
      notes?: string;
    }
  ): Promise<ApiResponse> {
    return this.mutate(principal, key, `review:${pageId}`, async stable => {
      const row = await this.requireOwnedCandidate(
        principal.userId,
        bookId,
        pageId,
        input.candidateId
      );
      if (!isReviewDecision(input.decision)) {
        throw new ApiProblem(400, "invalid_review_decision");
      }
      if (
        input.decision === "approved" &&
        row.state === "approved" &&
        row.approved_candidate_id !== input.candidateId
      ) {
        throw new ApiProblem(409, "page_already_approved");
      }
      if (
        input.decision === "approved" &&
        !["approved", "needs_human_review"].includes(row.state)
      ) {
        throw new ApiProblem(409, "page_not_reviewable");
      }
      if (input.decision === "rejected" && row.state !== "needs_human_review") {
        throw new ApiProblem(409, "page_not_reviewable");
      }
      const reviewId = `review-${stable}`;
      const operationId = `review:${reviewId}`;
      const now = this.isoNow();
      await this.database.batch([
        this.database
          .prepare(
            `INSERT INTO operations
             (operation_id, run_id, page_id, operation_kind, status,
              semantic_attempt, infrastructure_retry_count, outcome_json,
              failure_class, created_at, updated_at, completed_at)
             VALUES (?, ?, ?, 'review', 'completed', 0, 0, ?, NULL, ?, ?, ?)
             ON CONFLICT(operation_id) DO NOTHING`
          )
          .bind(
            operationId,
            row.run_id,
            pageId,
            JSON.stringify({
              reviewId,
              candidateId: input.candidateId,
              decision: input.decision,
            }),
            now,
            now,
            now
          ),
        this.database
          .prepare(
            `INSERT INTO reviews
             (review_id, page_id, candidate_id, reviewer_id, decision, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(review_id) DO NOTHING`
          )
          .bind(
            reviewId,
            pageId,
            input.candidateId,
            principal.userId,
            input.decision,
            normalizeNotes(input.notes),
            now
          ),
      ]);
      if (input.decision === "approved") {
        if (row.state === "needs_human_review") {
          await this.database
            .prepare(
              `UPDATE pages SET state = 'approved', approved_candidate_id = ?,
                 approval_source = 'human', terminal_reason = NULL, updated_at = ?
               WHERE page_id = ? AND state = 'needs_human_review'`
            )
            .bind(input.candidateId, now, pageId)
            .run();
        }
      } else if (input.decision === "rejected") {
        await this.database
          .prepare(
            `UPDATE pages SET state = 'rejected', terminal_reason = 'human_rejected',
               updated_at = ? WHERE page_id = ? AND state = 'needs_human_review'`
          )
          .bind(now, pageId)
          .run();
      }
      await this.insertAudit({
        id: `audit-${stable}`,
        runId: row.run_id,
        pageId,
        operationId,
        kind: "candidate_reviewed",
        actorId: principal.userId,
        payload: {
          reviewId,
          candidateId: input.candidateId,
          decision: input.decision,
        },
        now,
      });
      return {
        status: 201,
        body: {
          reviewId,
          pageId,
          candidateId: input.candidateId,
          decision: input.decision,
        },
      };
    });
  }

  regeneratePage(
    principal: Principal,
    key: string,
    bookId: string,
    pageId: string,
    requestedCostCeilingMicros?: number
  ): Promise<ApiResponse> {
    return this.mutate(principal, key, `regenerate:${pageId}`, async stable => {
      this.assertGenerationProviderAvailable();
      const costCeilingMicros = requestedCostCeilingMicros ??
        this.maximumCostPerPageMicros();
      if (
        !Number.isSafeInteger(costCeilingMicros) ||
        costCeilingMicros < 3_000
      ) {
        throw new ApiProblem(400, "invalid_cost_ceiling");
      }
      const source = await this.database
        .prepare(
          `SELECT p.run_id AS source_run_id, p.photo_id, ph.source_artifact_id,
                  r.style_pack_version
           FROM pages p
           JOIN book_runs r ON r.run_id = p.run_id
           JOIN books b ON b.book_id = r.book_id
           JOIN photos ph ON ph.photo_id = p.photo_id
           WHERE p.page_id = ? AND r.book_id = ? AND b.owner_id = ?`
        )
        .bind(pageId, bookId, principal.userId)
        .first<{
          source_run_id: string;
          photo_id: string;
          source_artifact_id: string | null;
          style_pack_version: string;
        }>();
      if (!source) throw new ApiProblem(404, "page_not_found");
      if (!source.source_artifact_id) {
        throw new ApiProblem(409, "source_artifact_missing");
      }
      const feedback = await this.collectRegenerationFeedback(pageId);
      const runId = `run-${stable}`;
      const photoId = `photo-1-${stable}`;
      const newPageId = `page-1-${stable}`;
      const now = this.isoNow();
      await this.database.batch([
        this.database
          .prepare(
            `INSERT INTO book_runs
             (run_id, book_id, status, style_pack_version, cost_ceiling_micros,
              cost_spent_micros, created_at, updated_at, completed_at)
             VALUES (?, ?, 'created', ?, ?, 0, ?, ?, NULL)
             ON CONFLICT(run_id) DO NOTHING`
          )
          .bind(
            runId,
            bookId,
            source.style_pack_version,
            costCeilingMicros,
            now,
            now
          ),
        this.database
          .prepare(
            `INSERT INTO book_run_execution_configs
             (run_id, provider, model, style_judge_model, execution_profile,
              candidate_cost_micros, style_judge_cost_micros,
              initial_candidate_count, created_at)
             VALUES (?, ?, ?, ?, 'mock_pass_after_repair', ?, ?, ?, ?)
             ON CONFLICT(run_id) DO NOTHING`
          )
          .bind(runId, this.generation.provider, this.generation.model,
            this.generation.styleJudgeModel, this.generation.candidateCostMicros,
            this.generation.styleJudgeCostMicros,
            this.generation.initialCandidateCount, now),
        this.database
          .prepare(
            `INSERT INTO photos
             (photo_id, run_id, ordinal, source_artifact_id, intake_status, created_at)
             VALUES (?, ?, 1, ?, 'pending', ?) ON CONFLICT(photo_id) DO NOTHING`
          )
          .bind(photoId, runId, source.source_artifact_id, now),
        this.database
          .prepare(
            `INSERT INTO pages
             (page_id, run_id, photo_id, state, initial_candidate_count,
              repair_round_count, approved_candidate_id, approval_source,
              terminal_reason, created_at, updated_at)
             VALUES (?, ?, ?, 'created', 0, 0, NULL, NULL, NULL, ?, ?)
             ON CONFLICT(page_id) DO NOTHING`
          )
          .bind(newPageId, runId, photoId, now, now),
        this.database
          .prepare(
            `INSERT INTO book_run_regenerations
             (new_run_id, source_run_id, source_page_id, requested_by, created_at, feedback_json)
             VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(new_run_id) DO NOTHING`
          )
          .bind(runId, source.source_run_id, pageId, principal.userId, now, JSON.stringify(feedback)),
        this.database
          .prepare(
            "UPDATE books SET status = 'processing', updated_at = ? WHERE book_id = ?"
          )
          .bind(now, bookId),
      ]);
      await this.launcher.start(runId);
      return {
        status: 202,
        body: { bookId, sourcePageId: pageId, runId, pageId: newPageId },
      };
    });
  }

  private assertGenerationProviderAvailable(): void {
    if (
      !Number.isInteger(this.generation.initialCandidateCount) ||
      this.generation.initialCandidateCount < MIN_INITIAL_CANDIDATE_COUNT ||
      this.generation.initialCandidateCount > MAX_INITIAL_CANDIDATE_COUNT
    ) {
      throw new ApiProblem(503, "initial_candidate_count_not_configured");
    }
    if (this.generation.provider === "gemini" && !this.generation.apiKeyConfigured) {
      throw new ApiProblem(503, "gemini_provider_not_configured");
    }
    if (
      this.generation.provider === "gemini" &&
      (!Number.isSafeInteger(this.generation.candidateCostMicros) || this.generation.candidateCostMicros < 1)
    ) {
      throw new ApiProblem(503, "gemini_cost_estimate_not_configured");
    }
    if (
      this.generation.provider === "gemini" &&
      (!Number.isSafeInteger(this.generation.styleJudgeCostMicros) ||
        this.generation.styleJudgeCostMicros < 1)
    ) {
      throw new ApiProblem(503, "gemini_style_qa_cost_estimate_not_configured");
    }
  }

  private maximumCostPerPageMicros(): number {
    if (this.generation.provider !== "gemini") return 7_000;
    return maximumPageCostMicros(
      this.generation.initialCandidateCount,
      this.generation.candidateCostMicros,
      this.generation.styleJudgeCostMicros
    );
  }

  private async collectRegenerationFeedback(pageId: string): Promise<Record<string, unknown>> {
    const qa = await this.database.prepare(
      `SELECT c.candidate_id, q.qa_kind, q.status, q.overall_score, q.artifact_id
       FROM candidates c JOIN qa_results q ON q.candidate_id = c.candidate_id
       WHERE c.page_id = ? ORDER BY q.created_at DESC LIMIT 12`
    ).bind(pageId).all<{
      candidate_id: string;
      qa_kind: "print" | "style";
      status: string;
      overall_score: number | null;
      artifact_id: string | null;
    }>();
    const findings: Array<Record<string, unknown>> = [];
    for (const result of qa.results) {
      let detail: unknown;
      if (result.artifact_id) {
        try {
          const artifact = await this.artifacts.read(result.artifact_id);
          detail = JSON.parse(await artifact.object.text());
        } catch {
          detail = undefined;
        }
      }
      findings.push({
        candidateId: result.candidate_id,
        qaKind: result.qa_kind,
        status: result.status,
        score: result.overall_score,
        ...(detail === undefined ? {} : { details: detail }),
      });
    }
    const reviews = await this.database.prepare(
      `SELECT candidate_id, decision, notes, created_at FROM reviews
       WHERE page_id = ? ORDER BY created_at DESC LIMIT 12`
    ).bind(pageId).all<{ candidate_id: string; decision: string; notes: string | null; created_at: string }>();
    return {
      sourcePageId: pageId,
      judgeFindings: findings,
      reviewerNotes: reviews.results
        .filter(review => review.notes?.trim())
        .map(review => ({ candidateId: review.candidate_id, decision: review.decision, notes: review.notes!.slice(0, 2000) })),
    };
  }

  promoteCanonical(
    principal: Principal,
    key: string,
    bookId: string,
    candidateId: string,
    input: { reviewId: string; stylePackVersion: string }
  ): Promise<ApiResponse> {
    return this.mutate(
      principal,
      key,
      `canonical:${candidateId}`,
      async stable => {
        if (!isSafeId(input.stylePackVersion)) {
          throw new ApiProblem(400, "invalid_style_pack_version");
        }
        const candidate = await this.database
          .prepare(
            `SELECT c.page_id, c.clean_artifact_id, p.run_id
           FROM candidates c
           JOIN pages p ON p.page_id = c.page_id
           JOIN book_runs r ON r.run_id = p.run_id
           JOIN books b ON b.book_id = r.book_id
           JOIN reviews v ON v.review_id = ? AND v.candidate_id = c.candidate_id
             AND v.decision = 'approved'
           WHERE c.candidate_id = ? AND r.book_id = ? AND b.owner_id = ?`
          )
          .bind(input.reviewId, candidateId, bookId, principal.userId)
          .first<{
            page_id: string;
            clean_artifact_id: string | null;
            run_id: string;
          }>();
        if (!candidate) throw new ApiProblem(404, "approved_review_not_found");
        if (!candidate.clean_artifact_id) {
          throw new ApiProblem(409, "candidate_artifact_missing");
        }
        const existingReference = await this.database
          .prepare(
            `SELECT canonical_reference_id, style_pack_revision
             FROM canonical_references
             WHERE candidate_id = ? AND style_pack_version = ?
               AND retired_at IS NULL`
          )
          .bind(candidateId, input.stylePackVersion)
          .first<{
            canonical_reference_id: string;
            style_pack_revision: number;
          }>();
        if (existingReference) {
          return {
            status: 200,
            body: {
              canonicalReferenceId: existingReference.canonical_reference_id,
              candidateId,
              stylePackVersion: input.stylePackVersion,
              stylePackRevision: existingReference.style_pack_revision,
            },
          };
        }
        const revisionRow = await this.database
          .prepare(
            `SELECT coalesce(max(style_pack_revision), 0) + 1 AS revision
           FROM canonical_references WHERE style_pack_version = ?`
          )
          .bind(input.stylePackVersion)
          .first<{ revision: number }>();
        const revision = revisionRow?.revision ?? 1;
        const canonicalReferenceId = `canonical-${stable}`;
        const operationId = `canonical:${canonicalReferenceId}`;
        const now = this.isoNow();
        await this.database.batch([
          this.database
            .prepare(
              `INSERT INTO operations
             (operation_id, run_id, page_id, operation_kind, status,
              semantic_attempt, infrastructure_retry_count, outcome_json,
              failure_class, created_at, updated_at, completed_at)
             VALUES (?, ?, ?, 'canonical_promotion', 'completed', 0, 0, ?, NULL, ?, ?, ?)
             ON CONFLICT(operation_id) DO NOTHING`
            )
            .bind(
              operationId,
              candidate.run_id,
              candidate.page_id,
              JSON.stringify({ canonicalReferenceId, candidateId }),
              now,
              now,
              now
            ),
          this.database
            .prepare(
              `INSERT INTO canonical_references
             (canonical_reference_id, review_id, candidate_id, style_pack_version,
              style_pack_revision, artifact_id, promoted_by, promoted_at, retired_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
             ON CONFLICT(canonical_reference_id) DO NOTHING`
            )
            .bind(
              canonicalReferenceId,
              input.reviewId,
              candidateId,
              input.stylePackVersion,
              revision,
              candidate.clean_artifact_id,
              principal.userId,
              now
            ),
        ]);
        await this.insertAudit({
          id: `audit-${stable}`,
          runId: candidate.run_id,
          pageId: candidate.page_id,
          operationId,
          kind: "canonical_promoted",
          actorId: principal.userId,
          payload: { canonicalReferenceId, candidateId, revision },
          now,
        });
        return {
          status: 201,
          body: {
            canonicalReferenceId,
            candidateId,
            stylePackVersion: input.stylePackVersion,
            stylePackRevision: revision,
          },
        };
      }
    );
  }

  async getArtifactAccess(
    principal: Principal,
    artifactId: string
  ): Promise<ApiResponse> {
    const artifact = await this.database
      .prepare(
        `SELECT a.object_key FROM artifacts a
         JOIN book_runs r ON r.run_id = a.run_id
         JOIN books b ON b.book_id = r.book_id
         WHERE a.artifact_id = ? AND a.deleted_at IS NULL AND b.owner_id = ?`
      )
      .bind(artifactId, principal.userId)
      .first<{ object_key: string }>();
    if (!artifact) throw new ApiProblem(404, "artifact_not_found");
    if (this.localCustomerApi) {
      return {
        status: 200,
        body: {
          artifactId,
          access: {
            url: `/v1/artifacts/${encodeURIComponent(artifactId)}/content`,
            method: "GET",
            headers: {},
            expiresAt: new Date(
              this.now().getTime() + DOWNLOAD_EXPIRY_SECONDS * 1000
            ).toISOString(),
          },
        },
      };
    }
    const access = await this.signer.signDownload({
      objectKey: artifact.object_key,
      expiresInSeconds: DOWNLOAD_EXPIRY_SECONDS,
    });
    return { status: 200, body: { artifactId, access } };
  }

  async acceptLocalUpload(
    principal: Principal,
    bookId: string,
    runId: string,
    uploadIntentId: string,
    request: Request
  ): Promise<ApiResponse> {
    if (!this.localCustomerApi) throw new ApiProblem(404, "route_not_found");
    const intent = await this.database
      .prepare(
        `SELECT ui.object_key, ui.artifact_id, ui.content_type, ui.byte_size,
                ui.sha256, ui.run_id, ui.expires_at
         FROM upload_intents ui JOIN books b ON b.book_id = ui.book_id
         JOIN book_runs r ON r.run_id = ui.run_id AND r.book_id = ui.book_id
         WHERE ui.owner_id = ? AND b.owner_id = ? AND ui.book_id = ?
           AND ui.run_id = ? AND ui.upload_intent_id = ?
           AND ui.completed_at IS NULL AND r.status = 'created'`
      )
      .bind(principal.userId, principal.userId, bookId, runId, uploadIntentId)
      .first<{
        object_key: string;
        artifact_id: string;
        content_type: string;
        byte_size: number;
        sha256: string;
        run_id: string;
        expires_at: string;
      }>();
    if (!intent) throw new ApiProblem(404, "upload_intent_not_found");
    if (intent.expires_at <= this.isoNow()) {
      throw new ApiProblem(410, "upload_intent_expired");
    }
    if (request.headers.get("content-type") !== intent.content_type) {
      throw new ApiProblem(400, "upload_content_type_mismatch");
    }
    const bytes = await readBodyAtMost(request, intent.byte_size);
    if (bytes.byteLength !== intent.byte_size) {
      throw new ApiProblem(400, "upload_size_mismatch");
    }
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = Array.from(new Uint8Array(digest), byte =>
      byte.toString(16).padStart(2, "0")
    ).join("");
    if (sha256 !== intent.sha256) {
      throw new ApiProblem(400, "upload_checksum_mismatch");
    }
    await this.bucket.put(intent.object_key, bytes, {
      httpMetadata: { contentType: intent.content_type },
      customMetadata: {
        artifactId: intent.artifact_id,
        runId: intent.run_id,
        sha256: intent.sha256,
      },
    });
    return {
      status: 201,
      body: { uploadIntentId, status: "uploaded" },
    };
  }

  async readLocalArtifact(
    principal: Principal,
    artifactId: string
  ): Promise<Response> {
    if (!this.localCustomerApi) throw new ApiProblem(404, "route_not_found");
    const record = await this.database
      .prepare(
        `SELECT a.object_key, a.mime_type FROM artifacts a
         JOIN book_runs r ON r.run_id = a.run_id
         JOIN books b ON b.book_id = r.book_id
         WHERE a.artifact_id = ? AND a.deleted_at IS NULL AND b.owner_id = ?`
      )
      .bind(artifactId, principal.userId)
      .first<{ object_key: string; mime_type: string }>();
    if (!record) throw new ApiProblem(404, "artifact_not_found");
    const object = await this.bucket.get(record.object_key);
    if (!object) throw new ApiProblem(404, "artifact_not_found");
    return new Response(object.body, {
      headers: {
        "Content-Type": record.mime_type,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  private async signIntent(intent: UploadIntentRow) {
    if (this.localCustomerApi) {
      const access: SignedArtifactRequest = {
        url: `/v1/books/${encodeURIComponent(intent.book_id)}/runs/${encodeURIComponent(intent.run_id)}/upload-intents/${encodeURIComponent(intent.upload_intent_id)}/content`,
        method: "PUT",
        headers: { "Content-Type": intent.content_type },
        expiresAt: intent.expires_at,
      };
      return {
        uploadIntentId: intent.upload_intent_id,
        photoId: intent.photo_id,
        artifactId: intent.artifact_id,
        uploadUrl: access.url,
        expiresAt: access.expiresAt,
        requiredHeaders: access.headers,
      };
    }
    const upload = await this.signer.signUpload({
      objectKey: intent.object_key,
      contentType: intent.content_type,
      byteSize: intent.byte_size,
      sha256: intent.sha256,
      artifactId: intent.artifact_id,
      runId: intent.run_id,
      expiresInSeconds: UPLOAD_EXPIRY_SECONDS,
    });
    return {
      uploadIntentId: intent.upload_intent_id,
      photoId: intent.photo_id,
      artifactId: intent.artifact_id,
      uploadUrl: upload.url,
      expiresAt: upload.expiresAt,
      requiredHeaders: upload.headers,
    };
  }

  private async mutate(
    principal: Principal,
    key: string,
    operation: string,
    execute: (stableId: string) => Promise<ApiResponse>
  ): Promise<ApiResponse> {
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(key)) {
      throw new ApiProblem(400, "invalid_idempotency_key");
    }
    let existing = await this.database
      .prepare(
        `SELECT operation, response_status, response_json FROM api_idempotency
         WHERE owner_id = ? AND idempotency_key = ?`
      )
      .bind(principal.userId, key)
      .first<{
        operation: string;
        response_status: number | null;
        response_json: string | null;
      }>();
    if (existing) {
      if (existing.operation !== operation) {
        throw new ApiProblem(409, "idempotency_key_reused");
      }
      if (existing.response_status && existing.response_json) {
        return {
          status: existing.response_status,
          body: JSON.parse(existing.response_json) as Record<string, unknown>,
        };
      }
    } else {
      const claim = await this.database
        .prepare(
          `INSERT INTO api_idempotency
           (owner_id, idempotency_key, operation, response_status, response_json,
            created_at, completed_at)
           VALUES (?, ?, ?, NULL, NULL, ?, NULL)
           ON CONFLICT(owner_id, idempotency_key) DO NOTHING`
        )
        .bind(principal.userId, key, operation, this.isoNow())
        .run();
      if (claim.meta.changes === 0) {
        existing = await this.database
          .prepare(
            `SELECT operation, response_status, response_json FROM api_idempotency
             WHERE owner_id = ? AND idempotency_key = ?`
          )
          .bind(principal.userId, key)
          .first<{
            operation: string;
            response_status: number | null;
            response_json: string | null;
          }>();
        if (!existing) throw new ApiProblem(409, "idempotency_claim_lost");
        if (existing.operation !== operation) {
          throw new ApiProblem(409, "idempotency_key_reused");
        }
        if (existing.response_status && existing.response_json) {
          return {
            status: existing.response_status,
            body: JSON.parse(existing.response_json) as Record<string, unknown>,
          };
        }
      }
    }
    const stableId = (
      await sha256Hex(`${principal.userId}\0${operation}\0${key}`)
    ).slice(0, 32);
    const response = await execute(stableId);
    const completedAt = this.isoNow();
    await this.database
      .prepare(
        `UPDATE api_idempotency SET response_status = ?, response_json = ?, completed_at = ?
         WHERE owner_id = ? AND idempotency_key = ? AND response_status IS NULL`
      )
      .bind(
        response.status,
        JSON.stringify(response.body),
        completedAt,
        principal.userId,
        key
      )
      .run();
    return response;
  }

  private async requireOwnedBook(
    ownerId: string,
    bookId: string
  ): Promise<void> {
    const book = await this.database
      .prepare(
        "SELECT 1 AS found FROM books WHERE book_id = ? AND owner_id = ?"
      )
      .bind(bookId, ownerId)
      .first();
    if (!book) throw new ApiProblem(404, "book_not_found");
  }

  private async requireOwnedRun(
    ownerId: string,
    bookId: string,
    runId: string
  ): Promise<void> {
    const run = await this.database
      .prepare(
        `SELECT 1 AS found FROM book_runs r JOIN books b ON b.book_id = r.book_id
         WHERE r.run_id = ? AND r.book_id = ? AND b.owner_id = ?`
      )
      .bind(runId, bookId, ownerId)
      .first();
    if (!run) throw new ApiProblem(404, "run_not_found");
  }

  private async requireOwnedCandidate(
    ownerId: string,
    bookId: string,
    pageId: string,
    candidateId: string
  ) {
    const row = await this.database
      .prepare(
        `SELECT p.run_id, p.state, p.approved_candidate_id
         FROM candidates c
         JOIN pages p ON p.page_id = c.page_id
         JOIN book_runs r ON r.run_id = p.run_id
         JOIN books b ON b.book_id = r.book_id
         WHERE c.candidate_id = ? AND c.page_id = ? AND r.book_id = ? AND b.owner_id = ?`
      )
      .bind(candidateId, pageId, bookId, ownerId)
      .first<{
        run_id: string;
        state: string;
        approved_candidate_id: string | null;
      }>();
    if (!row) throw new ApiProblem(404, "candidate_not_found");
    return row;
  }

  private async insertAudit(input: {
    id: string;
    runId: string;
    pageId: string;
    operationId: string;
    kind: string;
    actorId: string;
    payload: Record<string, unknown>;
    now: string;
  }) {
    await this.database
      .prepare(
        `INSERT INTO audit_events
         (audit_event_id, run_id, page_id, operation_id, event_kind,
          actor_type, actor_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, 'reviewer', ?, ?, ?)
         ON CONFLICT(audit_event_id) DO NOTHING`
      )
      .bind(
        input.id,
        input.runId,
        input.pageId,
        input.operationId,
        input.kind,
        input.actorId,
        JSON.stringify(input.payload),
        input.now
      )
      .run();
  }

  private isoNow(): string {
    return this.now().toISOString();
  }
}

const validatePhotos = (photos: PhotoUploadInput[]): void => {
  if (
    !Array.isArray(photos) ||
    photos.length < 1 ||
    photos.length > MAX_PHOTOS
  ) {
    throw new ApiProblem(400, "invalid_photo_count");
  }
  for (const photo of photos) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(photo.contentType) ||
      !Number.isSafeInteger(photo.byteSize) ||
      photo.byteSize < 1 ||
      photo.byteSize > 25 * 1024 * 1024 ||
      !/^[a-f0-9]{64}$/.test(photo.sha256)
    ) {
      throw new ApiProblem(400, "invalid_photo_upload");
    }
  }
};

const readBodyAtMost = async (
  request: Request,
  maximumBytes: number
): Promise<Uint8Array> => {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      await reader.cancel();
      throw new ApiProblem(413, "upload_too_large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
};

const normalizeNotes = (notes: string | undefined): string | null => {
  if (notes === undefined || notes.trim() === "") return null;
  if (notes.length > 2_000) throw new ApiProblem(400, "notes_too_long");
  return notes.trim();
};

const isReviewDecision = (
  value: string
): value is "approved" | "rejected" | "changes_requested" =>
  ["approved", "rejected", "changes_requested"].includes(value);

const isSafeId = (value: string): boolean =>
  /^[a-z0-9][a-z0-9_.-]{0,99}$/.test(value) && !value.includes("..");

const metadataValue = (
  metadata: Record<string, string> | undefined,
  camel: string,
  lower: string
): string | undefined => metadata?.[camel] ?? metadata?.[lower];

export type { SignedArtifactRequest };
