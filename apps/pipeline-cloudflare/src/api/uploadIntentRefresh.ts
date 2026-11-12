/** Local-only upload-intent refresh operation.
 *
 * The returned upload URL is a Worker endpoint protected by the caller's
 * session. It is deliberately not an R2/S3 presigned URL.
 */

export type PendingUploadIntent = {
  uploadIntentId: string;
  photoId: string;
  artifactId: string;
  bookId: string;
  runId: string;
  contentType: string;
  expiresAt: string;
};

export interface UploadIntentRefreshStore {
  findPendingOwnedIntent(input: {
    ownerId: string;
    bookId: string;
    runId: string;
    uploadIntentId: string;
  }): Promise<PendingUploadIntent | null>;
  updateExpiry(uploadIntentId: string, expiresAt: string): Promise<boolean>;
}

export class UploadIntentRefreshError extends Error {
  readonly status = 404;
  readonly code = "upload_intent_not_found";

  constructor() {
    super("upload_intent_not_found");
    this.name = "UploadIntentRefreshError";
  }
}

export async function refreshLocalUploadIntent(
  store: UploadIntentRefreshStore,
  input: {
    ownerId: string;
    bookId: string;
    runId: string;
    uploadIntentId: string;
    /** Origin from the authenticated request, e.g. http://127.0.0.1:8787. */
    origin: string;
    now?: Date;
  }
) {
  const intent = await store.findPendingOwnedIntent(input);
  if (!intent) throw new UploadIntentRefreshError();

  const expiresAt = new Date(
    (input.now ?? new Date()).getTime() + 15 * 60 * 1000
  ).toISOString();
  // Conditional update protects against an upload completing between lookup
  // and refresh. The store returns false if it is no longer pending.
  if (!(await store.updateExpiry(intent.uploadIntentId, expiresAt))) {
    throw new UploadIntentRefreshError();
  }

  const base = input.origin.replace(/\/$/, "");
  return {
    uploadIntentId: intent.uploadIntentId,
    photoId: intent.photoId,
    artifactId: intent.artifactId,
    uploadUrl: `${base}/v1/books/${encodeURIComponent(input.bookId)}/runs/${encodeURIComponent(input.runId)}/upload-intents/${encodeURIComponent(intent.uploadIntentId)}/content`,
    expiresAt,
    requiredHeaders: { "Content-Type": intent.contentType },
  };
}

/** D1 store adapter. The query scope deliberately includes every path id and
 * the owner, and only permits runs that have not started generation.
 */
export function d1UploadIntentRefreshStore(
  database: D1Database
): UploadIntentRefreshStore {
  return {
    async findPendingOwnedIntent(input) {
      return database
        .prepare(
          `SELECT ui.upload_intent_id AS uploadIntentId,
                  ui.photo_id AS photoId, ui.artifact_id AS artifactId,
                  ui.book_id AS bookId, ui.run_id AS runId,
                  ui.content_type AS contentType, ui.expires_at AS expiresAt
           FROM upload_intents ui
           JOIN books b ON b.book_id = ui.book_id
           JOIN book_runs r ON r.run_id = ui.run_id AND r.book_id = ui.book_id
           WHERE ui.owner_id = ? AND b.owner_id = ?
             AND ui.book_id = ? AND ui.run_id = ?
             AND ui.upload_intent_id = ? AND ui.completed_at IS NULL
             AND r.status = 'created'`
        )
        .bind(
          input.ownerId,
          input.ownerId,
          input.bookId,
          input.runId,
          input.uploadIntentId
        )
        .first<PendingUploadIntent>();
    },
    async updateExpiry(uploadIntentId, expiresAt) {
      const result = await database
        .prepare(
          `UPDATE upload_intents SET expires_at = ?
           WHERE upload_intent_id = ? AND completed_at IS NULL
             AND EXISTS (
               SELECT 1 FROM book_runs r
               WHERE r.run_id = upload_intents.run_id AND r.status = 'created'
             )`
        )
        .bind(expiresAt, uploadIntentId)
        .run();
      return (result.meta.changes ?? 0) === 1;
    },
  };
}
