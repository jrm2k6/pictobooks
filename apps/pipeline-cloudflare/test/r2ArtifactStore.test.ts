import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { reset } from "cloudflare:test";
import {
  ArtifactConflictError,
  ArtifactIntegrityError,
  ArtifactNotFoundError,
  R2ArtifactStore,
  type PutArtifactInput,
} from "../src/storage/r2ArtifactStore.js";

const createdAt = "2026-11-08T00:00:00.000Z";
const encoder = new TextEncoder();

const digest = async (bytes: Uint8Array) => {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return {
    bytes: hash,
    hex: Array.from(new Uint8Array(hash), value =>
      value.toString(16).padStart(2, "0")
    ).join(""),
  };
};

const sourceInput = (
  overrides: Partial<PutArtifactInput> = {}
): PutArtifactInput => ({
  artifactId: "artifact_source",
  runId: "run_1",
  objectKey: "books/book_1/runs/run_1/photos/photo_1/source/v1",
  artifactKind: "source_photo",
  schemaVersion: "2026-11-08",
  body: encoder.encode("source bytes"),
  mimeType: "image/jpeg",
  retentionClass: "source",
  createdAt,
  ...overrides,
});

const createSchema = async () => {
  await env.PIPELINE_DB.exec(
    "CREATE TABLE artifacts (artifact_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, page_id TEXT, producing_operation_id TEXT, object_key TEXT NOT NULL UNIQUE, artifact_kind TEXT NOT NULL, schema_version TEXT NOT NULL, sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, mime_type TEXT NOT NULL, provider TEXT, model TEXT, retention_class TEXT NOT NULL, deleted_at TEXT, created_at TEXT NOT NULL) STRICT;"
  );
  await env.PIPELINE_DB.exec(
    "CREATE TABLE artifact_relations (artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), source_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id), relation_kind TEXT NOT NULL, PRIMARY KEY (artifact_id, source_artifact_id, relation_kind)) STRICT, WITHOUT ROWID;"
  );
};

