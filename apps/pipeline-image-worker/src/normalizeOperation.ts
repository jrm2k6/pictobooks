import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ObjectMetadata, ObjectStorage } from "./storage.js";

export const NORMALIZE_SCHEMA_VERSION = "2026-11-08";
const MAX_NORMALIZED_BYTES = 8 * 1024 * 1024;

export type NormalizeOperationRequest = {
  schemaVersion: typeof NORMALIZE_SCHEMA_VERSION;
  operationId: string;
  input: {
    artifactId: string;
    objectKey: string;
    sha256: string;
  };
  output: {
    artifactId: string;
    objectKey: string;
  };
};

export type NormalizeOperationResult = {
  schemaVersion: typeof NORMALIZE_SCHEMA_VERSION;
  operationId: string;
  status: "created" | "reused";
  artifact: {
    artifactId: string;
    objectKey: string;
    sourceArtifactId: string;
    sha256: string;
    byteSize: number;
    mimeType: "image/jpeg" | "image/png";
    widthPx: number;
    heightPx: number;
  };
};

export class OperationConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationConflictError";
  }
}

export class OperationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationInputError";
  }
}

export const runNormalizeOperation = async (
  request: NormalizeOperationRequest,
  storage: ObjectStorage
): Promise<NormalizeOperationResult> => {
  validateRequest(request);
  const existing = await storage.head(request.output.objectKey);
  if (existing) return resultFromExisting(request, existing);

  const input = await storage.get(request.input.objectKey);
  if (!input) {
    throw new OperationInputError(
      `Input Artifact ${request.input.artifactId} is missing`
    );
  }
  const inputSha256 = sha256Hex(input.body);
  if (inputSha256 !== request.input.sha256) {
    throw new OperationInputError(
      `Input Artifact ${request.input.artifactId} checksum does not match`
    );
  }

  let width = 2480;
  let height = 3508;
  let quality = 88;
  let normalized: Awaited<ReturnType<ReturnType<typeof sharp>["toBuffer"]>>;
  while (true) {
    normalized = await sharp(input.body, { failOn: "error" })
      .rotate()
      .resize({
        width,
        height,
        fit: "inside",
        withoutEnlargement: true,
      })
      .removeAlpha()
      .jpeg({ quality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (normalized.data.byteLength <= MAX_NORMALIZED_BYTES) break;
    if (quality > 76) {
      quality -= 6;
      continue;
    }
    width = Math.floor(width * 0.8);
    height = Math.floor(height * 0.8);
    quality = 82;
    if (width < 1024) {
      throw new OperationInputError(
        "Normalized source photo exceeds the maximum image size"
      );
    }
  }
  const { data, info } = normalized;
  const outputSha256 = sha256Hex(data);
  const metadata = outputMetadata(
    request,
    outputSha256,
    info.width,
    info.height
  );
  const put = await storage.putImmutable({
    key: request.output.objectKey,
    body: data,
    contentType: "image/jpeg",
    checksumSha256Base64: Buffer.from(outputSha256, "hex").toString("base64"),
    metadata,
  });

  assertMatchingOutput(request, put.object);
  return {
    schemaVersion: NORMALIZE_SCHEMA_VERSION,
    operationId: request.operationId,
    status: put.created ? "created" : "reused",
    artifact: artifactFromMetadata(request, put.object),
  };
};

const resultFromExisting = (
  request: NormalizeOperationRequest,
  existing: ObjectMetadata
): NormalizeOperationResult => {
  assertMatchingOutput(request, existing);
  return {
    schemaVersion: NORMALIZE_SCHEMA_VERSION,
    operationId: request.operationId,
    status: "reused",
    artifact: artifactFromMetadata(request, existing),
  };
};

const assertMatchingOutput = (
  request: NormalizeOperationRequest,
  object: ObjectMetadata
): void => {
  const metadata = object.metadata;
  if (
    object.contentType !== "image/jpeg" ||
    metadata.operationid !== request.operationId ||
    metadata.artifactid !== request.output.artifactId ||
    metadata.sourceartifactid !== request.input.artifactId ||
    metadata.sourcesha256 !== request.input.sha256 ||
    !isSha256(metadata.sha256) ||
    !isPositiveInteger(metadata.widthpx) ||
    !isPositiveInteger(metadata.heightpx)
  ) {
    throw new OperationConflictError(
      `Output key ${request.output.objectKey} belongs to a different operation or Artifact`
    );
  }
};

const artifactFromMetadata = (
  request: NormalizeOperationRequest,
  object: ObjectMetadata
): NormalizeOperationResult["artifact"] => ({
  artifactId: request.output.artifactId,
  objectKey: request.output.objectKey,
  sourceArtifactId: request.input.artifactId,
  sha256: object.metadata.sha256 ?? "",
  byteSize: object.byteSize,
  mimeType: "image/jpeg",
  widthPx: Number(object.metadata.widthpx),
  heightPx: Number(object.metadata.heightpx),
});

const outputMetadata = (
  request: NormalizeOperationRequest,
  sha256: string,
  width: number,
  height: number
): Record<string, string> => ({
  operationid: request.operationId,
  artifactid: request.output.artifactId,
  sourceartifactid: request.input.artifactId,
  sourcesha256: request.input.sha256,
  sha256,
  widthpx: String(width),
  heightpx: String(height),
  schemaversion: NORMALIZE_SCHEMA_VERSION,
});

const validateRequest = (request: NormalizeOperationRequest): void => {
  if (request.schemaVersion !== NORMALIZE_SCHEMA_VERSION) {
    throw new OperationInputError("Unsupported normalize-operation schema");
  }
  for (const [name, value] of [
    ["operationId", request.operationId],
    ["input.artifactId", request.input.artifactId],
    ["output.artifactId", request.output.artifactId],
  ]) {
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(value)) {
      throw new OperationInputError(`${name} is invalid`);
    }
  }
  if (
    !isObjectKey(request.input.objectKey) ||
    !isObjectKey(request.output.objectKey)
  ) {
    throw new OperationInputError("Artifact object key is invalid");
  }
  if (!isSha256(request.input.sha256)) {
    throw new OperationInputError("Input SHA-256 is invalid");
  }
};

const isObjectKey = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 1024 &&
  !value.startsWith("/") &&
  !value.includes("..") &&
  !value.includes("\\");

const isSha256 = (value: string | undefined): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

const isPositiveInteger = (value: string | undefined): boolean => {
  if (value === undefined || !/^\d+$/.test(value)) return false;
  return Number(value) > 0;
};

const sha256Hex = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");
