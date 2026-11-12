import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import sharp from "sharp";
import {
  NORMALIZE_SCHEMA_VERSION,
  OperationConflictError,
  OperationInputError,
  runNormalizeOperation,
  type NormalizeOperationRequest,
} from "./normalizeOperation.js";
import type {
  ImmutablePutResult,
  ObjectMetadata,
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./storage.js";

type MemoryObject = StoredObject & { byteSize: number };

class MemoryStorage implements ObjectStorage {
  getCount = 0;
  putCount = 0;
  throwAfterNextPut = false;

  constructor(private readonly objects = new Map<string, MemoryObject>()) {}

  async get(key: string): Promise<StoredObject | null> {
    this.getCount += 1;
    const object = this.objects.get(key);
    return object
      ? {
          body: Uint8Array.from(object.body),
          contentType: object.contentType,
          metadata: { ...object.metadata },
        }
      : null;
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    const object = this.objects.get(key);
    return object ? metadataFrom(object) : null;
  }

  async putImmutable(input: PutObjectInput): Promise<ImmutablePutResult> {
    this.putCount += 1;
    const existing = this.objects.get(input.key);
    if (existing) return { created: false, object: metadataFrom(existing) };

    const object: MemoryObject = {
      body: Uint8Array.from(input.body),
      byteSize: input.body.byteLength,
      contentType: input.contentType,
      metadata: { ...input.metadata },
    };
    this.objects.set(input.key, object);
    if (this.throwAfterNextPut) {
      this.throwAfterNextPut = false;
      throw new Error("simulated process crash after durable write");
    }
    return { created: true, object: metadataFrom(object) };
  }

  seed(key: string, object: StoredObject): void {
    this.objects.set(key, {
      ...object,
      body: Uint8Array.from(object.body),
      byteSize: object.body.byteLength,
      metadata: { ...object.metadata },
    });
  }

  sharedObjects(): Map<string, MemoryObject> {
    return this.objects;
  }
}

const metadataFrom = (object: MemoryObject): ObjectMetadata => ({
  byteSize: object.byteSize,
  contentType: object.contentType,
  metadata: { ...object.metadata },
});

const makeFixture = async () => {
  const input = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 236, g: 90, b: 74, alpha: 0.8 },
    },
  })
    .jpeg({ quality: 87 })
    .toBuffer();
  const request: NormalizeOperationRequest = {
    schemaVersion: NORMALIZE_SCHEMA_VERSION,
    operationId: "normalize:page-001:attempt-1",
    input: {
      artifactId: "source:page-001",
      objectKey: "books/book-001/pages/page-001/source.jpg",
      sha256: sha256(input),
    },
    output: {
      artifactId: "normalized:page-001",
      objectKey: "books/book-001/pages/page-001/normalized.jpg",
    },
  };
  const storage = new MemoryStorage();
  storage.seed(request.input.objectKey, {
    body: input,
    contentType: "image/jpeg",
    metadata: {},
  });
  return { input, request, storage };
};

test("writes an immutable normalized Artifact equivalent to the legacy transform", async () => {
  const { input, request, storage } = await makeFixture();
  const expected = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({
      width: 2480,
      height: 3508,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  const result = await runNormalizeOperation(request, storage);
  const output = await storage.get(request.output.objectKey);

  assert.equal(result.status, "created");
  assert.equal(result.artifact.sha256, sha256(expected));
  assert.equal(result.artifact.byteSize, expected.byteLength);
  assert.deepEqual(Buffer.from(output?.body ?? []), expected);
  assert.deepEqual(
    { width: result.artifact.widthPx, height: result.artifact.heightPx },
    { width: 120, height: 80 }
  );
});

test("replays without reading the source or rewriting the output", async () => {
  const { request, storage } = await makeFixture();
  await runNormalizeOperation(request, storage);
  const getsBeforeReplay = storage.getCount;
  const putsBeforeReplay = storage.putCount;

  const replay = await runNormalizeOperation(request, storage);

  assert.equal(replay.status, "reused");
  assert.equal(storage.getCount, getsBeforeReplay);
  assert.equal(storage.putCount, putsBeforeReplay);
});

test("recovers after a crash following the durable output write", async () => {
  const { request, storage } = await makeFixture();
  storage.throwAfterNextPut = true;
  await assert.rejects(
    runNormalizeOperation(request, storage),
    /simulated process crash/
  );

  const restartedStorage = new MemoryStorage(storage.sharedObjects());
  const replay = await runNormalizeOperation(request, restartedStorage);

  assert.equal(replay.status, "reused");
  assert.equal(restartedStorage.getCount, 0);
  assert.equal(restartedStorage.putCount, 0);
});

test("rejects an output key owned by a different operation", async () => {
  const { request, storage } = await makeFixture();
  await runNormalizeOperation(request, storage);

  await assert.rejects(
    runNormalizeOperation(
      { ...request, operationId: "normalize:page-001:attempt-2" },
      storage
    ),
    OperationConflictError
  );
});

test("rejects a source whose bytes do not match its Artifact checksum", async () => {
  const { request, storage } = await makeFixture();

  await assert.rejects(
    runNormalizeOperation(
      {
        ...request,
        input: { ...request.input, sha256: "0".repeat(64) },
      },
      storage
    ),
    OperationInputError
  );
});

const sha256 = (body: Uint8Array): string =>
  createHash("sha256").update(body).digest("hex");
