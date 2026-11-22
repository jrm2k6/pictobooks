import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  JwtAuthenticator,
  sha256Hex,
  type JwksFetcher,
} from "../src/api/auth.js";
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

// ---- JWT helpers --------------------------------------------------------

let testKeyPair: CryptoKeyPair;
let testPublicJwk: JsonWebKey & { kid: string };
const TEST_KID = "test-kid-001";

const encodeBase64Url = (data: unknown): string =>
  btoa(JSON.stringify(data))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

const signJwt = async (
  sub: string,
  overrides: { exp?: number } = {}
): Promise<string> => {
  const exp = overrides.exp ?? Math.floor(Date.now() / 1000) + 3600;
  const jti = crypto.randomUUID();
  const headerB64 = encodeBase64Url({ alg: "RS256", kid: TEST_KID });
  const payloadB64 = encodeBase64Url({ sub, exp, jti });
  const sigInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const rawSig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    testKeyPair.privateKey,
    sigInput
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(rawSig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${headerB64}.${payloadB64}.${sigB64}`;
};

const mockJwksFetcher: JwksFetcher = async () => [testPublicJwk];

// ---- Test infrastructure ------------------------------------------------

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

// ---- Setup ---------------------------------------------------------------

beforeAll(async () => {
  testKeyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"]
  );
  const rawPublicJwk = await crypto.subtle.exportKey(
    "jwk",
    testKeyPair.publicKey
  );
  testPublicJwk = { ...rawPublicJwk, kid: TEST_KID };
});

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
    // Mock fetch to serve the test JWKS for the router JWT auth path
    vi.stubGlobal(
      "fetch",
      async (_input: RequestInfo | URL): Promise<Response> => {
        return new Response(JSON.stringify({ keys: [testPublicJwk] }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("authenticates Clerk JWTs and rejects invalid or expired tokens", async () => {
    const auth = new JwtAuthenticator(
      "https://test.invalid/jwks.json",
      mockJwksFetcher
    );

    const validJwt = await signJwt(owner.userId);
    await expect(
      auth.authenticate(
        new Request("https://api.invalid/v1/books", {
          headers: { Authorization: `Bearer ${validJwt}` },
        })
      )
    ).resolves.toMatchObject({ userId: owner.userId });

    // No auth header
    await expect(
      auth.authenticate(new Request("https://api.invalid/v1/books"))
    ).rejects.toMatchObject({ name: "AuthenticationError" });

    // Not a JWT (opaque token)
    await expect(
      auth.authenticate(
        new Request("https://api.invalid/v1/books", {
          headers: { Authorization: `Bearer ${"b".repeat(48)}` },
        })
      )
    ).rejects.toMatchObject({ name: "AuthenticationError" });

    // Expired token
    const expiredJwt = await signJwt(owner.userId, { exp: 1 });
    await expect(
      auth.authenticate(
        new Request("https://api.invalid/v1/books", {
          headers: { Authorization: `Bearer ${expiredJwt}` },
        })
      )
    ).rejects.toMatchObject({ name: "AuthenticationError" });
  });

  it("enforces authentication and idempotency at the HTTP router", async () => {
    const unauthorized = await handleApiRequest(
      new Request("https://api.invalid/v1/books", { method: "POST" }),
      env as unknown as RuntimeEnv
    );
    expect(unauthorized?.status).toBe(401);

    const jwt = await signJwt(owner.userId);

    const missingKey = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "POST",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env as unknown as RuntimeEnv
    );
    expect(missingKey?.status).toBe(400);
    expect(await missingKey?.json()).toMatchObject({
      type: "/errors/idempotency_key_required",
      title: "idempotency_key_required",
      status: 400,
      code: "idempotency_key_required",
    });

    const created = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwt}`,
          "Idempotency-Key": "router-create-book-001",
        },
      }),
      env as unknown as RuntimeEnv
    );
    expect(created?.status).toBe(201);
  });

  it("returns CORS headers for allowed origins and handles preflight", async () => {
    const preflight = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:4176" },
      }),
      env as unknown as RuntimeEnv
    );
    expect(preflight?.status).toBe(204);
    expect(preflight?.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://127.0.0.1:4176"
    );

    const jwt = await signJwt(owner.userId);
    const response = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${jwt}`,
          Origin: "https://studio.pictobook.app",
        },
      }),
      env as unknown as RuntimeEnv
    );
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://studio.pictobook.app"
    );

    // Unknown origin → no CORS header
    const noOrigin = await handleApiRequest(
      new Request("https://api.invalid/v1/books", {
        method: "GET",
        headers: { Authorization: `Bearer ${jwt}` },
      }),
      env as unknown as RuntimeEnv
    );
    expect(noOrigin?.headers.get("Access-Control-Allow-Origin")).toBeNull();
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

  it("creates a book with personalization fields and updates them", async () => {
    const book = await api.createBook(owner, "personalized-book-001", {
      title: "Emma's Adventure Book",
      childName: "Emma",
      childAge: 5,
    });
    expect(book.status).toBe(201);
    expect(book.body).toMatchObject({
      bookId: expect.any(String),
      status: "draft",
    });
    const bookId = String(book.body.bookId);

    const updated = await api.updateBook(owner, "update-book-001", bookId, {
      title: "Emma's Big Adventure",
      childAge: 6,
    });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      bookId,
      status: "draft",
      title: "Emma's Big Adventure",
      childName: "Emma",
      childAge: 6,
    });

    const books = await api.listBooks(owner);
    const listed = (books.body.books as Array<Record<string, unknown>>).find(
      b => b["bookId"] === bookId
    );
    expect(listed).toMatchObject({
      bookId,
      title: "Emma's Big Adventure",
      childName: "Emma",
      childAge: 6,
    });

    // Strangers cannot update
    await expect(
      api.updateBook(stranger, "stranger-update-001", bookId, {
        title: "Hacked",
      })
    ).rejects.toMatchObject({ status: 404 });
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
    const created = await localApi.createBookRun(
      owner,
      "local-create-run-001",
      bookId,
      {
        photos: Array.from({ length: 5 }, () => ({
          contentType: "image/jpeg" as const,
          byteSize: photoBytes.byteLength,
          sha256,
        })),
      }
    );
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
    const access = await localApi.getArtifactAccess(
      owner,
      uploads[0]!.artifactId
    );
    const response = await localApi.readLocalArtifact(
      owner,
      uploads[0]!.artifactId
    );
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
    ).rejects.toMatchObject({
      status: 403,
      code: "regeneration_limit_reached",
    });
    expect(
      await scalar(
        "SELECT count(*) FROM book_run_regenerations WHERE kind = 'candidate_regeneration'"
      )
    ).toBe(3);
  });

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
        `INSERT INTO photos (photo_id, run_id, ordinal, intake_status, created_at)
         VALUES ('photo-kind-a', 'run-kind-a', 1, 'accepted', ?)`
      ).bind(timestamp),
      env.PIPELINE_DB.prepare(
        `INSERT INTO pages (page_id, run_id, photo_id, state, initial_candidate_count, repair_round_count, approved_candidate_id, approval_source, terminal_reason, created_at, updated_at)
         VALUES ('page-kind-a', 'run-kind-a', 'photo-kind-a', 'created', 0, 0, NULL, NULL, NULL, ?, ?)`
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
      await scalar(
        `SELECT kind FROM book_run_regenerations WHERE new_run_id = '${created.body.runId}'`
      )
    ).toBe("photo_replacement");
    expect(
      await scalar(
        `SELECT state FROM pages WHERE page_id = '${created.body.pageId}'`
      )
    ).toBe("created");
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
    ).rejects.toMatchObject({
      status: 403,
      code: "regeneration_limit_reached",
    });
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
  const timestamp = new Date("2026-11-10T12:00:00.000Z").toISOString();
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
      `INSERT INTO books (book_id, owner_id, status, created_at, updated_at)
       VALUES (?, ?, 'review', ?, ?)`
    ).bind(bookId, "user-owner", timestamp, timestamp),
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

// Keep sha256Hex in scope for helpers that compute hashes
void sha256Hex;

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
