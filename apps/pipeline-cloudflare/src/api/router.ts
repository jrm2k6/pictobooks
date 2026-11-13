import { AuthenticationError, SessionAuthenticator } from "./auth.js";
import {
  ApiProblem,
  PipelineApi,
  type ApiResponse,
  type BookRunLauncher,
} from "./pipelineApi.js";
import { R2Presigner } from "./r2Presigner.js";
import { DEFAULT_INITIAL_CANDIDATE_COUNT } from "../domain/generationPolicy.js";
import { listLocalEditions } from "./editionCatalog.js";

const MAX_JSON_BYTES = 64 * 1024;

export const handleApiRequest = async (
  request: Request,
  env: RuntimeEnv
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/v1/")) return null;
  try {
    const principal = await new SessionAuthenticator(
      env.PIPELINE_DB
    ).authenticate(request);
    const localCustomerApi = env.LOCAL_CUSTOMER_API === "true";
    const api = new PipelineApi(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      localCustomerApi
        ? new R2Presigner("local", "local", "http://127.0.0.1", "local")
        : new R2Presigner(
        requiredEnv(env, "R2_ACCESS_KEY_ID"),
        requiredEnv(env, "R2_SECRET_ACCESS_KEY"),
        requiredEnv(env, "R2_ENDPOINT"),
        requiredEnv(env, "R2_BUCKET")
      ),
      workflowLauncher(env),
      undefined,
      {
        provider: env.IMAGE_PROVIDER === "gemini" ? "gemini" : "mock",
        model: env.IMAGE_PROVIDER === "gemini"
          ? (env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1")
          : "mock-coloring-page-v1",
        styleJudgeModel: env.IMAGE_PROVIDER === "gemini"
          ? (env.GEMINI_VISION_MODEL || "gemini-3.8-flash")
          : "mock-style-v1",
        candidateCostMicros: parsePositiveInteger(env.GEMINI_CANDIDATE_COST_MICROS) ?? 0,
        styleJudgeCostMicros: parsePositiveInteger(env.GEMINI_STYLE_JUDGE_COST_MICROS) ?? 0,
        initialCandidateCount: parsePositiveInteger(env.PIPELINE_INITIAL_CANDIDATE_COUNT) ?? DEFAULT_INITIAL_CANDIDATE_COUNT,
        apiKeyConfigured: Boolean(env.GEMINI_API_KEY),
      },
      localCustomerApi
    );
    const response = await route(request, url, principal, api);
    if (response instanceof Response) return response;
    return Response.json(response.body, { status: response.status });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return problem(401, "authentication_required");
    }
    if (error instanceof ApiProblem) {
      return problem(error.status, error.code);
    }
    console.error(
      JSON.stringify({
        message: "customer API request failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      })
    );
    return problem(500, "internal_error");
  }
};

const route = async (
  request: Request,
  url: URL,
  principal: { userId: string; sessionId: string },
  api: PipelineApi
): Promise<ApiResponse | Response> => {
  if (request.method === "GET" && url.pathname === "/v1/pipeline-config") {
    return api.getPipelineConfig();
  }

  if (request.method === "GET" && url.pathname === "/v1/catalog/editions") {
    return { status: 200, body: { ...listLocalEditions() } };
  }

  const uploadContent = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/runs\/([^/]+)\/upload-intents\/([^/]+)\/content$/
  );
  if (request.method === "PUT" && uploadContent) {
    return api.acceptLocalUpload(
      principal,
      safePathId(uploadContent[1]),
      safePathId(uploadContent[2]),
      safePathId(uploadContent[3]),
      request
    ).then(response => Response.json(response.body, { status: response.status }));
  }

  const artifactContent = url.pathname.match(
    /^\/v1\/artifacts\/([^/]+)\/content$/
  );
  if (request.method === "GET" && artifactContent) {
    return api.readLocalArtifact(principal, decodePathValue(artifactContent[1]));
  }

  const uploadRefresh = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/runs\/([^/]+)\/upload-intents\/([^/]+)\/refresh$/
  );
  if (request.method === "POST" && uploadRefresh) {
    await readJson(request);
    return api.refreshUploadIntent(
      principal,
      idempotencyKey(request),
      safePathId(uploadRefresh[1]),
      safePathId(uploadRefresh[2]),
      safePathId(uploadRefresh[3]),
      url.origin
    );
  }

  const photoOrder = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/runs\/([^/]+)\/photo-order$/
  );
  if (request.method === "PATCH" && photoOrder) {
    const body = await readJson<{ photoIds?: string[] }>(request);
    if (!Array.isArray(body.photoIds) || body.photoIds.some(id => typeof id !== "string")) {
      throw new ApiProblem(400, "invalid_photo_order");
    }
    return api.updatePhotoOrder(
      principal,
      idempotencyKey(request),
      safePathId(photoOrder[1]),
      safePathId(photoOrder[2]),
      body.photoIds
    );
  }

  if (request.method === "GET" && url.pathname === "/v1/books") {
    return api.listBooks(principal);
  }

  const bookRuns = url.pathname.match(/^\/v1\/books\/([^/]+)\/runs$/);
  if (request.method === "GET" && bookRuns) {
    return api.listBookRuns(principal, safePathId(bookRuns[1]));
  }

  if (request.method === "GET" && url.pathname === "/v1/canonical-references") {
    return api.listCanonicalReferences(principal, url.searchParams.get("stylePackVersion") ?? undefined);
  }

  if (request.method === "POST" && url.pathname === "/v1/books") {
    await readJson(request);
    return api.createBook(principal, idempotencyKey(request));
  }

  const runs = url.pathname.match(/^\/v1\/books\/([^/]+)\/runs$/);
  if (request.method === "POST" && runs) {
    const body = await readJson<{
      photos?: Array<{
        contentType: "image/jpeg" | "image/png" | "image/webp";
        byteSize: number;
        sha256: string;
      }>;
      stylePackVersion?: string;
      costCeilingMicros?: number;
    }>(request);
    return api.createBookRun(
      principal,
      idempotencyKey(request),
      safePathId(runs[1]),
      {
        photos: body.photos ?? [],
        stylePackVersion: body.stylePackVersion,
        costCeilingMicros: body.costCeilingMicros,
      }
    );
  }

  const run = url.pathname.match(/^\/v1\/books\/([^/]+)\/runs\/([^/]+)$/);
  if (request.method === "GET" && run) {
    return api.getBookRun(principal, safePathId(run[1]), safePathId(run[2]));
  }

  const start = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/runs\/([^/]+)\/start$/
  );
  if (request.method === "POST" && start) {
    await readJson(request);
    return api.startBookRun(
      principal,
      idempotencyKey(request),
      safePathId(start[1]),
      safePathId(start[2])
    );
  }

  const reviews = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/pages\/([^/]+)\/reviews$/
  );
  if (request.method === "POST" && reviews) {
    const body = await readJson<{
      candidateId?: string;
      decision?: "approved" | "rejected" | "changes_requested";
      notes?: string;
    }>(request);
    if (!body.candidateId || !body.decision) {
      throw new ApiProblem(400, "invalid_review");
    }
    return api.reviewCandidate(
      principal,
      idempotencyKey(request),
      safePathId(reviews[1]),
      safePathId(reviews[2]),
      {
        candidateId: safePathId(body.candidateId),
        decision: body.decision,
        notes: body.notes,
      }
    );
  }

  const regenerations = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/pages\/([^/]+)\/regenerations$/
  );
  if (request.method === "POST" && regenerations) {
    const body = await readJson<{ costCeilingMicros?: number }>(request);
    return api.regeneratePage(
      principal,
      idempotencyKey(request),
      safePathId(regenerations[1]),
      safePathId(regenerations[2]),
      body.costCeilingMicros
    );
  }

  const canonical = url.pathname.match(
    /^\/v1\/books\/([^/]+)\/candidates\/([^/]+)\/canonical-promotions$/
  );
  if (request.method === "POST" && canonical) {
    const body = await readJson<{
      reviewId?: string;
      stylePackVersion?: string;
    }>(request);
    if (!body.reviewId || !body.stylePackVersion) {
      throw new ApiProblem(400, "invalid_canonical_promotion");
    }
    return api.promoteCanonical(
      principal,
      idempotencyKey(request),
      safePathId(canonical[1]),
      safePathId(canonical[2]),
      {
        reviewId: safePathId(body.reviewId),
        stylePackVersion: safePathId(body.stylePackVersion),
      }
    );
  }

  const artifact = url.pathname.match(/^\/v1\/artifacts\/([^/]+)\/access$/);
  if (request.method === "GET" && artifact) {
    return api.getArtifactAccess(principal, decodePathValue(artifact[1]));
  }

  throw new ApiProblem(404, "route_not_found");
};

