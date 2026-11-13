import type {
  ImageArtifactResult,
  ImageOperationInput,
  ImageProcessor,
} from "./bookRun.js";

const MOCK_WIDTH = 2480;
const MOCK_HEIGHT = 3508;

/** Image operations for local mock runs. It reads and writes only the bound
 * local R2 bucket and emits deterministic QA data without starting a
 * Container or calling an external image service.
 */
export class LocalMockImageProcessor implements ImageProcessor {
  constructor(private readonly bucket: R2Bucket) {}

  async cleanup(input: ImageOperationInput): Promise<ImageArtifactResult> {
    const source = await this.bucket.get(input.input.objectKey);
    if (!source) throw new Error(`Local mock input ${input.input.artifactId} is missing`);
    const body = await source.arrayBuffer();
    const mimeType = source.httpMetadata?.contentType ?? "image/svg+xml";
    const sha256 = await sha256Hex(body);
    await this.bucket.put(input.output.objectKey, body, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        artifactId: input.output.artifactId,
        sha256,
      },
    });
    return {
      operationId: input.operationId,
      status: "created",
      artifact: {
        artifactId: input.output.artifactId,
        objectKey: input.output.objectKey,
        sourceArtifactId: input.input.artifactId,
        sha256,
        byteSize: body.byteLength,
        mimeType: mimeType as ImageArtifactResult["artifact"]["mimeType"],
        widthPx: MOCK_WIDTH,
        heightPx: MOCK_HEIGHT,
      },
    };
  }

  async printQa(input: ImageOperationInput): Promise<ImageArtifactResult> {
    const assessment = {
      status: "passed" as const,
      score: 1,
      widthPx: MOCK_WIDTH,
      heightPx: MOCK_HEIGHT,
      isCorrectAspectRatio: true,
      isBlackAndWhiteOnly: true,
      blackPixelRatio: 0.18,
      whitePixelRatio: 0.82,
      grayPixelRatio: 0,
    };
    const body = new TextEncoder().encode(JSON.stringify(assessment));
    const sha256 = await sha256Hex(body);
    await this.bucket.put(input.output.objectKey, body, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        artifactId: input.output.artifactId,
        sha256,
      },
    });
    return {
      operationId: input.operationId,
      status: "created",
      artifact: {
        artifactId: input.output.artifactId,
        objectKey: input.output.objectKey,
        sourceArtifactId: input.input.artifactId,
        sha256,
        byteSize: body.byteLength,
        mimeType: "application/json",
        widthPx: MOCK_WIDTH,
        heightPx: MOCK_HEIGHT,
      },
      assessment,
    };
  }
}

const sha256Hex = async (value: ArrayBuffer | Uint8Array): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
