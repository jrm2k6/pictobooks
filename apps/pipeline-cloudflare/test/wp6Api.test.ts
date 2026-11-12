import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SessionAuthenticator, sha256Hex } from "../src/api/auth.js";
import {
  ApiProblem,
  PipelineApi,
  type BookRunLauncher,
} from "../src/api/pipelineApi.js";
import type {
  ArtifactSigner,
  SignedArtifactRequest,
} from "../src/api/r2Presigner.js";
import { handleApiRequest, type RuntimeEnv } from "../src/api/router.js";

const now = new Date("2026-11-10T12:00:00.000Z");
const owner = { userId: "user-owner", sessionId: "session-owner" };
const stranger = { userId: "user-stranger", sessionId: "session-stranger" };
const photoBytes = new TextEncoder().encode("synthetic uploaded photo");

class FakeSigner implements ArtifactSigner {
  signUpload(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    artifactId: string;
    runId: string;
    expiresInSeconds: number;
  }): Promise<SignedArtifactRequest> {
    return Promise.resolve({
      url: `https://signed.invalid/upload/${encodeURIComponent(input.objectKey)}?signature=test`,
      method: "PUT",
      headers: { "Content-Type": input.contentType },
      expiresAt: "2026-11-10T12:15:00.000Z",
    });
  }

  signDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<SignedArtifactRequest> {
    return Promise.resolve({
      url: `https://signed.invalid/download/${encodeURIComponent(input.objectKey)}?signature=test`,
      method: "GET",
      headers: {},
      expiresAt: "2026-11-10T12:05:00.000Z",
    });
  }
}

class FakeLauncher implements BookRunLauncher {
  readonly started = new Set<string>();

  start(runId: string): Promise<void> {
    this.started.add(runId);
    return Promise.resolve();
  }
}

