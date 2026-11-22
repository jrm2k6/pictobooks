import { describe, expect, it, vi } from "vitest";
import { replacePhotoSequence } from "./use-page-review.js";

describe("replacePhotoSequence", () => {
  it("uploads then starts the run, in order", async () => {
    const calls = [];
    const api = {
      createPhotoReplacement: vi.fn(async () => {
        calls.push("createPhotoReplacement");
        return {
          runId: "run-x",
          upload: { uploadUrl: "https://x", requiredHeaders: {} },
        };
      }),
      uploadPhoto: vi.fn(async () => {
        calls.push("uploadPhoto");
      }),
      startBookRun: vi.fn(async () => {
        calls.push("startBookRun");
      }),
    };
    await replacePhotoSequence({
      api,
      bookId: "book-1",
      pageId: "page-1",
      file: { type: "image/jpeg", size: 100 },
      sha256Hex: async () => "a".repeat(64),
    });
    expect(calls).toEqual([
      "createPhotoReplacement",
      "uploadPhoto",
      "startBookRun",
    ]);
    expect(api.startBookRun).toHaveBeenCalledWith("book-1", "run-x");
  });

  it("does not start the run when the upload fails", async () => {
    const api = {
      createPhotoReplacement: vi.fn(async () => ({
        runId: "run-x",
        upload: { uploadUrl: "https://x", requiredHeaders: {} },
      })),
      uploadPhoto: vi.fn(async () => {
        throw new Error("network drop");
      }),
      startBookRun: vi.fn(async () => {}),
    };
    await expect(
      replacePhotoSequence({
        api,
        bookId: "book-1",
        pageId: "page-1",
        file: { type: "image/jpeg", size: 100 },
        sha256Hex: async () => "a".repeat(64),
      })
    ).rejects.toThrow("network drop");
    expect(api.startBookRun).not.toHaveBeenCalled();
  });
});
