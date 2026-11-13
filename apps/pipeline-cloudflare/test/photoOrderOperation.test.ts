import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { updatePhotoOrder } from "../src/api/photoOrderOperation.js";

const timestamp = "2026-11-11T12:00:00.000Z";

describe("updatePhotoOrder", () => {
  beforeEach(async () => {
    await reset();
    await applyD1Migrations(
      env.PIPELINE_DB,
      Reflect.get(env, "TEST_MIGRATIONS") as D1Migration[]
    );
    await seedRun("owner", "book-1", "run-1", "created");
  });

  it("stores the exact requested ordering", async () => {
    const result = await updatePhotoOrder(
      env.PIPELINE_DB,
      "owner",
      "book-1",
      "run-1",
      ["photo-5", "photo-3", "photo-1", "photo-4", "photo-2"],
      timestamp
    );

    expect(result).toEqual({
      runId: "run-1",
      photoIds: ["photo-5", "photo-3", "photo-1", "photo-4", "photo-2"],
    });
    const rows = await env.PIPELINE_DB.prepare(
      "SELECT photo_id FROM photos WHERE run_id = ? ORDER BY ordinal"
    )
      .bind("run-1")
      .all<{ photo_id: string }>();
    expect(rows.results.map(row => row.photo_id)).toEqual([
      "photo-5",
      "photo-3",
      "photo-1",
      "photo-4",
      "photo-2",
    ]);
  });

  it("rejects a non-permutation so omitted, foreign, and repeated photos cannot be saved", async () => {
    await expect(
      updatePhotoOrder(
        env.PIPELINE_DB,
        "owner",
        "book-1",
        "run-1",
        ["photo-1", "photo-1", "photo-2", "photo-4", "photo-5"],
        timestamp
      )
    ).rejects.toMatchObject({ status: 400, code: "invalid_photo_order" });
  });

  it("does not reveal another owner's run", async () => {
    await expect(
      updatePhotoOrder(
        env.PIPELINE_DB,
        "stranger",
        "book-1",
        "run-1",
        ["photo-1", "photo-2", "photo-3", "photo-4", "photo-5"],
        timestamp
      )
    ).rejects.toMatchObject({ status: 404, code: "run_not_found" });
  });

  it("locks the photo order after processing starts", async () => {
    await env.PIPELINE_DB.prepare(
      "UPDATE book_runs SET status = 'running' WHERE run_id = ?"
    )
      .bind("run-1")
      .run();

    await expect(
      updatePhotoOrder(
        env.PIPELINE_DB,
        "owner",
        "book-1",
        "run-1",
        ["photo-1", "photo-2", "photo-3", "photo-4", "photo-5"],
        timestamp
      )
    ).rejects.toMatchObject({ status: 409, code: "photo_order_locked" });
  });
});

const seedRun = async (
  ownerId: string,
  bookId: string,
  runId: string,
  status: string
): Promise<void> => {
  await env.PIPELINE_DB.prepare(
    "INSERT INTO books (book_id, owner_id, status, created_at, updated_at) VALUES (?, ?, 'draft', ?, ?)"
  )
    .bind(bookId, ownerId, timestamp, timestamp)
    .run();
  await env.PIPELINE_DB.prepare(
    `INSERT INTO book_runs
       (run_id, book_id, status, style_pack_version, cost_ceiling_micros,
        cost_spent_micros, created_at, updated_at)
       VALUES (?, ?, ?, 'test-style', 1000, 0, ?, ?)`
  )
    .bind(runId, bookId, status, timestamp, timestamp)
    .run();
  for (let ordinal = 1; ordinal <= 5; ordinal += 1) {
    await env.PIPELINE_DB.prepare(
      `INSERT INTO photos
         (photo_id, run_id, ordinal, source_artifact_id, intake_status, created_at)
         VALUES (?, ?, ?, NULL, 'pending', ?)`
    )
      .bind(`photo-${ordinal}`, runId, ordinal, timestamp)
      .run();
  }
};
