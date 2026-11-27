/**
 * API client for the Pictobook Customer API.
 * Uses Clerk Bearer token from useAuth().
 *
 * Base URL: VITE_API_BASE_URL (defaults to local Worker dev server)
 */
import { useAuth } from "@clerk/react";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";
const UPLOAD_CONTENT_PATH =
  /^\/v1\/books\/[^/]+\/runs\/[^/]+\/upload-intents\/[^/]+\/content$/;

/** Thrown on 401 responses; hooks should catch and redirect to /sign-in. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Session expired — please sign in again.");
    this.name = "UnauthorizedError";
    this.status = 401;
  }
}

/** Thrown on other non-2xx responses with the API's problem detail. */
export class ApiError extends Error {
  constructor(status, title, detail, code) {
    super(title ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

export function useApiClient() {
  const { getToken } = useAuth();

  /**
   * Core fetch wrapper.
   * @param {string} method  HTTP method
   * @param {string} path    Path under BASE_URL, e.g. '/v1/books'
   * @param {object} [opts]
   * @param {unknown} [opts.body]           JSON body
   * @param {boolean} [opts.withIdempotency] Generate a fresh Idempotency-Key header
   * @param {object} [opts.extraHeaders]    Additional headers
   * @param {boolean} [opts.pdf]           Read a PDF attachment as a Blob
   */
  async function request(
    method,
    path,
    { body, withIdempotency = false, extraHeaders = {}, pdf = false } = {}
  ) {
    const token = await getToken();
    const headers = {
      Authorization: `Bearer ${token}`,
      ...extraHeaders,
    };

    if (body != null) {
      headers["Content-Type"] = "application/json";
    }

    // TODO: For retries of the same user intent, generate the key once and
    // thread it through rather than generating a fresh key per call.
    if (withIdempotency) {
      headers["Idempotency-Key"] = crypto.randomUUID();
    }

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      cache: pdf ? "no-store" : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) throw new UnauthorizedError();

    if (!res.ok) {
      let problem = {};
      try {
        problem = await res.json();
      } catch {
        // non-JSON error body
      }
      throw new ApiError(
        res.status,
        problem.title,
        problem.detail,
        problem.code
      );
    }

    if (res.status === 204 || res.headers.get("content-length") === "0")
      return null;
    if (pdf) {
      if (res.headers.get("content-type") !== "application/pdf") {
        throw new Error("The download was not a PDF.");
      }
      return res.blob();
    }
    return res.json();
  }

  return {
    /** GET /v1/books → { books: BookSummary[] } */
    listBooks: () => request("GET", "/v1/books"),

    /** POST /v1/books → BookCreated */
    createBook: data =>
      request("POST", "/v1/books", { body: data, withIdempotency: true }),

    /** GET /v1/books/:bookId → Book */
    getBook: bookId => request("GET", `/v1/books/${bookId}`),

    /** PATCH /v1/books/:bookId → Book */
    updateBook: (bookId, data) =>
      request("PATCH", `/v1/books/${bookId}`, {
        body: data,
        withIdempotency: true,
      }),

    /** POST /v1/books/:bookId/runs → RunCreated */
    createBookRun: (bookId, data) =>
      request("POST", `/v1/books/${bookId}/runs`, {
        body: data,
        withIdempotency: true,
      }),

    /** PATCH /v1/books/:bookId/runs/:runId/photo-order → { runId, photoIds } */
    updatePhotoOrder: (bookId, runId, photoIds) =>
      request("PATCH", `/v1/books/${bookId}/runs/${runId}/photo-order`, {
        body: { photoIds },
        withIdempotency: true,
      }),

    /** POST /v1/books/:bookId/runs/:runId/start → { bookId, runId, status } */
    startBookRun: (bookId, runId) =>
      request("POST", `/v1/books/${bookId}/runs/${runId}/start`, {
        withIdempotency: true,
      }),

    /** PATCH /v1/books/:bookId/runs/:runId/pages/:pageId/inclusion */
    setPageInclusion: (bookId, runId, pageId, included) =>
      request(
        "PATCH",
        `/v1/books/${bookId}/runs/${runId}/pages/${pageId}/inclusion`,
        {
          body: { included },
          withIdempotency: true,
        }
      ),

    /** GET /v1/books/:bookId/runs/:runId → BookRunDetail */
    getBookRun: (bookId, runId) =>
      request("GET", `/v1/books/${bookId}/runs/${runId}`),

    downloadPrintablePdf: (bookId, runId) =>
      request(
        "GET",
        `/v1/books/${encodeURIComponent(bookId)}/runs/${encodeURIComponent(runId)}/printable-pdf`,
        { pdf: true }
      ),

    /**
     * Direct photo upload to R2 (local mode: through Worker; other envs: presigned URL).
     * @param {string} uploadUrl
     * @param {Record<string,string>} requiredHeaders
     * @param {File} file
     */
    uploadPhoto: async (uploadUrl, requiredHeaders, file) => {
      const target = new URL(uploadUrl, BASE_URL);
      const isWorkerUpload =
        target.origin === new URL(BASE_URL).origin &&
        UPLOAD_CONTENT_PATH.test(target.pathname);
      const headers = { "Content-Type": file.type, ...requiredHeaders };
      if (isWorkerUpload) {
        const token = await getToken();
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(isWorkerUpload ? target.href : uploadUrl, {
        method: "PUT",
        headers,
        body: file,
      });
      if (isWorkerUpload && res.status === 401) throw new UnauthorizedError();
      if (!res.ok)
        throw new ApiError(res.status, `Upload failed: HTTP ${res.status}`);
      return res;
    },

    /** GET /v1/books/:bookId/runs → { runs: BookRunSummary[] } — note: the
     * Worker returns raw snake_case columns here (the one endpoint that
     * does), so this method maps them to camelCase before returning. */
    listBookRuns: async (bookId, { liveLineageOnly = false } = {}) => {
      const query = liveLineageOnly ? "?lineage=live" : "";
      const result = await request("GET", `/v1/books/${bookId}/runs${query}`);
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
      request(
        "POST",
        `/v1/books/${bookId}/pages/${pageId}/photo-replacements`,
        {
          body: data,
          withIdempotency: true,
        }
      ),

    /** GET /v1/artifacts/:id/access → { access: SignedArtifactRequest } — still
     * requires the Bearer token even once you have the URL back. */
    getArtifactAccess: artifactId =>
      request("GET", `/v1/artifacts/${artifactId}/access`),

    /**
     * Fetches the bytes behind a getArtifactAccess() result. Local mode
     * returns a relative, same-origin URL that still requires the Bearer
     * token (resolved against BASE_URL here); other environments return an
     * already-signed, already-authorized external URL that must NOT get an
     * Authorization header attached.
     */
    fetchArtifactBlob: async access => {
      const isRelative = access.url.startsWith("/");
      const url = isRelative ? `${BASE_URL}${access.url}` : access.url;
      const headers = { ...access.headers };
      if (isRelative) {
        const token = await getToken();
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(url, { method: access.method, headers });
      if (res.status === 401) throw new UnauthorizedError();
      if (!res.ok) {
        throw new ApiError(
          res.status,
          `Failed to fetch artifact: HTTP ${res.status}`
        );
      }
      return res.blob();
    },
  };
}
