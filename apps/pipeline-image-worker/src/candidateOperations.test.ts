import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import { runCleanupOperation } from "./cleanupOperation.js";
import {
  NORMALIZE_SCHEMA_VERSION,
  type NormalizeOperationRequest,
} from "./normalizeOperation.js";
import { runPrintQaOperation } from "./printQaOperation.js";
import type {
  ImmutablePutResult,
  ObjectMetadata,
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./storage.js";

type MemoryObject = StoredObject & { byteSize: number };

class MemoryStorage implements ObjectStorage {
  private readonly objects = new Map<string, MemoryObject>();

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const object = this.objects.get(key);
    return object
      ? {
          byteSize: object.byteSize,
          contentType: object.contentType,
          metadata: object.metadata,
        }
      : null;
  }

  async putImmutable(input: PutObjectInput): Promise<ImmutablePutResult> {
    const existing = await this.head(input.key);
    if (existing) return { created: false, object: existing };
    const object = {
      body: Uint8Array.from(input.body),
      byteSize: input.body.byteLength,
      contentType: input.contentType,
      metadata: { ...input.metadata },
    };
    this.objects.set(input.key, object);
    return { created: true, object };
  }

  seed(key: string, body: Uint8Array, contentType = "image/png"): void {
    this.objects.set(key, {
      body,
      byteSize: body.byteLength,
      contentType,
      metadata: {},
    });
  }
}

test("cleanup matches the local black-and-white transform and replays", async () => {
  const input = await sharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 170, g: 200, b: 230 },
    },
  })
    .png()
    .toBuffer();
  const storage = new MemoryStorage();
  const request = operation("cleanup", input, "candidate.png", "cleaned.png");
  storage.seed(request.input.objectKey, input);
  const expected = await sharp(input, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .threshold(220)
    .png()
    .toBuffer();

  const created = await runCleanupOperation(request, storage);
  const replay = await runCleanupOperation(request, storage);
  const output = await storage.get(request.output.objectKey);

  assert.equal(created.status, "created");
  assert.equal(replay.status, "reused");
  assert.deepEqual(Buffer.from(output?.body ?? []), expected);
});

test("Print QA matches the local metric thresholds and persists its result", async () => {
  const input = await sharp({
    create: {
      width: 2480,
      height: 3508,
      channels: 3,
      background: "white",
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 300,
            height: 3508,
            channels: 3,
            background: "black",
          },
        },
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const storage = new MemoryStorage();
  const request = operation("print-qa", input, "cleaned.png", "print-qa.json");
  storage.seed(request.input.objectKey, input);

  const created = await runPrintQaOperation(request, storage);
  const replay = await runPrintQaOperation(request, storage);

  assert.equal(created.status, "created");
  assert.equal(created.assessment.status, "passed");
  assert.equal(created.assessment.blackPixelRatio, 0.120968);
  assert.equal(created.assessment.grayPixelRatio, 0);
  assert.equal(replay.status, "reused");
  assert.deepEqual(replay.assessment, created.assessment);
});

const operation = (
  name: string,
  body: Uint8Array,
  inputKey: string,
  outputKey: string
): NormalizeOperationRequest => ({
  schemaVersion: NORMALIZE_SCHEMA_VERSION,
  operationId: `${name}:page-001:attempt-1`,
  input: {
    artifactId: `${name}-input:page-001`,
    objectKey: `books/book-001/pages/page-001/${inputKey}`,
    sha256: sha256(body),
  },
  output: {
    artifactId: `${name}-output:page-001`,
    objectKey: `books/book-001/pages/page-001/${outputKey}`,
  },
});

const sha256 = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");