describe("R2ArtifactStore", () => {
  beforeEach(async () => {
    await reset();
    await createSchema();
  });

  it("uploads, indexes, verifies, and reads an immutable Artifact", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    const stored = await store.putImmutable(sourceInput());

    expect(stored.reused).toBe(false);
    expect(stored.record.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await store.verify("artifact_source")).toEqual(stored.record);

    const read = await store.read("artifact_source");
    expect(await read.object.text()).toBe("source bytes");
    expect(read.object.customMetadata.sha256).toBe(stored.record.sha256);

    const indexed = await env.PIPELINE_DB.prepare(
      "SELECT object_key FROM artifacts WHERE artifact_id = ?"
    )
      .bind("artifact_source")
      .first<{ object_key: string }>();
    expect(indexed?.object_key).toBe(stored.record.object_key);
  });

  it("replays identical writes and rejects divergent bytes", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    const first = await store.putImmutable(sourceInput());
    const replay = await store.putImmutable(sourceInput());

    expect(replay.reused).toBe(true);
    expect(replay.record).toEqual(first.record);
    await expect(
      store.putImmutable(
        sourceInput({ body: encoder.encode("different bytes") })
      )
    ).rejects.toBeInstanceOf(ArtifactConflictError);
    expect(await (await store.read("artifact_source")).object.text()).toBe(
      "source bytes"
    );
  });

  it("recovers an identical R2 object left before its D1 commit", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    const input = sourceInput();
    const body = encoder.encode("source bytes");
    const hash = await digest(body);
    await env.PIPELINE_ARTIFACTS.put(input.objectKey, body, {
      httpMetadata: { contentType: input.mimeType },
      customMetadata: {
        artifactId: input.artifactId,
        runId: input.runId,
        sha256: hash.hex,
        schemaVersion: input.schemaVersion,
        retentionClass: input.retentionClass,
      },
      sha256: hash.bytes,
    });

    const recovered = await store.putImmutable(input);
    expect(recovered.reused).toBe(true);
    expect(await store.getRecord(input.artifactId)).toEqual(recovered.record);
  });

  it("registers a Container-written immutable Artifact after verifying R2", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    const body = encoder.encode("container output");
    const hash = await digest(body);
    const objectKey =
      "books/book_1/runs/run_1/pages/page_1/candidates/candidate_1/clean.png";
    await env.PIPELINE_ARTIFACTS.put(objectKey, body, {
      httpMetadata: { contentType: "image/png" },
      customMetadata: {
        artifactid: "artifact_clean",
        sha256: hash.hex,
        schemaversion: "2026-11-08",
      },
      sha256: hash.bytes,
    });

    const stored = await store.registerExternalImmutable({
      artifactId: "artifact_clean",
      runId: "run_1",
      pageId: "page_1",
      objectKey,
      artifactKind: "candidate_clean",
      schemaVersion: "2026-11-08",
      sha256: hash.hex,
      byteSize: body.byteLength,
      mimeType: "image/png",
      retentionClass: "derived",
      createdAt,
    });

    expect(stored.reused).toBe(false);
    expect(await store.verify("artifact_clean")).toEqual(stored.record);
  });

  it("records provenance and recovers a run through D1 without R2 listing", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    await store.putImmutable(sourceInput());
    await store.putImmutable(
      sourceInput({
        artifactId: "artifact_normalized",
        objectKey: "books/book_1/runs/run_1/photos/photo_1/normalized/v1.png",
        artifactKind: "normalized_photo",
        body: encoder.encode("normalized bytes"),
        mimeType: "image/png",
        retentionClass: "derived",
        relations: [
          { sourceArtifactId: "artifact_source", kind: "derived_from" },
        ],
      })
    );

    expect(
      (await store.listRunRecords("run_1")).map(row => row.artifact_id)
    ).toEqual(["artifact_normalized", "artifact_source"]);
    const relation = await env.PIPELINE_DB.prepare(
      `SELECT relation_kind FROM artifact_relations
       WHERE artifact_id = ? AND source_artifact_id = ?`
    )
      .bind("artifact_normalized", "artifact_source")
      .first<{ relation_kind: string }>();
    expect(relation?.relation_kind).toBe("derived_from");
  });

  it("detects R2 metadata drift", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    const stored = await store.putImmutable(sourceInput());
    await env.PIPELINE_ARTIFACTS.put(
      stored.record.object_key,
      encoder.encode("source bytes"),
      {
        httpMetadata: { contentType: "image/jpeg" },
        customMetadata: { artifactId: "wrong", sha256: "wrong" },
      }
    );

    await expect(store.verify("artifact_source")).rejects.toBeInstanceOf(
      ArtifactIntegrityError
    );
  });

  it("deletes R2 bytes, tombstones D1 metadata, and is replay-safe", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    const stored = await store.putImmutable(sourceInput());
    const deletedAt = "2026-12-08T00:00:00.000Z";

    await store.delete("artifact_source", deletedAt);
    await store.delete("artifact_source", deletedAt);

    expect(
      await env.PIPELINE_ARTIFACTS.head(stored.record.object_key)
    ).toBeNull();
    expect((await store.getRecord("artifact_source"))?.deleted_at).toBe(
      deletedAt
    );
    await expect(store.read("artifact_source")).rejects.toBeInstanceOf(
      ArtifactNotFoundError
    );
  });

  it("selects lifecycle candidates from D1 without listing R2", async () => {
    const store = new R2ArtifactStore(env.PIPELINE_ARTIFACTS, env.PIPELINE_DB);
    await store.putImmutable(sourceInput());

    expect(
      await store.listRetentionCandidates("source", "2026-12-01T00:00:00.000Z")
    ).toHaveLength(1);
    expect(
      await store.listRetentionCandidates("source", "2026-10-01T00:00:00.000Z")
    ).toHaveLength(0);
  });
});
