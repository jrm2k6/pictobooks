import { describe, expect, it, vi } from "vitest";
import {
  refreshLocalUploadIntent,
  UploadIntentRefreshError,
  type PendingUploadIntent,
  type UploadIntentRefreshStore,
} from "../src/api/uploadIntentRefresh.js";

const pendingIntent: PendingUploadIntent = {
  uploadIntentId: "upload-123",
  photoId: "photo-123",
  artifactId: "source:photo-123",
  bookId: "book-123",
  runId: "run-123",
  contentType: "image/jpeg",
  expiresAt: "2026-11-10T12:15:00.000Z",
};

function storeWith(
  intent: PendingUploadIntent | null = pendingIntent,
  updateResult = true
): UploadIntentRefreshStore {
  return {
    findPendingOwnedIntent: vi.fn(async () => intent),
    updateExpiry: vi.fn(async () => updateResult),
  };
}

describe("local upload-intent refresh", () => {
  it("returns a short-lived authenticated Worker URL, never an R2 URL", async () => {
    const store = storeWith();
    const result = await refreshLocalUploadIntent(store, {
      ownerId: "user-1",
      bookId: pendingIntent.bookId,
      runId: pendingIntent.runId,
      uploadIntentId: pendingIntent.uploadIntentId,
      origin: "http://127.0.0.1:8787/",
      now: new Date("2026-11-11T12:00:00.000Z"),
    });

    expect(result).toEqual({
      uploadIntentId: "upload-123",
      photoId: "photo-123",
      artifactId: "source:photo-123",
      uploadUrl:
        "http://127.0.0.1:8787/v1/books/book-123/runs/run-123/upload-intents/upload-123/content",
      expiresAt: "2026-11-11T12:15:00.000Z",
      requiredHeaders: { "Content-Type": "image/jpeg" },
    });
    expect(result.uploadUrl).not.toContain("r2.cloudflarestorage.com");
    expect(store.updateExpiry).toHaveBeenCalledWith(
      "upload-123",
      "2026-11-11T12:15:00.000Z"
    );
  });

  it("does not disclose missing, cross-owner, completed, or started intents", async () => {
    const store = storeWith(null);
    await expect(
      refreshLocalUploadIntent(store, {
        ownerId: "user-other",
        bookId: pendingIntent.bookId,
        runId: pendingIntent.runId,
        uploadIntentId: pendingIntent.uploadIntentId,
        origin: "http://localhost:8787",
      })
    ).rejects.toBeInstanceOf(UploadIntentRefreshError);
    expect(store.updateExpiry).not.toHaveBeenCalled();
  });

  it("rejects a refresh if the intent stopped being pending before update", async () => {
    const store = storeWith(pendingIntent, false);
    await expect(
      refreshLocalUploadIntent(store, {
        ownerId: "user-1",
        bookId: pendingIntent.bookId,
        runId: pendingIntent.runId,
        uploadIntentId: pendingIntent.uploadIntentId,
        origin: "http://localhost:8787",
      })
    ).rejects.toMatchObject({ status: 404, code: "upload_intent_not_found" });
  });
});