describe("WP6 authenticated pipeline API", () => {
  let launcher: FakeLauncher;
  let api: PipelineApi;

  beforeEach(async () => {
    await reset();
    await applyD1Migrations(
      env.PIPELINE_DB,
      Reflect.get(env, "TEST_MIGRATIONS") as D1Migration[]
    );
    launcher = new FakeLauncher();
    api = new PipelineApi(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeSigner(),
      launcher,
      () => now
    );
  });

  it("authenticates only live opaque sessions", async () => {
    const token = "a".repeat(48);
    await insertSession(
      "session-owner",
      owner.userId,
      token,
      "2099-11-13T00:00:00.000Z"
    );
    const auth = new SessionAuthenticator(env.PIPELINE_DB, () =>
      now.toISOString()
    );

    await expect(
      auth.authenticate(
        new Request("https://api.invalid/v1/books", {
          headers: { Authorization: `Bearer ${token}` },
        })
      )
    ).resolves.toEqual(owner);
    await expect(
      auth.authenticate(
        new Request("https://api.invalid/v1/books", {
          headers: { Authorization: `Bearer ${"b".repeat(48)}` },
        })
      )
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("enforces authentication and idempotency at the HTTP router", async () => {
    const unauthorized = await handleApiRequest(
      new Request("https://api.invalid/v1/books", { method: "POST" }),
      env as RuntimeEnv
    );
    expect(unauthorized?.status).toBe(401);

    const token = "r".repeat(48);
    await insertSession(
      "session-router",
      owner.userId,
      token,
      "2099-11-13T00:00:00.000Z"
    );
    const missingKey = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      }),
      env as RuntimeEnv
    );
    expect(missingKey?.status).toBe(400);
    expect(await missingKey?.json()).toEqual({
      error: "idempotency_key_required",
    });

    const created = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": "router-create-book-001",
        },
      }),
      env as RuntimeEnv
    );
    expect(created?.status).toBe(201);
  });

  it("creates a run with scoped upload intents and replays without duplicates", async () => {
    const book = await api.createBook(owner, "create-book-001");
    const replay = await api.createBook(owner, "create-book-001");
    expect(replay).toEqual(book);
    const bookId = String(book.body.bookId);
    const sha256 = await digest(photoBytes);

    const created = await api.createBookRun(owner, "create-run-001", bookId, {
      photos: [
        { contentType: "image/jpeg", byteSize: photoBytes.byteLength, sha256 },
      ],
    });
    const replayed = await api.createBookRun(owner, "create-run-001", bookId, {
      photos: [
        { contentType: "image/jpeg", byteSize: photoBytes.byteLength, sha256 },
      ],
    });

    expect(replayed).toEqual(created);
    expect(await scalar("SELECT count(*) FROM books")).toBe(1);
    expect(await scalar("SELECT count(*) FROM book_runs")).toBe(1);
    expect(await scalar("SELECT count(*) FROM upload_intents")).toBe(1);
    expect(JSON.stringify(created.body)).not.toContain("secret");
    await expect(
      api.createBookRun(stranger, "cross-user-run", bookId, {
        photos: [
          {
            contentType: "image/jpeg",
            byteSize: photoBytes.byteLength,
            sha256,
          },
        ],
      })
    ).rejects.toMatchObject({ status: 404, code: "book_not_found" });
  });

  it("verifies a direct upload before starting exactly one Book Run", async () => {
    const { bookId, runId } = await createRun();
    const intent = await env.PIPELINE_DB.prepare(
      "SELECT * FROM upload_intents WHERE run_id = ?"
    )
      .bind(runId)
      .first<{
        artifact_id: string;
        object_key: string;
        sha256: string;
        content_type: string;
      }>();
    if (!intent) throw new Error("Upload intent missing");
    await env.PIPELINE_ARTIFACTS.put(intent.object_key, photoBytes, {
      httpMetadata: { contentType: intent.content_type },
      customMetadata: {
        artifactid: intent.artifact_id,
        runid: runId,
        sha256: intent.sha256,
        schemaversion: "2026-11-10",
        retentionclass: "source",
      },
      sha256: await crypto.subtle.digest("SHA-256", photoBytes),
    });

    const started = await api.startBookRun(
      owner,
      "start-run-001",
      bookId,
      runId
    );
    const replay = await api.startBookRun(
      owner,
      "start-run-001",
      bookId,
      runId
    );

    expect(replay).toEqual(started);
    expect(launcher.started).toEqual(new Set([runId]));
    expect(await scalar("SELECT count(*) FROM artifacts")).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM api_idempotency WHERE completed_at IS NOT NULL"
      )
    ).toBe(3);
  });

  it("runs the authenticated local upload path through local R2", async () => {
    const localApi = new PipelineApi(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeSigner(),
      launcher,
      () => now,
      {
        provider: "mock",
        model: "mock-coloring-page-v1",
        styleJudgeModel: "mock-style-v1",
        candidateCostMicros: 1000,
        styleJudgeCostMicros: 0,
        initialCandidateCount: 2,
        apiKeyConfigured: false,
      },
      true
    );
    const book = await localApi.createBook(owner, "local-create-book-001");
    const bookId = String(book.body.bookId);
    const sha256 = await digest(photoBytes);
    const created = await localApi.createBookRun(owner, "local-create-run-001", bookId, {
      photos: Array.from({ length: 5 }, () => ({
        contentType: "image/jpeg" as const,
        byteSize: photoBytes.byteLength,
        sha256,
      })),
    });
    const runId = String(created.body.runId);
    const uploads = created.body.uploads as Array<{
      uploadIntentId: string;
      photoId: string;
      artifactId: string;
      uploadUrl: string;
    }>;
    expect(uploads).toHaveLength(5);
    expect(uploads[0]?.uploadUrl).toMatch(/^\/v1\/books\//);
    expect(uploads[0]?.uploadUrl).not.toContain("r2.cloudflarestorage.com");

    for (const upload of uploads) {
      const result = await localApi.acceptLocalUpload(
        owner,
        bookId,
        runId,
        upload.uploadIntentId,
        new Request(`https://local.invalid${upload.uploadUrl}`, {
          method: "PUT",
          headers: { "Content-Type": "image/jpeg" },
          body: photoBytes,
        })
      );
      expect(result.status).toBe(201);
    }

    await localApi.updatePhotoOrder(
      owner,
      "local-order-photos-001",
      bookId,
      runId,
      uploads.map(upload => upload.photoId).reverse()
    );
    const refreshed = await localApi.refreshUploadIntent(
      owner,
      "local-refresh-upload-001",
      bookId,
      runId,
      uploads[0]!.uploadIntentId,
      "https://local.invalid"
    );
    expect(refreshed.body.uploadUrl).toContain("/content");

    await localApi.startBookRun(owner, "local-start-run-001", bookId, runId);
    const access = await localApi.getArtifactAccess(owner, uploads[0]!.artifactId);
    const response = await localApi.readLocalArtifact(owner, uploads[0]!.artifactId);
    expect((access.body.access as { url: string }).url).toContain("/content");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(photoBytes);
  });

  it("authorizes exact-Candidate review, promotion, artifact access, and regeneration", async () => {
    const seeded = await seedReviewablePage();

    await expect(
      api.reviewCandidate(
        stranger,
        "stranger-review-001",
        seeded.bookId,
        seeded.pageId,
        { candidateId: seeded.candidateId, decision: "approved" }
      )
    ).rejects.toMatchObject({ status: 404, code: "candidate_not_found" });

    const review = await api.reviewCandidate(
      owner,
      "approve-candidate-001",
      seeded.bookId,
      seeded.pageId,
      {
        candidateId: seeded.candidateId,
        decision: "approved",
        notes: "Acceptable exception for this source photo.",
      }
    );
    expect(
      await api.reviewCandidate(
        owner,
        "approve-candidate-001",
        seeded.bookId,
        seeded.pageId,
        { candidateId: seeded.candidateId, decision: "approved" }
      )
    ).toEqual(review);
    expect(await scalar("SELECT count(*) FROM reviews")).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM pages WHERE state = 'approved' AND approval_source = 'human'"
      )
    ).toBe(1);

    const promoted = await api.promoteCanonical(
      owner,
      "canonical-promote-001",
      seeded.bookId,
      seeded.candidateId,
      {
        reviewId: String(review.body.reviewId),
        stylePackVersion: "pictobook-preschool-v0.1",
      }
    );
    expect(
      await api.promoteCanonical(
        owner,
        "canonical-promote-001",
        seeded.bookId,
        seeded.candidateId,
        {
          reviewId: String(review.body.reviewId),
          stylePackVersion: "pictobook-preschool-v0.1",
        }
      )
    ).toEqual(promoted);
    expect(await scalar("SELECT count(*) FROM canonical_references")).toBe(1);

    const access = await api.getArtifactAccess(owner, seeded.artifactId);
    expect(String((access.body.access as SignedArtifactRequest).url)).toContain(
      "signature=test"
    );
    await expect(
      api.getArtifactAccess(stranger, seeded.artifactId)
    ).rejects.toMatchObject({ status: 404, code: "artifact_not_found" });

    const regenerated = await api.regeneratePage(
      owner,
      "regenerate-page-001",
      seeded.bookId,
      seeded.pageId
    );
    expect(regenerated.status).toBe(202);
    expect(launcher.started.has(String(regenerated.body.runId))).toBe(true);
    expect(await scalar("SELECT count(*) FROM book_run_regenerations")).toBe(1);
  });

  it("rejects a reviewable page with an exact Candidate revision", async () => {
    const seeded = await seedReviewablePage();
    const rejected = await api.reviewCandidate(
      owner,
      "reject-candidate-001",
      seeded.bookId,
      seeded.pageId,
      { candidateId: seeded.candidateId, decision: "rejected" }
    );

    expect(rejected.status).toBe(201);
    expect(
      await scalar(
        "SELECT count(*) FROM pages WHERE state = 'rejected' AND terminal_reason = 'human_rejected'"
      )
    ).toBe(1);
  });

  it("rejects reuse of an idempotency key for a different mutation", async () => {
    const book = await api.createBook(owner, "shared-key-001");
    await expect(
      api.createBookRun(owner, "shared-key-001", String(book.body.bookId), {
        photos: [
          {
            contentType: "image/jpeg",
            byteSize: photoBytes.byteLength,
            sha256: await digest(photoBytes),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ApiProblem);
  });

  const createRun = async () => {
    const book = await api.createBook(owner, "create-book-for-run");
    const bookId = String(book.body.bookId);
    const created = await api.createBookRun(
      owner,
      "create-upload-run",
      bookId,
      {
        photos: [
          {
            contentType: "image/jpeg",
            byteSize: photoBytes.byteLength,
            sha256: await digest(photoBytes),
          },
        ],
      }
    );
    return { bookId, runId: String(created.body.runId) };
  };
});

const seedReviewablePage = async () => {
  const timestamp = now.toISOString();
  const bookId = "book-review-owner";
  const runId = "run-review-owner";
  const photoId = "photo-review-owner";
  const pageId = "page-review-owner";
  const candidateId = "candidate-review-owner";
  const artifactId = "clean:candidate-review-owner";
  const objectKey =
    "books/book-review-owner/runs/run-review-owner/pages/page-review-owner/candidates/candidate-review-owner/clean.png";
  const artifactBytes = new TextEncoder().encode("clean candidate");
  const artifactSha = await digest(artifactBytes);
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(
      "INSERT INTO books VALUES (?, ?, 'review', ?, ?)"
    ).bind(bookId, owner.userId, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO book_runs VALUES (?, ?, 'partially_completed', 'pictobook-preschool-v0.1', 7000, 3000, ?, ?, ?)"
    ).bind(runId, bookId, timestamp, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO photos VALUES (?, ?, 1, ?, 'accepted', ?)"
    ).bind(photoId, runId, `source:${photoId}`, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO pages
       (page_id, run_id, photo_id, state, initial_candidate_count,
        repair_round_count, approved_candidate_id, approval_source,
        terminal_reason, created_at, updated_at)
       VALUES (?, ?, ?, 'created', 0, 0, NULL, NULL, NULL, ?, ?)`
    ).bind(pageId, runId, photoId, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO operations
       VALUES ('generate-review-owner', ?, ?, 'generate_initial', 'completed',
               0, 1, '{}', NULL, ?, ?, ?)`
    ).bind(runId, pageId, timestamp, timestamp, timestamp),
  ]);
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'analyzing' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'generating' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  await env.PIPELINE_DB.prepare(
    `INSERT INTO candidates
     VALUES (?, ?, 'generate-review-owner', NULL, 'initial', 1, NULL, ?, ?)`
  )
    .bind(candidateId, pageId, artifactId, timestamp)
    .run();
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'print_qa' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'needs_human_review', terminal_reason = 'style_below_threshold' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  await env.PIPELINE_ARTIFACTS.put(objectKey, artifactBytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: {
      artifactId,
      runId,
      sha256: artifactSha,
      schemaVersion: "2026-11-10",
      retentionClass: "derived",
    },
    sha256: await crypto.subtle.digest("SHA-256", artifactBytes),
  });
  await env.PIPELINE_DB.prepare(
    `INSERT INTO artifacts
     (artifact_id, run_id, page_id, producing_operation_id, object_key,
      artifact_kind, schema_version, sha256, byte_size, mime_type, provider,
      model, retention_class, deleted_at, created_at)
     VALUES (?, ?, ?, 'generate-review-owner', ?, 'candidate_clean',
             '2026-11-10', ?, ?, 'image/png', 'mock', 'mock-v1',
             'derived', NULL, ?)`
  )
    .bind(
      artifactId,
      runId,
      pageId,
      objectKey,
      artifactSha,
      artifactBytes.byteLength,
      timestamp
    )
    .run();
  return { bookId, runId, pageId, candidateId, artifactId };
};

const insertSession = async (
  sessionId: string,
  userId: string,
  token: string,
  expiresAt: string
) => {
  await env.PIPELINE_DB.prepare(
    `INSERT INTO api_sessions
     (session_id, token_sha256, user_id, expires_at, revoked_at, created_at)
     VALUES (?, ?, ?, ?, NULL, ?)`
  )
    .bind(
      sessionId,
      await sha256Hex(token),
      userId,
      expiresAt,
      now.toISOString()
    )
    .run();
};

const digest = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), value =>
    value.toString(16).padStart(2, "0")
  ).join("");
};

const scalar = async (query: string): Promise<number> => {
  const row =
    await env.PIPELINE_DB.prepare(query).first<Record<string, number>>();
  if (!row) throw new Error(`No result for ${query}`);
  return Object.values(row)[0] ?? 0;
};
