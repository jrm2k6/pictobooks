import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  NORMALIZE_SCHEMA_VERSION,
  OperationConflictError,
  OperationInputError,
  type NormalizeOperationRequest,
  type NormalizeOperationResult,
} from "./normalizeOperation.js";
import type { ObjectMetadata, ObjectStorage } from "./storage.js";

export type CleanupOperationRequest = NormalizeOperationRequest;
export type CleanupOperationResult = NormalizeOperationResult;

export const runCleanupOperation = async (
  request: CleanupOperationRequest,
  storage: ObjectStorage
): Promise<CleanupOperationResult> => {
  validateRequest(request);
  const existing = await storage.head(request.output.objectKey);
  if (existing) return resultFromObject(request, existing, "reused");

  const input = await storage.get(request.input.objectKey);
  if (!input) {
    throw new OperationInputError(
      `Input Artifact ${request.input.artifactId} is missing`
    );
  }
  if (sha256Hex(input.body) !== request.input.sha256) {
    throw new OperationInputError(
      `Input Artifact ${request.input.artifactId} checksum does not match`
    );
  }

  const { data, info } = await sharp(input.body, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .threshold(220)
    .png()
    .toBuffer({ resolveWithObject: true });
  const outputSha256 = sha256Hex(data);
  const metadata = {
    operationid: request.operationId,
    operationtype: "cleanup",
    artifactid: request.output.artifactId,
    sourceartifactid: request.input.artifactId,
    sourcesha256: request.input.sha256,
    sha256: outputSha256,
    widthpx: String(info.width),
    heightpx: String(info.height),
    schemaversion: NORMALIZE_SCHEMA_VERSION,
  };
  const put = await storage.putImmutable({
    key: request.output.objectKey,
    body: data,
    contentType: "image/png",
    checksumSha256Base64: Buffer.from(outputSha256, "hex").toString("base64"),
    metadata,
  });
  return resultFromObject(
    request,
    put.object,
    put.created ? "created" : "reused"
  );
};

const resultFromObject = (
  request: CleanupOperationRequest,
  object: ObjectMetadata,
  status: "created" | "reused"
): CleanupOperationResult => {
  const metadata = object.metadata;
  if (
    object.contentType !== "image/png" ||
    metadata.operationid !== request.operationId ||
    metadata.operationtype !== "cleanup" ||
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
  return {
    schemaVersion: NORMALIZE_SCHEMA_VERSION,
    operationId: request.operationId,
    status,
    artifact: {
      artifactId: request.output.artifactId,
      objectKey: request.output.objectKey,
      sourceArtifactId: request.input.artifactId,
      sha256: metadata.sha256,
      byteSize: object.byteSize,
      mimeType: "image/png",
      widthPx: Number(metadata.widthpx),
      heightPx: Number(metadata.heightpx),
    },
  };
};

const validateRequest = (request: CleanupOperationRequest): void => {
  if (request.schemaVersion !== NORMALIZE_SCHEMA_VERSION) {
    throw new OperationInputError("Unsupported cleanup-operation schema");
  }
  for (const value of [
    request.operationId,
    request.input.artifactId,
    request.output.artifactId,
  ]) {
    if (!/^[a-zA-Z0-9:_-]{1,200}$/.test(value)) {
      throw new OperationInputError("Operation or Artifact ID is invalid");
    }
  }
  if (
    !isObjectKey(request.input.objectKey) ||
    !isObjectKey(request.output.objectKey) ||
    !isSha256(request.input.sha256)
  ) {
    throw new OperationInputError("Artifact key or checksum is invalid");
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

const isPositiveInteger = (value: string | undefined): boolean =>
  value !== undefined && /^\d+$/.test(value) && Number(value) > 0;

const sha256Hex = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");
