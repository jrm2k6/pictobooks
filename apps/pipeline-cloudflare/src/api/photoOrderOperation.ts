import { ApiProblem } from "./pipelineApi.js";

/**
 * Persists the customer's chosen source-photo order before generation starts.
 * The caller is responsible for wrapping this operation in the API's
 * idempotency helper and translating ApiProblem into the shared HTTP format.
 */
export const updatePhotoOrder = async (
  database: D1Database,
  ownerId: string,
  bookId: string,
  runId: string,
  orderedPhotoIds: string[],
  now: string
): Promise<{ runId: string; photoIds: string[] }> => {
  const run = await database
    .prepare(
      `SELECT r.status FROM book_runs r
       JOIN books b ON b.book_id = r.book_id
       WHERE r.run_id = ? AND r.book_id = ? AND b.owner_id = ?`
    )
    .bind(runId, bookId, ownerId)
    .first<{ status: string }>();
  if (!run) throw new ApiProblem(404, "run_not_found");
  if (run.status !== "created") {
    throw new ApiProblem(409, "photo_order_locked");
  }

  const result = await database
    .prepare("SELECT photo_id FROM photos WHERE run_id = ? ORDER BY ordinal")
    .bind(runId)
    .all<{ photo_id: string }>();
  const existing = result.results.map(row => row.photo_id);
  const requested = new Set(orderedPhotoIds);
  if (
    orderedPhotoIds.length < 5 ||
    orderedPhotoIds.length > 10 ||
    orderedPhotoIds.length !== existing.length ||
    requested.size !== orderedPhotoIds.length ||
    existing.some(photoId => !requested.has(photoId))
  ) {
    throw new ApiProblem(400, "invalid_photo_order");
  }

  // Move ordinals above the current range first to avoid collisions on the
  // UNIQUE(run_id, ordinal) constraint while retaining positive ordinals.
  const offset = existing.length;
  const statements: D1PreparedStatement[] = existing.map(photoId =>
    database
      .prepare(
        "UPDATE photos SET ordinal = ordinal + ? WHERE run_id = ? AND photo_id = ?"
      )
      .bind(offset, runId, photoId)
  );
  orderedPhotoIds.forEach((photoId, index) => {
    statements.push(
      database
        .prepare(
          "UPDATE photos SET ordinal = ? WHERE run_id = ? AND photo_id = ?"
        )
        .bind(index + 1, runId, photoId)
    );
  });
  // Touch the parent book timestamp as part of the same batch for list sorting.
  statements.push(
    database
      .prepare(
        "UPDATE books SET updated_at = ? WHERE book_id = ? AND owner_id = ?"
      )
      .bind(now, bookId, ownerId)
  );
  await database.batch(statements);

  return { runId, photoIds: orderedPhotoIds };
};
