import type { WorkflowStepConfig } from "cloudflare:workers";
import { objectKeys } from "../domain/objectKeys.js";
import type {
  BookRunExecutionConfigRecord,
  BookRunRecord,
  CandidateRecord,
  PageRecord,
} from "../domain/records.js";
import {
  MAX_REPAIR_ROUNDS,
  REPAIR_CANDIDATE_COUNT,
} from "../domain/generationPolicy.js";
import { R2ArtifactStore } from "../storage/r2ArtifactStore.js";
import {
  generateGeminiImage,
  judgeGeminiStyle,
  type GeminiImagePart,
} from "./geminiImageProvider.js";

const SCHEMA_VERSION = "2026-11-10";
const IMAGE_OPERATION_SCHEMA_VERSION = "2026-11-08";
const MIN_IMPROVEMENT = 0.04;
const STYLE_PASS_SCORE = 0.68;

export type ExecutionProfile =
  BookRunExecutionConfigRecord["execution_profile"];

export type WorkflowSteps = {
  do<T extends Rpc.Serializable<T>>(
    name: string,
    callback: () => Promise<T>
  ): Promise<T>;
  do<T extends Rpc.Serializable<T>>(
    name: string,
    config: WorkflowStepConfig,
    callback: () => Promise<T>
  ): Promise<T>;
};

export type ImageArtifactResult = {
  operationId: string;
  status: "created" | "reused";
  artifact: {
    artifactId: string;
    objectKey: string;
    sourceArtifactId: string;
    sha256: string;
    byteSize: number;
    mimeType: "image/jpeg" | "image/png" | "image/svg+xml" | "application/json";
    widthPx?: number;
    heightPx?: number;
  };
  assessment?: {
    status: "passed" | "needs_review";
    score: number;
    widthPx: number;
    heightPx: number;
    isCorrectAspectRatio: boolean;
    isBlackAndWhiteOnly: boolean;
    blackPixelRatio: number;
    whitePixelRatio: number;
    grayPixelRatio: number;
  };
};

export type ImageProcessor = {
  normalize?(input: ImageOperationInput): Promise<ImageArtifactResult>;
  cleanup(input: ImageOperationInput): Promise<ImageArtifactResult>;
  printQa(input: ImageOperationInput): Promise<ImageArtifactResult>;
};

export type ImageOperationInput = {
  pageId: string;
  operationId: string;
  input: { artifactId: string; objectKey: string; sha256: string };
  output: { artifactId: string; objectKey: string };
};

type RunContext = BookRunRecord &
  BookRunExecutionConfigRecord & {
    book_id: string;
  };

export type GeminiWorkerConfig = { apiKey?: string };

type PageContext = PageRecord & {
  book_id: string;
};

type RoundResult = {
  candidateIds: string[];
  terminal: "budget_exhausted" | null;
};

type QaDecision = {
  state: "approved" | "repairing" | "needs_human_review";
  candidateId: string | null;
  reason: string;
};

export class ProductionBookRun {
  private readonly artifacts: R2ArtifactStore;

  constructor(
    private readonly database: D1Database,
    private readonly bucket: R2Bucket,
    private readonly images: ImageProcessor,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly providerConfig: GeminiWorkerConfig = {}
  ) {
    this.artifacts = new R2ArtifactStore(bucket, database);
  }

