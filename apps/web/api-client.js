/**
 * API client for the Pictobook Customer API.
 * Uses Clerk Bearer token from useAuth().
 *
 * Base URL: VITE_API_BASE_URL (defaults to local Worker dev server)
 */
import { useAuth } from "@clerk/react";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://127.0.0.1:8787";

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
   */
  async function request(
    method,
    path,
    { body, withIdempotency = false, extraHeaders = {} } = {}
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

    /** GET /v1/books/:bookId/runs/:runId → BookRunDetail */
    getBookRun: (bookId, runId) =>
      request("GET", `/v1/books/${bookId}/runs/${runId}`),

    /**
     * Direct photo upload to R2 (local mode: through Worker; other envs: presigned URL).
     * @param {string} uploadUrl
     * @param {Record<string,string>} requiredHeaders
     * @param {File} file
     */
    uploadPhoto: (uploadUrl, requiredHeaders, file) =>
      fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type, ...requiredHeaders },
        body: file,
      }).then(res => {
        if (!res.ok)
          throw new ApiError(res.status, `Upload failed: HTTP ${res.status}`);
        return res;
      }),
  };
}
