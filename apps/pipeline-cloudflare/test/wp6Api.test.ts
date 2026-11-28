import { env } from "cloudflare:workers";
import { PDFDocument, PDFName, PDFNumber, PageSizes } from "pdf-lib";
import { mockCandidateSvg } from "../src/book-run/mockPageDrawing.js";
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

  it("allows opaque D1 sessions only when LOCAL_CUSTOMER_API is enabled", async () => {
    const opaqueToken = "local_smoke_token_" + "a".repeat(32);
    const tokenHash = await sha256Hex(opaqueToken);
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await env.PIPELINE_DB.prepare(
      `INSERT INTO api_sessions
       (session_id, token_sha256, user_id, expires_at, revoked_at, created_at)
       VALUES ('session-local-001', ?, ?, ?, NULL, ?)`
    )
      .bind(tokenHash, owner.userId, futureExpiry, now.toISOString())
      .run();

    const makeRequest = () =>
      new Request("https://api.invalid/v1/books", {
        headers: { Authorization: `Bearer ${opaqueToken}` },
      });

    // Hosted/non-local runtime must reject opaque D1 tokens even if seeded.
    const hostedRes = await handleApiRequest(makeRequest(), {
      ...(env as unknown as RuntimeEnv),
      LOCAL_CUSTOMER_API: "false",
    });
    expect(hostedRes?.status).toBe(401);

    // Local runtime accepts valid opaque D1 session without Clerk JWKS.
    const localRes = await handleApiRequest(makeRequest(), {
      ...(env as unknown as RuntimeEnv),
      LOCAL_CUSTOMER_API: "true",
      CLERK_JWKS_URL: "",
    });
    expect(localRes?.status).toBe(200);
  });

  it("serves private printable PDFs only to the owner when explicitly enabled", async () => {
    const { bookId, runId, pageId, candidateId } = await seedReviewablePage();
    await setPrintableCandidate(pageId, MINI_PNGS[0]);
    await api.reviewCandidate(owner, "printable-approval-001", bookId, pageId, {
      candidateId,
      decision: "approved",
    });

    const runUrl = `https://api.invalid/v1/books/${bookId}/runs/${runId}`;
    const downloadUrl = `${runUrl}/printable-pdf`;
    const runtime = env as unknown as RuntimeEnv;
    const enabled = { ...runtime, PRINTABLE_PDF_ENABLED: "true" };
    const request = async (url: string, userId = owner.userId) =>
      new Request(url, {
        headers: {
          Authorization: `Bearer ${await signJwt(userId)}`,
          Origin: "https://studio.pictobook.app",
        },
      });
    const download = await request(downloadUrl);
    expect(
      (await handleApiRequest(new Request(downloadUrl), enabled))?.status
    ).toBe(401);
    expect((await handleApiRequest(download, runtime))?.status).toBe(404);
    expect(
      (
        await handleApiRequest(
          await request(downloadUrl, stranger.userId),
          enabled
        )
      )?.status
    ).toBe(404);
    const response = await handleApiRequest(download, enabled);
    expect(response?.status).toBe(200);
    expect(response?.headers.get("Content-Type")).toBe("application/pdf");
    expect(response?.headers.get("Content-Disposition")).toBe(
      'attachment; filename="pictobook.pdf"'
    );
    expect(response?.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://studio.pictobook.app"
    );
    expect(
      (await PDFDocument.load(await response!.arrayBuffer())).getPageCount()
    ).toBe(1);
    const runRequest = await request(runUrl);
    expect(
      await (await handleApiRequest(runRequest, runtime))?.json()
    ).toMatchObject({
      printablePdfEnabled: false,
    });
    expect(
      await (await handleApiRequest(runRequest, enabled))?.json()
    ).toMatchObject({
      printablePdfEnabled: true,
    });
  });

  it("updates only owned primary page inclusion, validates the body and replays a setting without overwriting newer choices", async () => {
    const { bookId, runId, pageId, candidateId } = await seedReviewablePage();
    const approval = await api.reviewCandidate(
      owner,
      "approval-before-removal",
      bookId,
      pageId,
      {
        candidateId,
        decision: "approved",
      }
    );
    expect(
      (await api.getBookRun(owner, bookId, runId)).body.pages
    ).toMatchObject([{ pageId, included: true }]);
    const update = async (
      included: unknown,
      key: string,
      overrides: { ownerId?: string; bookId?: string; runId?: string } = {}
    ) =>
      handleApiRequest(
        new Request(
          `https://api.invalid/v1/books/${overrides.bookId ?? bookId}/runs/${overrides.runId ?? runId}/pages/${pageId}/inclusion`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${await signJwt(overrides.ownerId ?? owner.userId)}`,
              "Content-Type": "application/json",
              "Idempotency-Key": key,
            },
            body: JSON.stringify({ included }),
          }
        ),
        env as unknown as RuntimeEnv
      );
    expect((await update("false", "include-missing-bool"))?.status).toBe(400);
    expect((await update(undefined, "include-missing-bool"))?.status).toBe(400);
    expect(
      (
        await update(false, "stranger-page-inclusion", {
          ownerId: stranger.userId,
        })
      )?.status
    ).toBe(404);
    const other = await seedIntakeRejectedPage();
    expect(
      (
        await update(false, "wrong-book-page-inclusion", {
          bookId: other.bookId,
        })
      )?.status
    ).toBe(404);
    expect(
      (await update(false, "wrong-run-page-inclusion", { runId: other.runId }))
        ?.status
    ).toBe(404);

    const remove = await update(false, "remove-page-inclusion");
    expect(remove?.status).toBe(200);
    expect(await remove?.json()).toEqual({ pageId, included: false });
    expect(
      (await api.getBookRun(owner, bookId, runId)).body.pages
    ).toMatchObject([
      {
        pageId,
        included: false,
        approvedCandidateId: candidateId,
        approvalSource: "human",
      },
    ]);
    const restore = await update(true, "restore-page-inclusion");
    expect(await restore?.json()).toEqual({ pageId, included: true });
    expect(
      await (await update(false, "remove-page-inclusion"))?.json()
    ).toEqual({ pageId, included: false });
    expect((await update(false, "restore-page-inclusion"))?.status).toBe(409);
    expect(
      (await api.getBookRun(owner, bookId, runId)).body.pages
    ).toMatchObject([
      {
        pageId,
        included: true,
        approvedCandidateId: candidateId,
        approvalSource: "human",
      },
    ]);
    expect(
      await env.PIPELINE_DB.prepare(
        "SELECT review_id FROM reviews WHERE page_id = ?"
      )
        .bind(pageId)
        .first("review_id")
    ).toBe(approval.body.reviewId);
    expect(launcher.started.size).toBe(0);
  });

  it("rolls back a page inclusion update if storing its idempotent response fails", async () => {
    const { bookId, runId, pageId } = await seedReviewablePage();
    const remove = () =>
      api.setPageInclusion(
        owner,
        "remove-interrupted-page",
        bookId,
        runId,
        pageId,
        false
      );
    const db = env.PIPELINE_DB;
    await db
      .prepare(
        `CREATE TRIGGER interrupt_inclusion_response
       BEFORE UPDATE OF response_status ON api_idempotency
       WHEN NEW.idempotency_key = 'remove-interrupted-page' AND NEW.response_status = 200
       BEGIN SELECT RAISE(ABORT, 'test response failure'); END`
      )
      .run();

    await expect(remove()).rejects.toThrow("test response failure");
    expect(
      await db
        .prepare("SELECT included FROM pages WHERE page_id = ?")
        .bind(pageId)
        .first("included")
    ).toBe(1);
    expect(
      await db
        .prepare(
          "SELECT response_status FROM api_idempotency WHERE idempotency_key = ?"
        )
        .bind("remove-interrupted-page")
        .first()
    ).toEqual({ response_status: null });

    await db.prepare("DROP TRIGGER interrupt_inclusion_response").run();
    const removed = await remove();
    expect(removed.body).toEqual({ pageId, included: false });
    await api.setPageInclusion(
      owner,
      "restore-interrupted-page",
      bookId,
      runId,
      pageId,
      true
    );
    expect(await remove()).toEqual(removed);
    expect(
      await db
        .prepare("SELECT included FROM pages WHERE page_id = ?")
        .bind(pageId)
        .first("included")
    ).toBe(1);
  });

  it("exports the latest live lineage in photo order and rejects direct derivative downloads", async () => {
    const { bookId, runId, pageId, candidateId } = await seedReviewablePage();
    const rootB = "page-alphabetically-first";
    const child = "page-current-replacement";
    const grandchild = "page-current-regeneration";
    await env.PIPELINE_DB.prepare(
      "UPDATE photos SET ordinal = 2 WHERE run_id = ?"
    )
      .bind(runId)
      .run();
    const rootBCandidate = await seedPrintablePage({
      runId,
      pageId: rootB,
      ordinal: 1,
    });
    for (const [id, sourceId, sourceRunId, timestamp, expired] of [
      [child, pageId, runId, "2026-11-10T11:00:00.000Z", false],
      ["page-tied-sibling", pageId, runId, "2026-11-10T11:00:00.000Z", false],
      [
        "page-newer-but-expired",
        pageId,
        runId,
        "2026-11-10T11:15:00.000Z",
        true,
      ],
      [grandchild, child, child, "2026-11-10T11:30:00.000Z", false],
    ] as const) {
      await env.PIPELINE_DB.prepare(
        "INSERT INTO book_runs VALUES (?, ?, 'partially_completed', 'pictobook-preschool-v0.1', 7000, 3000, ?, ?, ?)"
      )
        .bind(id, bookId, timestamp, timestamp, timestamp)
        .run();
      await seedPrintablePage({ runId: id, pageId: id, ordinal: 1 });
      await env.PIPELINE_DB.prepare(
        "INSERT INTO book_run_regenerations (new_run_id, source_run_id, source_page_id, requested_by, created_at, kind) VALUES (?, ?, ?, ?, ?, ?)"
      )
        .bind(
          id,
          sourceRunId,
          sourceId,
          owner.userId,
          timestamp,
          id === grandchild ? "candidate_regeneration" : "photo_replacement"
        )
        .run();
      if (expired) {
        await env.PIPELINE_DB.batch([
          env.PIPELINE_DB.prepare(
            "UPDATE photos SET source_artifact_id = NULL WHERE run_id = ?"
          ).bind(id),
          env.PIPELINE_DB.prepare(
            `INSERT INTO upload_intents VALUES (?, ?, ?, ?, ?, ?, ?, 'image/png', 1, ?, ?, NULL, ?)`
          ).bind(
            id,
            owner.userId,
            bookId,
            id,
            `photo-${id}`,
            `source:${id}`,
            `uploads/${id}`,
            "0".repeat(64),
            timestamp,
            timestamp
          ),
        ]);
      }
    }

    await env.PIPELINE_DB.prepare(
      `WITH RECURSIVE seq(n) AS (
         SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 105
       )
       INSERT INTO book_runs
       SELECT 'unrelated-draft-' || n, ?, 'created', 'pictobook-preschool-v0.1',
         7000, 0, ?, ?, NULL
       FROM seq`
    )
      .bind(bookId, now.toISOString(), now.toISOString())
      .run();
    const { body: defaultRuns } = await api.listBookRuns(owner, bookId);
    expect(defaultRuns.runs).toHaveLength(100);
    const { body: liveLineage } = await api.listBookRuns(owner, bookId, true);
    expect(liveLineage.runs).toMatchObject([
      { run_id: grandchild },
      { run_id: child },
      { run_id: "page-tied-sibling" },
    ]);

    await setPrintableCandidate(pageId, MINI_PNGS[0]);
    await setPrintableCandidate(rootB, MINI_PNGS[1]);
    await setPrintableCandidate(grandchild, MINI_PNGS[2]);
    for (const [id, candidate] of [
      [pageId, candidateId],
      [rootB, rootBCandidate],
    ]) {
      await api.reviewCandidate(owner, `approve-${id}`, bookId, id, {
        candidateId: candidate,
        decision: "approved",
      });
    }
    const runUrl = `https://api.invalid/v1/books/${bookId}/runs`;
    const runtime = {
      ...env,
      PRINTABLE_PDF_ENABLED: "true",
    } as unknown as RuntimeEnv;
    const jwt = await signJwt(owner.userId);
    const request = (path: string) =>
      handleApiRequest(
        new Request(`${runUrl}/${path}`, {
          headers: { Authorization: `Bearer ${jwt}` },
        }),
        runtime
      );

    expect((await request(`${runId}/printable-pdf`))?.status).toBe(409);
    await expect(
      api.setPageInclusion(
        owner,
        "remove-derivative-slot",
        bookId,
        grandchild,
        grandchild,
        false
      )
    ).rejects.toMatchObject({ status: 404, code: "page_not_found" });
    await api.setPageInclusion(
      owner,
      "remove-replaced-slot",
      bookId,
      runId,
      pageId,
      false
    );
    const retained = await request(`${runId}/printable-pdf`);
    expect(retained?.status).toBe(200);
    expect(
      (await PDFDocument.load(await retained!.arrayBuffer())).getPageCount()
    ).toBe(1);
    await api.setPageInclusion(
      owner,
      "remove-last-slot",
      bookId,
      runId,
      rootB,
      false
    );
    expect((await request(`${runId}/printable-pdf`))?.status).toBe(409);
    await api.setPageInclusion(
      owner,
      "restore-first-slot",
      bookId,
      runId,
      rootB,
      true
    );
    await api.setPageInclusion(
      owner,
      "restore-replaced-slot",
      bookId,
      runId,
      pageId,
      true
    );
    expect((await request(`${runId}/printable-pdf`))?.status).toBe(409);

    await api.reviewCandidate(owner, "approve-grandchild", bookId, grandchild, {
      candidateId: `candidate-${grandchild}-0-1`,
      decision: "approved",
    });
    expect((await request(`${grandchild}/printable-pdf`))?.status).toBe(404);
    expect(await (await request(grandchild))?.json()).toMatchObject({
      printablePdfEnabled: false,
    });
    expect(await (await request(runId))?.json()).toMatchObject({
      pages: [{ pageId: rootB }, { pageId }],
    });
    const response = await request(`${runId}/printable-pdf`);
    expect(response?.status).toBe(200);
    const pdf = await PDFDocument.load(await response!.arrayBuffer());
    expect(
      pdf.getPages().map(page => {
        const [imageRef] = page.node
          .Resources()!
          .lookup(PDFName.of("XObject"))
          .values();
        const image = pdf.context.lookup(imageRef);
        return {
          size: [page.getWidth(), page.getHeight()],
          imageWidth: image.dict
            .lookup(PDFName.of("Width"), PDFNumber)
            .asNumber(),
        };
      })
    ).toEqual([
      { size: PageSizes.Letter, imageWidth: 4 },
      { size: PageSizes.Letter, imageWidth: 6 },
    ]);
  });

  it("rejects automatic approval and prints the built-in local mock drawing", async () => {
    const auto = await seedAutoApprovedPage();
    const localRuntime = {
      ...env,
      LOCAL_CUSTOMER_API: "true",
      PRINTABLE_PDF_ENABLED: "true",
    } as unknown as RuntimeEnv;
    const jwt = await signJwt(owner.userId);
    const request = (bookId: string, runId: string) =>
      handleApiRequest(
        new Request(
          `https://api.invalid/v1/books/${bookId}/runs/${runId}/printable-pdf`,
          {
            headers: { Authorization: `Bearer ${jwt}` },
          }
        ),
        localRuntime
      );
    await setPrintableCandidate(auto.pageId, MINI_PNGS[0]);
    expect(
      await (await request(auto.bookId, auto.runId))?.json()
    ).toMatchObject({ code: "printable_pdf_not_ready" });

    const mock = await seedReviewablePage();
    const generatedCandidateId = `candidate-${mock.pageId}-0-1`;
    await env.PIPELINE_DB.prepare(
      "UPDATE candidates SET candidate_id = ? WHERE candidate_id = ?"
    )
      .bind(generatedCandidateId, mock.candidateId)
      .run();
    await setPrintableCandidate(
      mock.pageId,
      new TextEncoder().encode(mockCandidateSvg(generatedCandidateId, 0)),
      "image/svg+xml"
    );
    await api.reviewCandidate(
      owner,
      "approve-mock-001",
      mock.bookId,
      mock.pageId,
      {
        candidateId: generatedCandidateId,
        decision: "approved",
      }
    );
    const response = await request(mock.bookId, mock.runId);
    expect(response?.status).toBe(200);
    expect(
      (await PDFDocument.load(await response!.arrayBuffer())).getPageCount()
    ).toBe(1);
    await env.PIPELINE_DB.prepare(
      "UPDATE artifacts SET deleted_at = ? WHERE artifact_id = ?"
    )
      .bind(now.toISOString(), mock.artifactId)
      .run();
    expect((await request(mock.bookId, mock.runId))?.status).toBe(409);
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

  it("leaves the original intake-rejected page unmutated after a successful photo replacement", async () => {
    const seeded = await seedIntakeRejectedPage();
    const before = await env.PIPELINE_DB.prepare(
      "SELECT state, terminal_reason, updated_at FROM pages WHERE page_id = ?"
    )
      .bind(seeded.pageId)
      .first<{
        state: string;
        terminal_reason: string | null;
        updated_at: string;
      }>();
    expect(before?.state).toBe("intake_rejected");

    const created = await api.createPhotoReplacement(
      owner,
      "photo-replacement-unmutated-001",
      seeded.bookId,
      seeded.pageId,
      { contentType: "image/jpeg", byteSize: 1024, sha256: "f".repeat(64) }
    );
    expect(created.status).toBe(201);

    const after = await env.PIPELINE_DB.prepare(
      "SELECT state, terminal_reason, updated_at FROM pages WHERE page_id = ?"
    )
      .bind(seeded.pageId)
      .first<{
        state: string;
        terminal_reason: string | null;
        updated_at: string;
      }>();
    expect(after).toEqual(before);
    expect(after?.state).toBe("intake_rejected");

    expect(
      await scalar(
        `SELECT count(*) FROM pages WHERE page_id = '${created.body.pageId}' AND state = 'created'`
      )
    ).toBe(1);
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

  it("does not count an abandoned, expired photo replacement against the cap", async () => {
    // Uses its own clock-controlled PipelineApi instance so "now" can be
    // advanced past the 15-minute upload window without affecting other
    // tests that rely on the module-level fixed `now`.
    let clockNow = now;
    const clockedApi = new PipelineApi(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeSigner(),
      launcher,
      () => clockNow
    );
    const seeded = await seedIntakeRejectedPage();

    // Abandoned replacement: upload intent is created but never completed.
    const abandoned = await clockedApi.createPhotoReplacement(
      owner,
      "photo-replacement-expiry-abandoned",
      seeded.bookId,
      seeded.pageId,
      { contentType: "image/jpeg", byteSize: 1024, sha256: "a".repeat(64) }
    );
    expect(abandoned.status).toBe(201);

    // Advance the clock past the 15-minute upload-intent expiry window.
    // The abandoned replacement's upload is now dead and must not count
    // against the 3-replacement cap.
    clockNow = new Date(now.getTime() + 16 * 60 * 1000);

    // Three more replacements on the same page should all succeed: the
    // abandoned+expired one is excluded, so the cap only sees these three.
    for (let i = 0; i < 3; i += 1) {
      const result = await clockedApi.createPhotoReplacement(
        owner,
        `photo-replacement-expiry-live-${i}`,
        seeded.bookId,
        seeded.pageId,
        { contentType: "image/jpeg", byteSize: 1024, sha256: `${i}`.repeat(64) }
      );
      expect(result.status).toBe(201);
    }

    // A 4th live replacement (on top of the 3 that count) must now be
    // rejected: the cap is reached by the three live ones, not the
    // abandoned+expired one.
    await expect(
      clockedApi.createPhotoReplacement(
        owner,
        "photo-replacement-expiry-live-4th",
        seeded.bookId,
        seeded.pageId,
        { contentType: "image/jpeg", byteSize: 1024, sha256: "b".repeat(64) }
      )
    ).rejects.toMatchObject({
      status: 403,
      code: "photo_replacement_limit_reached",
    });

    // Confirm all 4 rows exist (1 abandoned + 3 live), proving the cap
    // excluded the abandoned one rather than never having created it.
    expect(
      await scalar(
        "SELECT count(*) FROM book_run_regenerations WHERE kind = 'photo_replacement'"
      )
    ).toBe(4);
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

    const primaryView = await api.getBookRun(
      owner,
      seeded.bookId,
      seeded.runId
    );
    expect(primaryView.body.regenerationKind).toBeNull();
    expect(
      (
        primaryView.body.pages as Array<{ replacesPageId: string | null }>
      ).every(page => page.replacesPageId === null)
    ).toBe(true);
  });

  it("flags uploadExpired on getBookRun once a required upload intent expires without completing", async () => {
    let clockNow = now;
    const clockedApi = new PipelineApi(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeSigner(),
      launcher,
      () => clockNow
    );
    const book = await clockedApi.createBook(owner, "upload-expired-book-001");
    const bookId = String(book.body.bookId);
    const created = await clockedApi.createBookRun(
      owner,
      "upload-expired-run-001",
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
    const runId = String(created.body.runId);

    const beforeExpiry = await clockedApi.getBookRun(owner, bookId, runId);
    expect(beforeExpiry.body.uploadExpired).toBe(false);

    // Never uploaded; advance the clock past the 15-minute upload window.
    clockNow = new Date(now.getTime() + 16 * 60 * 1000);
    const afterExpiry = await clockedApi.getBookRun(owner, bookId, runId);
    expect(afterExpiry.body.uploadExpired).toBe(true);
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

  it("surfaces an intake-rejected page and its reason through GET book run status", async () => {
    const seeded = await seedIntakeRejectedPage();

    const response = await api.getBookRun(owner, seeded.bookId, seeded.runId);

    expect(response.status).toBe(200);
    const page = (response.body.pages as Array<Record<string, unknown>>).find(
      p => p["pageId"] === seeded.pageId
    );
    expect(page).toMatchObject({
      state: "intake_rejected",
      terminalReason: "too_dark",
    });
    const photo = (response.body.photos as Array<Record<string, unknown>>).find(
      p => p["photoId"] === seeded.photoId
    );
    expect(photo).toMatchObject({ intakeStatus: "rejected" });
  });

  it("exposes approvalSource on getBookRun pages, distinguishing automatic from human", async () => {
    const auto = await seedAutoApprovedPage();
    const human = await seedReviewablePage();
    await api.reviewCandidate(
      owner,
      "approve-for-approval-source-001",
      human.bookId,
      human.pageId,
      { candidateId: human.candidateId, decision: "approved" }
    );

    const autoResponse = await api.getBookRun(owner, auto.bookId, auto.runId);
    const autoPage = (
      autoResponse.body.pages as Array<Record<string, unknown>>
    ).find(p => p["pageId"] === auto.pageId);
    expect(autoPage).toMatchObject({
      state: "approved",
      approvalSource: "automatic",
    });

    const humanResponse = await api.getBookRun(
      owner,
      human.bookId,
      human.runId
    );
    const humanPage = (
      humanResponse.body.pages as Array<Record<string, unknown>>
    ).find(p => p["pageId"] === human.pageId);
    expect(humanPage).toMatchObject({
      state: "approved",
      approvalSource: "human",
    });
  });

  it("reuses an approval across concurrent requests and preserves its original notes", async () => {
    const { bookId, pageId, candidateId } = await seedReviewablePage();
    const approve = (key: string, notes: string) =>
      api.reviewCandidate(owner, key, bookId, pageId, {
        candidateId,
        decision: "approved",
        notes,
      });
    const [first, second] = await Promise.all([
      approve("approve-concurrent-001", "First request"),
      approve("approve-concurrent-002", "Second request"),
    ]);
    expect(second).toEqual(first);
    const original = await env.PIPELINE_DB.prepare(
      "SELECT review_id, notes FROM reviews WHERE page_id = ?"
    )
      .bind(pageId)
      .first();
    expect(original).toMatchObject({ review_id: first.body.reviewId });
    expect(["First request", "Second request"]).toContain(original?.notes);
    expect(await approve("approve-concurrent-003", "Retry notes")).toEqual(
      first
    );
    expect(
      await env.PIPELINE_DB.prepare(
        "SELECT review_id, notes FROM reviews WHERE page_id = ?"
      )
        .bind(pageId)
        .first()
    ).toEqual(original);
    expect(await scalar("SELECT count(*) FROM reviews")).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM operations WHERE operation_kind = 'review'"
      )
    ).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM audit_events WHERE event_kind = 'candidate_reviewed'"
      )
    ).toBe(1);
  });

  it("recovers a previously stored approval before the page transition and rejects a conflicting candidate", async () => {
    const { bookId, runId, pageId, candidateId } = await seedReviewablePage();
    const alternative = "candidate-other";
    await env.PIPELINE_DB.batch([
      env.PIPELINE_DB.prepare(
        `INSERT INTO candidates
         SELECT ?, page_id, operation_id, NULL, 'initial', 2, NULL, clean_artifact_id, created_at
         FROM candidates WHERE candidate_id = ?`
      ).bind(alternative, candidateId),
      env.PIPELINE_DB.prepare(
        `INSERT INTO operations VALUES ('review:review-older-request', ?, ?, 'review', 'completed',
          0, 0, '{}', NULL, ?, ?, ?)`
      ).bind(
        runId,
        pageId,
        now.toISOString(),
        now.toISOString(),
        now.toISOString()
      ),
      env.PIPELINE_DB.prepare(
        `INSERT INTO reviews VALUES ('review-older-request', ?, ?, ?, 'approved', 'Original notes', ?)`
      ).bind(pageId, candidateId, owner.userId, now.toISOString()),
    ]);

    await expect(
      api.reviewCandidate(owner, "approve-conflicting-001", bookId, pageId, {
        candidateId: alternative,
        decision: "approved",
      })
    ).rejects.toMatchObject({ status: 409, code: "page_already_approved" });

    const recovered = await api.reviewCandidate(
      owner,
      "approve-recovery-001",
      bookId,
      pageId,
      {
        candidateId,
        decision: "approved",
        notes: "Retry notes",
      }
    );
    expect(recovered.body.reviewId).toBe("review-older-request");
    expect(
      await env.PIPELINE_DB.prepare(
        "SELECT state, approval_source, approved_candidate_id FROM pages WHERE page_id = ?"
      )
        .bind(pageId)
        .first()
    ).toEqual({
      state: "approved",
      approval_source: "human",
      approved_candidate_id: candidateId,
    });
    expect(
      await scalar(
        "SELECT count(*) FROM reviews WHERE notes = 'Original notes'"
      )
    ).toBe(1);
    expect(await scalar("SELECT count(*) FROM reviews")).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM operations WHERE operation_kind = 'review'"
      )
    ).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM audit_events WHERE operation_id = 'review:review-older-request'"
      )
    ).toBe(1);
  });

  it("lets a customer explicitly confirm an already auto-approved page as human-approved", async () => {
    const seeded = await seedAutoApprovedPage();

    await api.reviewCandidate(
      owner,
      "confirm-auto-approved-001",
      seeded.bookId,
      seeded.pageId,
      { candidateId: seeded.candidateId, decision: "approved" }
    );

    const response = await api.getBookRun(owner, seeded.bookId, seeded.runId);
    const page = (response.body.pages as Array<Record<string, unknown>>).find(
      p => p["pageId"] === seeded.pageId
    );
    expect(page).toMatchObject({
      state: "approved",
      approvalSource: "human",
      approvedCandidateId: seeded.candidateId,
    });
  });
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

const seedAutoApprovedPage = async () => {
  const timestamp = new Date("2026-11-10T12:00:00.000Z").toISOString();
  const bookId = "book-auto-approved";
  const runId = "run-auto-approved";
  const photoId = "photo-auto-approved";
  const pageId = "page-auto-approved";
  const candidateId = "candidate-auto-approved";
  const artifactId = "clean:candidate-auto-approved";
  const objectKey =
    "books/book-auto-approved/runs/run-auto-approved/pages/page-auto-approved/candidates/candidate-auto-approved/clean.png";
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
       VALUES ('generate-auto-approved', ?, ?, 'generate_initial', 'completed',
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
     VALUES (?, ?, 'generate-auto-approved', NULL, 'initial', 1, NULL, ?, ?)`
  )
    .bind(candidateId, pageId, artifactId, timestamp)
    .run();
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'print_qa' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  // Mirrors decideStyleQa's dual_qa_passed path: both QA kinds pass, the
  // page moves print_qa -> style_qa -> approved, and approval_source is set
  // to 'automatic' -- it never visits needs_human_review, unlike
  // seedReviewablePage.
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(
      `INSERT INTO qa_results
       (qa_result_id, candidate_id, qa_kind, status, overall_score, artifact_id, created_at)
       VALUES (?, ?, 'print', 'passed', 1.0, NULL, ?)`
    ).bind(`qa:print:${candidateId}`, candidateId, timestamp),
    env.PIPELINE_DB.prepare(
      `INSERT INTO qa_results
       (qa_result_id, candidate_id, qa_kind, status, overall_score, artifact_id, created_at)
       VALUES (?, ?, 'style', 'passed', 1.0, NULL, ?)`
    ).bind(`qa:style:${candidateId}`, candidateId, timestamp),
  ]);
  await env.PIPELINE_DB.prepare(
    "UPDATE pages SET state = 'style_qa' WHERE page_id = ?"
  )
    .bind(pageId)
    .run();
  await env.PIPELINE_DB.prepare(
    `UPDATE pages SET state = 'approved', approval_source = 'automatic',
       approved_candidate_id = ? WHERE page_id = ?`
  )
    .bind(candidateId, pageId)
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
     VALUES (?, ?, ?, 'generate-auto-approved', ?, 'candidate_clean',
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
  return { bookId, runId, pageId, candidateId };
};

const seedIntakeRejectedPage = async () => {
  const timestamp = new Date("2026-11-10T12:00:00.000Z").toISOString();
  const bookId = "book-intake-rejected";
  const runId = "run-intake-rejected";
  const photoId = "photo-intake-rejected";
  const pageId = "page-intake-rejected";
  await env.PIPELINE_DB.batch([
    env.PIPELINE_DB.prepare(
      `INSERT INTO books (book_id, owner_id, status, created_at, updated_at)
       VALUES (?, ?, 'review', ?, ?)`
    ).bind(bookId, "user-owner", timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO book_runs VALUES (?, ?, 'partially_completed', 'pictobook-preschool-v0.1', 7000, 0, ?, ?, ?)"
    ).bind(runId, bookId, timestamp, timestamp, timestamp),
    env.PIPELINE_DB.prepare(
      "INSERT INTO photos VALUES (?, ?, 1, ?, 'rejected', ?)"
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
  return { bookId, runId, photoId, pageId };
};

// Keep sha256Hex in scope for helpers that compute hashes
void sha256Hex;

const digest = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), value =>
    value.toString(16).padStart(2, "0")
  ).join("");
};

const MINI_PNGS = [
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAC0lEQVQImWNgwAIAABUAAbJuDnMAAAAASUVORK5CYII=",
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAFCAIAAADtz9qMAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgoBAAAABBAAFDlc3UAAAAAElFTkSuQmCC",
  "iVBORw0KGgoAAAANSUhEUgAAAAYAAAAHCAIAAACk8qu6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgGAQAAACFAAFDsYaHAAAAAElFTkSuQmCC",
].map(png => Uint8Array.from(atob(png), char => char.charCodeAt(0)));

async function seedPrintablePage({
  runId,
  pageId,
  ordinal,
}: {
  runId: string;
  pageId: string;
  ordinal: number;
}) {
  const photoId = `photo-${pageId}`;
  const candidateId = `candidate-${pageId}-0-1`;
  const artifactId = `clean:${candidateId}`;
  const operationId = `generate:${pageId}`;
  const time = now.toISOString();
  const db = env.PIPELINE_DB;
  await db.batch([
    db
      .prepare("INSERT INTO photos VALUES (?, ?, ?, ?, 'accepted', ?)")
      .bind(photoId, runId, ordinal, `source:${photoId}`, time),
    db
      .prepare(
        `INSERT INTO pages (page_id, run_id, photo_id, state, initial_candidate_count,
          repair_round_count, approved_candidate_id, approval_source, terminal_reason, created_at, updated_at)
         VALUES (?, ?, ?, 'created', 0, 0, NULL, NULL, NULL, ?, ?)`
      )
      .bind(pageId, runId, photoId, time, time),
    db
      .prepare(
        "INSERT INTO operations VALUES (?, ?, ?, 'generate_initial', 'completed', 0, 1, '{}', NULL, ?, ?, ?)"
      )
      .bind(operationId, runId, pageId, time, time, time),
    db
      .prepare(
        "INSERT INTO candidates VALUES (?, ?, ?, NULL, 'initial', 1, NULL, ?, ?)"
      )
      .bind(candidateId, pageId, operationId, artifactId, time),
    db
      .prepare(
        "INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, 'candidate_clean', 'test', ?, 0, 'image/png', 'mock', 'mock-v1', 'derived', NULL, ?)"
      )
      .bind(
        artifactId,
        runId,
        pageId,
        operationId,
        `test/print/${artifactId}`,
        "0".repeat(64),
        time
      ),
    ...["analyzing", "generating", "print_qa", "needs_human_review"].map(
      state =>
        db
          .prepare("UPDATE pages SET state = ? WHERE page_id = ?")
          .bind(state, pageId)
    ),
  ]);
  return candidateId;
}

async function setPrintableCandidate(
  pageId: string,
  bytes: Uint8Array,
  mimeType = "image/png"
) {
  const artifact = await env.PIPELINE_DB.prepare(
    "SELECT a.artifact_id, a.object_key FROM artifacts a JOIN candidates c ON c.clean_artifact_id = a.artifact_id WHERE c.page_id = ?"
  )
    .bind(pageId)
    .first<{ artifact_id: string; object_key: string }>();
  const sha = await digest(bytes);
  await env.PIPELINE_ARTIFACTS.put(artifact!.object_key, bytes, {
    httpMetadata: { contentType: mimeType },
  });
  await env.PIPELINE_DB.prepare(
    "UPDATE artifacts SET sha256 = ?, byte_size = ?, mime_type = ? WHERE artifact_id = ?"
  )
    .bind(sha, bytes.length, mimeType, artifact!.artifact_id)
    .run();
}

const scalar = async (query: string): Promise<number> => {
  const row =
    await env.PIPELINE_DB.prepare(query).first<Record<string, number>>();
  if (!row) throw new Error(`No result for ${query}`);
  return Object.values(row)[0] ?? 0;
};