  async run(runId: string, steps: WorkflowSteps) {
    const context = await steps.do(`start run ${runId}`, () =>
      this.startRun(runId)
    );
    const pages = await steps.do(`load pages ${runId}`, () =>
      this.loadPages(runId)
    );

    for (const page of pages) {
      await steps.do(`analyze ${page.page_id}`, () => this.acceptPage(page));
      await steps.do(
        `normalize source ${page.page_id}`,
        { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "3 minutes" },
        () => this.normalizeSource(page)
      );
      for (
        let semanticAttempt = 0;
        semanticAttempt <= MAX_REPAIR_ROUNDS;
        semanticAttempt += 1
      ) {
        const current = await this.getPage(page.page_id);
        if (isTerminal(current.state)) break;

        const round = await steps.do(
          `generate ${page.page_id} attempt ${semanticAttempt}`,
          { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
          () => this.generateRound(context, page, semanticAttempt)
        );
        if (round.terminal) break;

        for (const candidateId of round.candidateIds) {
          await steps.do(
            `print QA ${candidateId}`,
            {
              retries: {
                limit: 3,
                delay: "2 seconds",
                backoff: "exponential",
              },
              timeout: "3 minutes",
            },
            () =>
              this.runPrintQaCandidate(
                context,
                page,
                candidateId,
                semanticAttempt
              )
          );
        }
        await steps.do(`complete print QA ${page.page_id}`, () =>
          this.completePrintQa(page.page_id)
        );
        for (let slot = 0; slot < round.candidateIds.length; slot += 1) {
          const candidateId = round.candidateIds[slot]!;
          await steps.do(`style QA ${candidateId}`, () =>
            this.runStyleQaCandidate(
              context,
              page,
              candidateId,
              semanticAttempt,
              slot
            )
          );
        }
        const decision = await steps.do(
          `decide style QA ${page.page_id} attempt ${semanticAttempt}`,
          () => this.decideStyleQa(page, semanticAttempt)
        );
        if (decision.state !== "repairing") break;
        await steps.do(
          `schedule repair ${page.page_id} round ${semanticAttempt + 1}`,
          () =>
            this.scheduleRepair(page, semanticAttempt + 1, decision.candidateId)
        );
      }
    }

    return steps.do(`finalize run ${runId}`, () => this.finalizeRun(runId));
  }

  async failRun(runId: string, reason: string): Promise<void> {
    const now = this.now();
    const run = await this.getRun(runId);
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE pages SET state = 'needs_human_review', terminal_reason = ?,
             updated_at = ?
           WHERE run_id = ? AND state IN ('print_qa', 'style_qa', 'repairing')`
        )
        .bind(reason, now, runId),
      this.database
        .prepare(
          `UPDATE pages SET state = 'provider_failed', terminal_reason = ?,
             updated_at = ?
           WHERE run_id = ? AND state IN ('created', 'analyzing', 'generating')`
        )
        .bind(reason, now, runId),
      this.database
        .prepare(
          `UPDATE book_runs SET status = 'failed', updated_at = ?, completed_at = ?
           WHERE run_id = ? AND status IN ('created', 'running')`
        )
        .bind(now, now, runId),
      this.database
        .prepare(
          "UPDATE books SET status = 'review', updated_at = ? WHERE book_id = ?"
        )
        .bind(now, run.book_id),
    ]);
  }

  private async startRun(runId: string): Promise<RunContext> {
    const context = await this.database
      .prepare(
        `SELECT r.*, c.provider, c.model, c.style_judge_model,
                c.style_judge_cost_micros, c.execution_profile,
                c.candidate_cost_micros, c.initial_candidate_count,
                c.created_at AS config_created_at
         FROM book_runs r
         JOIN book_run_execution_configs c ON c.run_id = r.run_id
         WHERE r.run_id = ?`
      )
      .bind(runId)
      .first<RunContext>();
    if (!context) throw new Error(`Book Run ${runId} was not found`);
    if (context.provider === "gemini") {
      await this.requireStyleBible(context.style_pack_version);
    }
    if (context.status === "created") {
      const now = this.now();
      await this.database.batch([
        this.database
          .prepare(
            "UPDATE book_runs SET status = 'running', updated_at = ? WHERE run_id = ? AND status = 'created'"
          )
          .bind(now, runId),
        this.database
          .prepare(
            "UPDATE books SET status = 'processing', updated_at = ? WHERE book_id = ?"
          )
          .bind(now, context.book_id),
      ]);
      context.status = "running";
    }
    return context;
  }

  private async loadPages(runId: string): Promise<PageContext[]> {
    const result = await this.database
      .prepare(
        `SELECT p.*, r.book_id
         FROM pages p JOIN book_runs r ON r.run_id = p.run_id
         WHERE p.run_id = ? ORDER BY p.page_id`
      )
      .bind(runId)
      .all<PageContext>();
    return result.results;
  }

  private async acceptPage(page: PageContext): Promise<void> {
    const current = await this.getPage(page.page_id);
    if (current.state !== "created") return;
    const now = this.now();
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE pages SET state = 'analyzing', updated_at = ? WHERE page_id = ? AND state = 'created'"
        )
        .bind(now, page.page_id),
      this.database
        .prepare(
          "UPDATE photos SET intake_status = 'accepted' WHERE photo_id = ?"
        )
        .bind(page.photo_id),
    ]);
    await this.database
      .prepare(
        "UPDATE pages SET state = 'generating', updated_at = ? WHERE page_id = ? AND state = 'analyzing'"
      )
      .bind(now, page.page_id)
      .run();
  }

  private async generateRound(
    run: RunContext,
    page: PageContext,
    semanticAttempt: number
  ): Promise<RoundResult> {
    const operationId = `generate:${page.page_id}:${semanticAttempt}`;
    const existing = await this.completedOperation<RoundResult>(operationId);
    if (existing) return existing;

    const candidateCount = semanticAttempt === 0
      ? run.initial_candidate_count
      : REPAIR_CANDIDATE_COUNT;
    const estimatedCost = candidateCount * run.candidate_cost_micros;
    const refreshedRun = await this.getRun(run.run_id);
    if (
      refreshedRun.cost_spent_micros + estimatedCost >
      refreshedRun.cost_ceiling_micros
    ) {
      await this.movePageTo(
        page.page_id,
        "budget_exhausted",
        "book_run_cost_ceiling"
      );
      return { candidateIds: [], terminal: "budget_exhausted" };
    }

    const now = this.now();
    const operationKind =
      semanticAttempt === 0 ? "generate_initial" : "generate_repair";
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO operations
           (operation_id, run_id, page_id, operation_kind, status, semantic_attempt,
            infrastructure_retry_count, outcome_json, failure_class, created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, 'claimed', ?, 0, NULL, NULL, ?, ?, NULL)
           ON CONFLICT(operation_id) DO NOTHING`
        )
        .bind(
          operationId,
          run.run_id,
          page.page_id,
          operationKind,
          semanticAttempt,
          now,
          now
        ),
      this.database
        .prepare(
          `INSERT INTO provider_attempts
           (provider_attempt_id, operation_id, run_id, provider, model,
            provider_request_id, infrastructure_attempt, semantic_attempt, status,
            estimated_cost_micros, actual_cost_micros, started_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, 'submitted', ?, NULL, ?, NULL)
           ON CONFLICT(operation_id, infrastructure_attempt) DO NOTHING`
        )
        .bind(
          `provider:${operationId}:1`,
          operationId,
          run.run_id,
          run.provider,
          run.model,
          operationId,
          semanticAttempt,
          estimatedCost,
          now
        ),
    ]);

    const candidateIds: string[] = [];
    const firstOrdinal = semanticAttempt === 0 ? 1 : 2 + semanticAttempt * 2;
    for (let slot = 0; slot < candidateCount; slot += 1) {
      const ordinal = firstOrdinal + slot;
      const candidateId = `candidate-${page.page_id}-${semanticAttempt}-${slot + 1}`;
      const existingCandidate = await this.database
        .prepare("SELECT raw_artifact_id FROM candidates WHERE candidate_id = ?")
        .bind(candidateId)
        .first<{ raw_artifact_id: string | null }>();
      if (existingCandidate?.raw_artifact_id) {
        candidateIds.push(candidateId);
        continue;
      }
      const rawArtifactId = `raw:${candidateId}`;
      const existingRaw = await this.artifacts.getRecord(rawArtifactId);
      const generated = existingRaw
        ? null
        : run.provider === "gemini"
          ? await this.generateProviderCandidate(run, page, semanticAttempt, slot)
          : {
              body: new TextEncoder().encode(mockCandidateSvg(candidateId, semanticAttempt)),
              mimeType: "image/svg+xml",
              relations: [] as Array<{ sourceArtifactId: string; kind: "derived_from" | "references" }>,
            };
      const rawFormat = generated?.mimeType === "image/jpeg"
        ? "jpg"
        : generated?.mimeType === "image/webp"
          ? "webp"
          : run.provider === "gemini" ? "png" : "svg";
      const rawKey = objectKeys.candidate({
        bookId: page.book_id,
        runId: run.run_id,
        pageId: page.page_id,
        candidateId,
        variant: "raw",
        format: rawFormat,
      });
      if (generated) await this.artifacts.putImmutable({
        artifactId: rawArtifactId,
        runId: run.run_id,
        pageId: page.page_id,
        producingOperationId: operationId,
        objectKey: rawKey,
        artifactKind: "candidate_raw",
        schemaVersion: SCHEMA_VERSION,
        body: generated.body,
        mimeType: generated.mimeType,
        provider: run.provider,
        model: run.model,
        retentionClass: "derived",
        createdAt: now,
        relations: generated.relations,
      });
      await this.database
        .prepare(
          `INSERT INTO candidates
           (candidate_id, page_id, operation_id, repair_round_id, generation_kind,
            ordinal, raw_artifact_id, clean_artifact_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
           ON CONFLICT(candidate_id) DO NOTHING`
        )
        .bind(
          candidateId,
          page.page_id,
          operationId,
          semanticAttempt === 0
            ? null
            : `repair:${page.page_id}:${semanticAttempt}`,
          semanticAttempt === 0 ? "initial" : "repair",
          ordinal,
          rawArtifactId,
          now
        )
        .run();
      candidateIds.push(candidateId);
    }

    const outcome: RoundResult = { candidateIds, terminal: null };
    await this.database.batch([
      this.database
        .prepare(
          `UPDATE provider_attempts
           SET status = 'succeeded', actual_cost_micros = ?, completed_at = ?
           WHERE operation_id = ? AND infrastructure_attempt = 1
             AND actual_cost_micros IS NULL`
        )
        .bind(estimatedCost, now, operationId),
      this.database
        .prepare(
          `UPDATE operations SET status = 'completed', outcome_json = ?,
             updated_at = ?, completed_at = ? WHERE operation_id = ?`
        )
        .bind(JSON.stringify(outcome), now, now, operationId),
      this.database
        .prepare(
          `UPDATE pages SET state = 'print_qa', updated_at = ?
           WHERE page_id = ? AND state = ?`
        )
        .bind(
          now,
          page.page_id,
          semanticAttempt === 0 ? "generating" : "repairing"
        ),
    ]);
    if (semanticAttempt > 0) {
      await this.database
        .prepare(
          `UPDATE repair_rounds SET status = 'completed', completed_at = ?
           WHERE repair_round_id = ?`
        )
        .bind(now, `repair:${page.page_id}:${semanticAttempt}`)
        .run();
    }
    return outcome;
  }

  private async generateProviderCandidate(
    run: RunContext,
    page: PageContext,
    semanticAttempt: number,
    slot: number
  ): Promise<{
    body: Uint8Array;
    mimeType: string;
    relations: Array<{ sourceArtifactId: string; kind: "derived_from" | "references" }>;
  }> {
    if (!this.providerConfig.apiKey) {
      throw new Error("GEMINI_API_KEY secret is required for Gemini runs");
    }
    const photo = await this.database
      .prepare("SELECT source_artifact_id FROM photos WHERE photo_id = ?")
      .bind(page.photo_id)
      .first<{ source_artifact_id: string | null }>();
    if (!photo?.source_artifact_id) throw new Error(`Source photo for ${page.page_id} is missing`);
    const normalizedArtifactId = `normalized:${page.page_id}`;
    const source = await this.artifacts.read(normalizedArtifactId);
    const sourceBytes = await source.object.arrayBuffer();
    const refs = await this.loadCanonicalReferenceImages(
      run.style_pack_version,
      Math.max(0, 14 * 1024 * 1024 - sourceBytes.byteLength)
    );
    const styleBible = await this.requireStyleBible(run.style_pack_version);
    const corrections = await this.loadGenerationFeedback(run.run_id, page.page_id, semanticAttempt);
    const prompt = [
      "Create a printable black-and-white coloring-book line illustration based on the source photo.",
      "Preserve the main subject and recognizable traits. Use confident clean outlines, simple faces, large open coloring areas, and a restrained or empty background. Do not add captions, lettering, gray fills, hatching, frames, decorative textures, or tiny enclosed coloring zones.",
      `Generate candidate variation ${slot + 1}; vary the composition slightly while preserving the same subject and style.`,
      corrections ? `CORRECTIONS FROM PRIOR JUDGE AND REVIEW\n${corrections}` : "",
    ].filter(Boolean).join("\n\n");
    const result = await generateGeminiImage({
      apiKey: this.providerConfig.apiKey,
      model: run.model,
      prompt,
      source: { mimeType: source.record.mime_type, bytes: sourceBytes },
      styleBible,
      references: refs.map(ref => ({ mimeType: ref.mimeType, bytes: ref.bytes })),
    });
    const mimeType = result.mimeType === "image/jpeg" || result.mimeType === "image/webp"
      ? result.mimeType
      : "image/png";
    return {
      body: result.bytes,
      mimeType,
      relations: [
        { sourceArtifactId: normalizedArtifactId, kind: "derived_from" },
        ...refs.map(ref => ({ sourceArtifactId: ref.artifactId, kind: "references" as const })),
      ],
    };
  }

  private async normalizeSource(page: PageContext): Promise<void> {
    if (!this.images.normalize) return;
    const operationId = `normalize:${page.page_id}`;
    const artifactId = `normalized:${page.page_id}`;
    const now = this.now();
    await this.claimOperation(
      operationId,
      page.run_id,
      page.page_id,
      "normalize",
      0,
      now
    );
    const existing = await this.artifacts.getRecord(artifactId);
    if (existing) {
      await this.artifacts.verify(artifactId);
      await this.completeOperationStatement(
        operationId,
        { artifactId, objectKey: existing.object_key },
        this.now()
      ).run();
      return;
    }
    const photo = await this.database
      .prepare("SELECT source_artifact_id FROM photos WHERE photo_id = ?")
      .bind(page.photo_id)
      .first<{ source_artifact_id: string | null }>();
    if (!photo?.source_artifact_id) throw new Error(`Source photo for ${page.page_id} is missing`);
    const source = await this.artifacts.getRecord(photo.source_artifact_id);
    if (!source) throw new Error(`Source Artifact ${photo.source_artifact_id} is missing`);
    const outputKey = objectKeys.normalizedPhoto({
      bookId: page.book_id,
      runId: page.run_id,
      photoId: page.photo_id,
      revision: "v1",
    });
    const normalized = await this.images.normalize({
      pageId: page.page_id,
      operationId,
      input: { artifactId: source.artifact_id, objectKey: source.object_key, sha256: source.sha256 },
      output: { artifactId, objectKey: outputKey },
    });
    await this.artifacts.registerExternalImmutable({
      artifactId,
      runId: page.run_id,
      pageId: page.page_id,
      producingOperationId: operationId,
      objectKey: outputKey,
      artifactKind: "normalized_photo",
      schemaVersion: IMAGE_OPERATION_SCHEMA_VERSION,
      sha256: normalized.artifact.sha256,
      byteSize: normalized.artifact.byteSize,
      mimeType: normalized.artifact.mimeType,
      retentionClass: "derived",
      createdAt: this.now(),
      relations: [{ sourceArtifactId: source.artifact_id, kind: "derived_from" }],
    });
    await this.completeOperationStatement(
      operationId,
      { artifactId, objectKey: outputKey },
      this.now()
    ).run();
  }

  private async loadCanonicalReferenceImages(
    stylePackVersion: string,
    remainingBytes: number
  ): Promise<Array<GeminiImagePart & { artifactId: string }>> {
    const rows = await this.database.prepare(
      `SELECT artifact_id FROM canonical_references
       WHERE style_pack_version = ? AND retired_at IS NULL
       ORDER BY style_pack_revision DESC LIMIT 2`
    ).bind(stylePackVersion).all<{ artifact_id: string }>();
    const references: Array<GeminiImagePart & { artifactId: string }> = [];
    for (const row of rows.results) {
      try {
        const artifact = await this.artifacts.read(row.artifact_id);
        if (artifact.record.byte_size > remainingBytes) continue;
        const bytes = await artifact.object.arrayBuffer();
        references.push({
          artifactId: row.artifact_id,
          mimeType: artifact.record.mime_type,
          bytes,
        });
        remainingBytes -= bytes.byteLength;
      } catch {
        // A missing reference is omitted; the style bible still guides generation.
      }
    }
    return references;
  }

  private async requireStyleBible(stylePackVersion: string): Promise<string> {
    const object = await this.bucket.get(objectKeys.styleBible(stylePackVersion));
    if (!object) {
      throw new Error(`Required style bible is missing for style pack ${stylePackVersion}`);
    }
    const styleBible = (await object.text()).trim();
    if (!styleBible) {
      throw new Error(`Required style bible is empty for style pack ${stylePackVersion}`);
    }
    return styleBible.slice(0, 24_000);
  }

  private async loadGenerationFeedback(
    runId: string,
    pageId: string,
    semanticAttempt: number
  ): Promise<string | null> {
    const regeneration = await this.database.prepare(
      "SELECT feedback_json FROM book_run_regenerations WHERE new_run_id = ?"
    ).bind(runId).first<{ feedback_json: string }>();
    const items: unknown[] = [];
    if (regeneration) {
      try { items.push(JSON.parse(regeneration.feedback_json)); } catch { /* ignore malformed legacy data */ }
    }
    if (semanticAttempt > 0) {
      const prior = await this.database.prepare(
        `SELECT c.candidate_id, q.status, q.overall_score, q.artifact_id
         FROM candidates c JOIN operations o ON o.operation_id = c.operation_id
         JOIN qa_results q ON q.candidate_id = c.candidate_id AND q.qa_kind = 'style'
         WHERE c.page_id = ? AND o.semantic_attempt = ?
         ORDER BY q.overall_score DESC, c.ordinal LIMIT 1`
      ).bind(pageId, semanticAttempt - 1).first<{
        candidate_id: string; status: string; overall_score: number | null; artifact_id: string | null;
      }>();
      if (prior) {
        let details: unknown;
        if (prior.artifact_id) {
          try { details = JSON.parse(await (await this.artifacts.read(prior.artifact_id)).object.text()); } catch { /* status and score are still useful */ }
        }
        const reviews = await this.database.prepare(
          `SELECT decision, notes FROM reviews WHERE page_id = ? AND candidate_id = ?
           ORDER BY created_at DESC LIMIT 5`
        ).bind(pageId, prior.candidate_id).all<{ decision: string; notes: string | null }>();
        items.push({ judgeFinding: { candidateId: prior.candidate_id, status: prior.status, score: prior.overall_score, details }, reviewerNotes: reviews.results });
      }
    }
    return items.length ? JSON.stringify(items).slice(0, 12_000) : null;
  }

  private async runPrintQaCandidate(
    run: RunContext,
    page: PageContext,
    candidateId: string,
    semanticAttempt: number
  ): Promise<void> {
    const operationId = `print:${candidateId}`;
    if (await this.completedOperation(operationId)) return;
    const candidate = await this.getCandidate(candidateId);
    const raw = await this.artifacts.getRecord(candidate.raw_artifact_id ?? "");
    if (!raw) throw new Error(`Raw Artifact for ${candidateId} is missing`);
    const now = this.now();
    await this.claimOperation(
      operationId,
      run.run_id,
      page.page_id,
      "print_qa",
      semanticAttempt,
      now
    );

    const cleanArtifactId = `clean:${candidateId}`;
    const cleanKey = objectKeys.candidate({
      bookId: page.book_id,
      runId: run.run_id,
      pageId: page.page_id,
      candidateId,
      variant: "clean",
    });
    const cleaned = await this.images.cleanup({
      pageId: page.page_id,
      operationId: `cleanup:${candidateId}`,
      input: {
        artifactId: raw.artifact_id,
        objectKey: raw.object_key,
        sha256: raw.sha256,
      },
      output: { artifactId: cleanArtifactId, objectKey: cleanKey },
    });
    await this.artifacts.registerExternalImmutable({
      artifactId: cleanArtifactId,
      runId: run.run_id,
      pageId: page.page_id,
      producingOperationId: operationId,
      objectKey: cleanKey,
      artifactKind: "candidate_clean",
      schemaVersion: IMAGE_OPERATION_SCHEMA_VERSION,
      sha256: cleaned.artifact.sha256,
      byteSize: cleaned.artifact.byteSize,
      mimeType: cleaned.artifact.mimeType,
      provider: run.provider,
      model: run.model,
      retentionClass: "derived",
      createdAt: now,
      relations: [{ sourceArtifactId: raw.artifact_id, kind: "derived_from" }],
    });

    const qaArtifactId = `print-qa:${candidateId}`;
    const qaKey = objectKeys.candidateQa({
      bookId: page.book_id,
      runId: run.run_id,
      pageId: page.page_id,
      candidateId,
      kind: "print",
    });
    const qa = await this.images.printQa({
      pageId: page.page_id,
      operationId,
      input: {
        artifactId: cleanArtifactId,
        objectKey: cleanKey,
        sha256: cleaned.artifact.sha256,
      },
      output: { artifactId: qaArtifactId, objectKey: qaKey },
    });
    if (!qa.assessment) throw new Error("Print QA returned no assessment");
    await this.artifacts.registerExternalImmutable({
      artifactId: qaArtifactId,
      runId: run.run_id,
      pageId: page.page_id,
      producingOperationId: operationId,
      objectKey: qaKey,
      artifactKind: "print_qa",
      schemaVersion: IMAGE_OPERATION_SCHEMA_VERSION,
      sha256: qa.artifact.sha256,
      byteSize: qa.artifact.byteSize,
      mimeType: "application/json",
      retentionClass: "audit",
      createdAt: now,
      relations: [{ sourceArtifactId: cleanArtifactId, kind: "judges" }],
    });
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE candidates SET clean_artifact_id = ? WHERE candidate_id = ?"
        )
        .bind(cleanArtifactId, candidateId),
      this.database
        .prepare(
          `INSERT INTO qa_results
             (qa_result_id, candidate_id, qa_kind, status, overall_score, artifact_id, created_at)
             VALUES (?, ?, 'print', ?, ?, ?, ?)
             ON CONFLICT(candidate_id, qa_kind) DO NOTHING`
        )
        .bind(
          `qa:print:${candidateId}`,
          candidateId,
          qa.assessment.status,
          qa.assessment.score,
          qaArtifactId,
          now
        ),
      this.completeOperationStatement(
        operationId,
        { candidateId, qaArtifactId },
        now
      ),
    ]);
  }

  private async completePrintQa(pageId: string): Promise<void> {
    await this.database
      .prepare(
        "UPDATE pages SET state = 'style_qa', updated_at = ? WHERE page_id = ? AND state = 'print_qa'"
      )
      .bind(this.now(), pageId)
      .run();
  }

  private async runStyleQaCandidate(
    run: RunContext,
    page: PageContext,
    candidateId: string,
    semanticAttempt: number,
    slot: number
  ): Promise<void> {
    const operationId = `style:${candidateId}`;
    if (await this.completedOperation(operationId)) return;
    const candidate = await this.getCandidate(candidateId);
    const now = this.now();
    const model = run.style_judge_model;
    await this.claimOperation(
      operationId,
      run.run_id,
      page.page_id,
      "style_qa",
      semanticAttempt,
      now
    );
    let existingEvaluation: Record<string, unknown> | undefined;
    if (run.provider === "gemini") {
      try {
        const prior = await this.artifacts.read(`style-qa:${candidateId}`);
        existingEvaluation = JSON.parse(await prior.object.text()) as Record<string, unknown>;
      } catch {
        existingEvaluation = undefined;
      }
    }
    if (run.provider === "gemini" && !existingEvaluation) {
      if (!this.providerConfig.apiKey) throw new Error("Gemini API key is required for Style QA");
      const judgeCost = run.style_judge_cost_micros;
      await this.database.prepare(
        `INSERT INTO provider_attempts
         (provider_attempt_id, operation_id, run_id, provider, model, provider_request_id,
          infrastructure_attempt, semantic_attempt, status, estimated_cost_micros,
          actual_cost_micros, started_at, completed_at)
         VALUES (?, ?, ?, 'gemini', ?, ?, 1, ?, 'submitted', ?, NULL, ?, NULL)
         ON CONFLICT(operation_id, infrastructure_attempt) DO NOTHING`
      ).bind(`provider:${operationId}:1`, operationId, run.run_id, model, operationId,
        semanticAttempt, judgeCost, now).run();
    }
    let judge: Record<string, unknown>;
    let score: number;
    let recordedStatus: "passed" | "needs_review" | undefined;
    if (run.provider === "gemini") {
      if (existingEvaluation) {
        score = Number(existingEvaluation.score);
        recordedStatus = existingEvaluation.status === "passed" ? "passed" : "needs_review";
        judge = existingEvaluation;
      } else {
        if (!this.providerConfig.apiKey) throw new Error("Gemini API key is required for Style QA");
        if (!candidate.clean_artifact_id) throw new Error(`Clean candidate ${candidateId} is missing`);
        const clean = await this.artifacts.read(candidate.clean_artifact_id);
        const refs = await this.loadCanonicalReferenceImages(run.style_pack_version, 14 * 1024 * 1024 - clean.record.byte_size);
        const styleBible = await this.requireStyleBible(run.style_pack_version);
        const evaluation = await judgeGeminiStyle({
          apiKey: this.providerConfig.apiKey,
          model,
          candidate: { mimeType: clean.record.mime_type, bytes: await clean.object.arrayBuffer() },
          styleBible,
          references: refs.map(ref => ({ mimeType: ref.mimeType, bytes: ref.bytes })),
        });
        const values = Object.values(evaluation.dimensions);
        score = values.reduce((sum, value) => sum + value, 0) / values.length;
        judge = {
          judge: "gemini-style-qa-v1",
          dimensions: evaluation.dimensions,
          findings: evaluation.findings,
          correctionPrompt: evaluation.correctionPrompt,
        };
      }
    } else {
      score = mockStyleScore(run.execution_profile, semanticAttempt, slot);
      judge = { judge: "mock-style-v1" };
    }
    const status = recordedStatus ?? (score >= STYLE_PASS_SCORE ? "passed" : "needs_review");
    const artifactId = `style-qa:${candidateId}`;
    await this.artifacts.putImmutable({
      artifactId,
      runId: run.run_id,
      pageId: page.page_id,
      producingOperationId: operationId,
      objectKey: objectKeys.candidateQa({
        bookId: page.book_id,
        runId: run.run_id,
        pageId: page.page_id,
        candidateId,
        kind: "style",
      }),
      artifactKind: "style_qa",
      schemaVersion: SCHEMA_VERSION,
      body: new TextEncoder().encode(JSON.stringify({ candidateId, status, score, ...judge })),
      mimeType: "application/json",
      provider: run.provider,
      model,
      retentionClass: "audit",
      createdAt: now,
      relations: candidate.clean_artifact_id
        ? [{ sourceArtifactId: candidate.clean_artifact_id, kind: "judges" }]
        : [],
    });
    const completionStatements = [
      this.database
        .prepare(
          `INSERT INTO qa_results
             (qa_result_id, candidate_id, qa_kind, status, overall_score, artifact_id, created_at)
             VALUES (?, ?, 'style', ?, ?, ?, ?)
             ON CONFLICT(candidate_id, qa_kind) DO NOTHING`
        )
        .bind(
          `qa:style:${candidateId}`,
          candidateId,
          status,
          score,
          artifactId,
          now
        ),
      this.completeOperationStatement(
        operationId,
        { candidateId, artifactId, status, score },
        now
      ),
    ];
    if (run.provider === "gemini") {
      completionStatements.push(this.database.prepare(
        `UPDATE provider_attempts SET status = 'succeeded', actual_cost_micros = ?, completed_at = ?
         WHERE operation_id = ? AND infrastructure_attempt = 1 AND actual_cost_micros IS NULL`
      ).bind(run.style_judge_cost_micros, now, operationId));
    }
    await this.database.batch(completionStatements);
  }

  private async decideStyleQa(
    page: PageContext,
    semanticAttempt: number
  ): Promise<QaDecision> {
    const approved = await this.database
      .prepare(
        `SELECT c.candidate_id
         FROM candidates c
         JOIN qa_results p ON p.candidate_id = c.candidate_id
           AND p.qa_kind = 'print' AND p.status = 'passed'
         JOIN qa_results s ON s.candidate_id = c.candidate_id
           AND s.qa_kind = 'style' AND s.status = 'passed'
         WHERE c.page_id = ?
         ORDER BY s.overall_score DESC, c.ordinal ASC LIMIT 1`
      )
      .bind(page.page_id)
      .first<{ candidate_id: string }>();
    if (approved) {
      await this.database
        .prepare(
          `UPDATE pages SET state = 'approved', approved_candidate_id = ?,
             approval_source = 'automatic', terminal_reason = NULL, updated_at = ?
           WHERE page_id = ? AND state = 'style_qa'`
        )
        .bind(approved.candidate_id, this.now(), page.page_id)
        .run();
      return {
        state: "approved",
        candidateId: approved.candidate_id,
        reason: "dual_qa_passed",
      };
    }

    const best = await this.bestStyleCandidate(page.page_id, semanticAttempt);
    if (semanticAttempt >= MAX_REPAIR_ROUNDS) {
      await this.movePageTo(
        page.page_id,
        "needs_human_review",
        "maximum_rounds_reached"
      );
      return {
        state: "needs_human_review",
        candidateId: best.candidateId,
        reason: "maximum_rounds_reached",
      };
    }
    if (semanticAttempt > 0) {
      const previous = await this.bestStyleCandidate(
        page.page_id,
        semanticAttempt - 1
      );
      if (best.score - previous.score < MIN_IMPROVEMENT) {
        await this.movePageTo(
          page.page_id,
          "needs_human_review",
          "improvement_below_minimum"
        );
        return {
          state: "needs_human_review",
          candidateId: best.candidateId,
          reason: "improvement_below_minimum",
        };
      }
    }
    return {
      state: "repairing",
      candidateId: best.candidateId,
      reason: "style_below_threshold",
    };
  }

  private async scheduleRepair(
    page: PageContext,
    roundNumber: number,
    sourceCandidateId: string | null
  ): Promise<void> {
    const now = this.now();
    await this.database.batch([
      this.database
        .prepare(
          `INSERT INTO repair_rounds
           (repair_round_id, page_id, round_number, requested_candidate_count,
            source_candidate_id, status, strategy, created_at, completed_at)
           VALUES (?, ?, ?, 2, ?, 'claimed', 'repair_candidate', ?, NULL)
           ON CONFLICT(page_id, round_number) DO NOTHING`
        )
        .bind(
          `repair:${page.page_id}:${roundNumber}`,
          page.page_id,
          roundNumber,
          sourceCandidateId,
          now
        ),
      this.database
        .prepare(
          "UPDATE pages SET state = 'repairing', updated_at = ? WHERE page_id = ? AND state = 'style_qa'"
        )
        .bind(now, page.page_id),
    ]);
  }

  private async finalizeRun(runId: string) {
    const states = await this.database
      .prepare("SELECT state FROM pages WHERE run_id = ?")
      .bind(runId)
      .all<{ state: PageRecord["state"] }>();
    const allApproved = states.results.every(page => page.state === "approved");
    const status = allApproved ? "completed" : "partially_completed";
    const now = this.now();
    const run = await this.getRun(runId);
    await this.database.batch([
      this.database
        .prepare(
          "UPDATE book_runs SET status = ?, updated_at = ?, completed_at = ? WHERE run_id = ?"
        )
        .bind(status, now, now, runId),
      this.database
        .prepare(
          "UPDATE books SET status = ?, updated_at = ? WHERE book_id = ?"
        )
        .bind(allApproved ? "completed" : "review", now, run.book_id),
    ]);
    return {
      runId,
      status,
      pageStates: states.results.map(page => page.state),
    };
  }

  private async claimOperation(
    operationId: string,
    runId: string,
    pageId: string,
    kind: "normalize" | "print_qa" | "style_qa",
    semanticAttempt: number,
    now: string
  ): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO operations
         (operation_id, run_id, page_id, operation_kind, status, semantic_attempt,
          infrastructure_retry_count, outcome_json, failure_class, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, 'claimed', ?, 0, NULL, NULL, ?, ?, NULL)
         ON CONFLICT(operation_id) DO NOTHING`
      )
      .bind(operationId, runId, pageId, kind, semanticAttempt, now, now)
      .run();
  }

  private completeOperationStatement(
    operationId: string,
    outcome: unknown,
    now: string
  ) {
    return this.database
      .prepare(
        `UPDATE operations SET status = 'completed', outcome_json = ?,
         updated_at = ?, completed_at = ? WHERE operation_id = ?`
      )
      .bind(JSON.stringify(outcome), now, now, operationId);
  }

  private async completedOperation<T = unknown>(
    operationId: string
  ): Promise<T | null> {
    const row = await this.database
      .prepare(
        "SELECT outcome_json FROM operations WHERE operation_id = ? AND status = 'completed'"
      )
      .bind(operationId)
      .first<{ outcome_json: string }>();
    return row ? (JSON.parse(row.outcome_json) as T) : null;
  }

  private async bestStyleCandidate(pageId: string, semanticAttempt: number) {
    const row = await this.database
      .prepare(
        `SELECT c.candidate_id, q.overall_score
         FROM candidates c
         JOIN operations o ON o.operation_id = c.operation_id
         JOIN qa_results q ON q.candidate_id = c.candidate_id AND q.qa_kind = 'style'
         WHERE c.page_id = ? AND o.semantic_attempt = ?
         ORDER BY q.overall_score DESC, c.ordinal ASC LIMIT 1`
      )
      .bind(pageId, semanticAttempt)
      .first<{ candidate_id: string; overall_score: number }>();
    if (!row)
      throw new Error(
        `No Style QA result for ${pageId} attempt ${semanticAttempt}`
      );
    return { candidateId: row.candidate_id, score: row.overall_score };
  }

  private async getPage(pageId: string): Promise<PageRecord> {
    const page = await this.database
      .prepare("SELECT * FROM pages WHERE page_id = ?")
      .bind(pageId)
      .first<PageRecord>();
    if (!page) throw new Error(`Page ${pageId} was not found`);
    return page;
  }

  private async getRun(runId: string): Promise<BookRunRecord> {
    const run = await this.database
      .prepare("SELECT * FROM book_runs WHERE run_id = ?")
      .bind(runId)
      .first<BookRunRecord>();
    if (!run) throw new Error(`Book Run ${runId} was not found`);
    return run;
  }

  private async getCandidate(candidateId: string): Promise<CandidateRecord> {
    const candidate = await this.database
      .prepare("SELECT * FROM candidates WHERE candidate_id = ?")
      .bind(candidateId)
      .first<CandidateRecord>();
    if (!candidate) throw new Error(`Candidate ${candidateId} was not found`);
    return candidate;
  }

  private async movePageTo(
    pageId: string,
    state: "needs_human_review" | "budget_exhausted",
    reason: string
  ): Promise<void> {
    await this.database
      .prepare(
        "UPDATE pages SET state = ?, terminal_reason = ?, updated_at = ? WHERE page_id = ?"
      )
      .bind(state, reason, this.now(), pageId)
      .run();
  }
}

const isTerminal = (state: PageRecord["state"]): boolean =>
  [
    "intake_rejected",
    "intake_needs_review",
    "needs_human_review",
    "provider_failed",
    "budget_exhausted",
    "approved",
    "rejected",
  ].includes(state);

const mockStyleScore = (
  profile: ExecutionProfile,
  semanticAttempt: number,
  slot: number
): number => {
  if (profile === "mock_pass_initial") {
    return semanticAttempt === 0 && slot === 0 ? 0.82 : 0.61;
  }
  if (profile === "mock_pass_after_repair") {
    return semanticAttempt >= 1 && slot === 0 ? 0.76 : 0.61 - slot * 0.01;
  }
  return [0.5, 0.56, 0.62][semanticAttempt] ?? 0.62;
};

const mockCandidateSvg = (
  candidateId: string,
  semanticAttempt: number
): string =>
  `
<svg xmlns="http://www.w3.org/2000/svg" width="2480" height="3508" viewBox="0 0 2480 3508">
  <rect width="2480" height="3508" fill="white"/>
  <rect x="90" y="90" width="2300" height="3328" rx="80" fill="none" stroke="black" stroke-width="64"/>
  <circle cx="1240" cy="1150" r="620" fill="white" stroke="black" stroke-width="54"/>
  <circle cx="1010" cy="1050" r="55" fill="black"/><circle cx="1470" cy="1050" r="55" fill="black"/>
  <path d="M930 1350 Q1240 1600 1550 1350" fill="none" stroke="black" stroke-width="54" stroke-linecap="round"/>
  <path d="M560 2900 Q1240 2050 1920 2900" fill="none" stroke="black" stroke-width="70"/>
  <text x="120" y="3380" font-size="1" fill="white">${candidateId}-${semanticAttempt}</text>
</svg>`.trim();
