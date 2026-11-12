import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  NORMALIZE_SCHEMA_VERSION,
  OperationConflictError,
  OperationInputError,
  type NormalizeOperationRequest,
} from "./normalizeOperation.js";
import type { ObjectMetadata, ObjectStorage } from "./storage.js";

export type PrintQaAssessment = {
  status: "passed" | "needs_review";
  score: number;
  widthPx: number;
  heightPx: number;
  isCorrectAspectRatio: boolean;
  isBlackAndWhiteOnly: boolean;
  blackPixelRatio: number;
  whitePixelRatio: number;
  grayPixelRatio: number;
};

export type PrintQaOperationRequest = NormalizeOperationRequest;

export type PrintQaOperationResult = {
  schemaVersion: typeof NORMALIZE_SCHEMA_VERSION;
  operationId: string;
  status: "created" | "reused";
  artifact: {
    artifactId: string;
    objectKey: string;
    sourceArtifactId: string;
    sha256: string;
    byteSize: number;
    mimeType: "application/json";
  };
  assessment: PrintQaAssessment;
};

export const runPrintQaOperation = async (
  request: PrintQaOperationRequest,
  storage: ObjectStorage
): Promise<PrintQaOperationResult> => {
  validateRequest(request);
  const existing = await storage.head(request.output.objectKey);
  if (existing) return resultFromExisting(request, existing, storage);

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

  const assessment = await measurePrintFitness(input.body);
  const body = Buffer.from(
    JSON.stringify({
      schemaVersion: NORMALIZE_SCHEMA_VERSION,
      sourceArtifactId: request.input.artifactId,
      sourceSha256: request.input.sha256,
      assessment,
    })
  );
  const outputSha256 = sha256Hex(body);
  const metadata = {
    operationid: request.operationId,
    operationtype: "print-qa",
    artifactid: request.output.artifactId,
    sourceartifactid: request.input.artifactId,
    sourcesha256: request.input.sha256,
    sha256: outputSha256,
    qastatus: assessment.status,
    schemaversion: NORMALIZE_SCHEMA_VERSION,
  };
  const put = await storage.putImmutable({
    key: request.output.objectKey,
    body,
    contentType: "application/json",
    checksumSha256Base64: Buffer.from(outputSha256, "hex").toString("base64"),
    metadata,
  });
  if (!put.created) return resultFromExisting(request, put.object, storage);
  return buildResult(request, put.object, "created", assessment);
};

const resultFromExisting = async (
  request: PrintQaOperationRequest,
  object: ObjectMetadata,
  storage: ObjectStorage
): Promise<PrintQaOperationResult> => {
  assertMatching(request, object);
  const stored = await storage.get(request.output.objectKey);
  if (!stored || sha256Hex(stored.body) !== object.metadata.sha256) {
    throw new OperationConflictError(
      "Print QA Artifact integrity check failed"
    );
  }
  let assessment: PrintQaAssessment;
  try {
    const parsed = JSON.parse(Buffer.from(stored.body).toString("utf8")) as {
      assessment: PrintQaAssessment;
    };
    assessment = parsed.assessment;
  } catch {
    throw new OperationConflictError("Print QA Artifact is invalid JSON");
  }
  return buildResult(request, object, "reused", assessment);
};

const buildResult = (
  request: PrintQaOperationRequest,
  object: ObjectMetadata,
  status: "created" | "reused",
  assessment: PrintQaAssessment
): PrintQaOperationResult => {
  assertMatching(request, object);
  return {
    schemaVersion: NORMALIZE_SCHEMA_VERSION,
    operationId: request.operationId,
    status,
    artifact: {
      artifactId: request.output.artifactId,
      objectKey: request.output.objectKey,
      sourceArtifactId: request.input.artifactId,
      sha256: object.metadata.sha256 ?? "",
      byteSize: object.byteSize,
      mimeType: "application/json",
    },
    assessment,
  };
};

const assertMatching = (
  request: PrintQaOperationRequest,
  object: ObjectMetadata
): void => {
  const metadata = object.metadata;
  if (
    object.contentType !== "application/json" ||
    metadata.operationid !== request.operationId ||
    metadata.operationtype !== "print-qa" ||
    metadata.artifactid !== request.output.artifactId ||
    metadata.sourceartifactid !== request.input.artifactId ||
    metadata.sourcesha256 !== request.input.sha256 ||
    !isSha256(metadata.sha256)
  ) {
    throw new OperationConflictError(
      `Output key ${request.output.objectKey} belongs to a different operation or Artifact`
    );
  }
};

const measurePrintFitness = async (
  body: Uint8Array
): Promise<PrintQaAssessment> => {
  const { data, info } = await sharp(body, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixelCount = info.width * info.height;
  let black = 0;
  let white = 0;
  let gray = 0;
  for (let index = 0; index < data.length; index += info.channels) {
    const red = data[index] ?? 255;
    const green = data[index + 1] ?? red;
    const blue = data[index + 2] ?? red;
    const min = Math.min(red, green, blue);
    const max = Math.max(red, green, blue);
    if (max <= 24) black += 1;
    else if (min >= 245) white += 1;
    else gray += 1;
  }
  const blackPixelRatio = ratio(black, pixelCount);
  const whitePixelRatio = ratio(white, pixelCount);
  const grayPixelRatio = ratio(gray, pixelCount);
  const isCorrectAspectRatio = info.width === 2480 && info.height === 3508;
  const isBlackAndWhiteOnly = grayPixelRatio <= 0.01;
  const blackDensityScore =
    blackPixelRatio >= 0.08 && blackPixelRatio <= 0.24
      ? 1
      : blackPixelRatio < 0.05 || blackPixelRatio > 0.3
        ? 0.6
        : 0.82;
  const grayScore =
    grayPixelRatio <= 0.01 ? 1 : grayPixelRatio <= 0.05 ? 0.82 : 0.45;
  const dimensionScore = isCorrectAspectRatio ? 1 : 0.3;
  const score = Number(
    ((blackDensityScore + grayScore + dimensionScore) / 3).toFixed(3)
  );
  const passed =
    isCorrectAspectRatio &&
    isBlackAndWhiteOnly &&
    blackPixelRatio >= 0.05 &&
    blackPixelRatio <= 0.3;
  return {
    status: passed ? "passed" : "needs_review",
    score,
    widthPx: info.width,
    heightPx: info.height,
    isCorrectAspectRatio,
    isBlackAndWhiteOnly,
    blackPixelRatio,
    whitePixelRatio,
    grayPixelRatio,
  };
};

const validateRequest = (request: PrintQaOperationRequest): void => {
  if (request.schemaVersion !== NORMALIZE_SCHEMA_VERSION) {
    throw new OperationInputError("Unsupported print-qa-operation schema");
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

const ratio = (value: number, total: number): number =>
  total === 0 ? 0 : Number((value / total).toFixed(6));

const sha256Hex = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");