const workflowLauncher = (env: Env): BookRunLauncher => ({
  async start(runId) {
    try {
      await env.PRODUCTION_BOOK_RUN_WORKFLOW.create({
        id: runId,
        params: { runId },
      });
    } catch (error) {
      const status = await (
        await env.PRODUCTION_BOOK_RUN_WORKFLOW.get(runId)
      ).status();
      if (status.status === "unknown") throw error;
    }
  },
});

const readJson = async <
  T extends Record<string, unknown> = Record<string, unknown>,
>(
  request: Request
): Promise<T> => {
  if (!request.body) return {} as T;
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new ApiProblem(413, "request_too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  if (text.trim() === "") return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiProblem(400, "invalid_json");
  }
};

const idempotencyKey = (request: Request): string => {
  const key = request.headers.get("idempotency-key");
  if (!key) throw new ApiProblem(400, "idempotency_key_required");
  return key;
};

const safePathId = (value: string | undefined): string => {
  const decoded = decodePathValue(value);
  if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(decoded) || decoded.includes("..")) {
    throw new ApiProblem(400, "invalid_identifier");
  }
  return decoded;
};

const decodePathValue = (value: string | undefined): string => {
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    throw new ApiProblem(400, "invalid_identifier");
  }
};

const requiredEnv = (
  env: RuntimeEnv,
  name:
    | "R2_ACCESS_KEY_ID"
    | "R2_SECRET_ACCESS_KEY"
    | "R2_ENDPOINT"
    | "R2_BUCKET"
): string => {
  const value = env[name];
  if (typeof value !== "string" || !value) {
    throw new Error(`${String(name)} is required`);
  }
  return value;
};

const problem = (status: number, code: string): Response =>
  Response.json({ error: code }, { status });

type RuntimeSecrets = {
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  GEMINI_API_KEY?: string;
  IMAGE_PROVIDER?: string;
  GEMINI_IMAGE_MODEL?: string;
  GEMINI_CANDIDATE_COST_MICROS?: string;
  GEMINI_VISION_MODEL?: string;
  GEMINI_STYLE_JUDGE_COST_MICROS?: string;
  PIPELINE_INITIAL_CANDIDATE_COUNT?: string;
  LOCAL_CUSTOMER_API?: string;
};

export type RuntimeEnv = Env & RuntimeSecrets;

const parsePositiveInteger = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
};
