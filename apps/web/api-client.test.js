import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken }),
}));

const localUpload = "/v1/books/book/runs/run/upload-intents/intent/content";
const photo = new File(["test photo"], "photo.png", { type: "image/png" });

describe("uploadPhoto", () => {
  const fetchUpload = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", undefined);
    vi.stubGlobal("fetch", fetchUpload);
    fetchUpload.mockReset();
    getToken.mockReset().mockResolvedValue("clerk-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends local uploads to the Worker with the current session", async () => {
    const { useApiClient } = await import("./api-client.js");
    const response = new Response(null, { status: 204 });
    fetchUpload.mockResolvedValue(response);
    const requiredHeaders = {
      "Content-Type": "image/png",
      "X-Upload-Intent": "intent",
    };

    await expect(
      useApiClient().uploadPhoto(localUpload, requiredHeaders, photo)
    ).resolves.toBe(response);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchUpload).toHaveBeenCalledWith(
      `http://127.0.0.1:8787${localUpload}`,
      {
        method: "PUT",
        headers: { ...requiredHeaders, Authorization: "Bearer clerk-token" },
        body: photo,
      }
    );
  });

  it("authenticates an absolute refreshed upload URL on the configured API origin", async () => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.invalid");
    const { useApiClient } = await import("./api-client.js");
    const response = new Response(null, { status: 204 });
    fetchUpload.mockResolvedValue(response);
    const refreshedUrl = `https://api.invalid${localUpload}`;

    await expect(
      useApiClient().uploadPhoto(refreshedUrl, {}, photo)
    ).resolves.toBe(response);
    expect(getToken).toHaveBeenCalledOnce();
    expect(fetchUpload).toHaveBeenCalledWith(refreshedUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "image/png",
        Authorization: "Bearer clerk-token",
      },
      body: photo,
    });
  });

  it.each([
    "https://storage.invalid/photos/photo.png?signature=test",
    `https://api.invalid.storage.invalid${localUpload}?signature=test`,
    "https://api.invalid/photos/photo.png?signature=test",
  ])("keeps Clerk tokens out of uploads to %s", async presignedUrl => {
    vi.stubEnv("VITE_API_BASE_URL", "https://api.invalid");
    const { useApiClient } = await import("./api-client.js");
    const response = new Response(null, { status: 204 });
    fetchUpload.mockResolvedValue(response);

    await expect(
      useApiClient().uploadPhoto(
        presignedUrl,
        { "x-amz-meta-id": "photo" },
        photo
      )
    ).resolves.toBe(response);
    expect(getToken).not.toHaveBeenCalled();
    expect(fetchUpload).toHaveBeenCalledWith(presignedUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png", "x-amz-meta-id": "photo" },
      body: photo,
    });
  });

  it("reports an expired local upload session as an UnauthorizedError", async () => {
    const { useApiClient, UnauthorizedError } = await import("./api-client.js");
    fetchUpload.mockResolvedValue(new Response(null, { status: 401 }));

    await expect(
      useApiClient().uploadPhoto(localUpload, {}, photo)
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe("getPipelineConfig", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", undefined);
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    getToken.mockReset().mockResolvedValue("clerk-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("fetches GET /v1/pipeline-config with the Clerk Bearer token", async () => {
    const { useApiClient } = await import("./api-client.js");
    const payload = {
      minPhotosPerRun: 5,
      maxPhotosPerRun: 10,
      maxBooksPerUser: 1,
    };
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await expect(useApiClient().getPipelineConfig()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/v1/pipeline-config",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer clerk-token" },
      })
    );
  });
});
