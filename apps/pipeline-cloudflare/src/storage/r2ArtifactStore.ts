import type { ArtifactRecord } from "../domain/records.js";

export type ArtifactRelationKind =
  | "derived_from"
  | "judges"
  | "packages"
  | "references";

export type ArtifactRelationInput = {
  sourceArtifactId: string;
  kind: ArtifactRelationKind;
};

export type PutArtifactInput = {
  artifactId: string;
  runId: string;
  pageId?: string;
  producingOperationId?: string;
  objectKey: string;
  artifactKind: ArtifactRecord["artifact_kind"];
  schemaVersion: string;
  body: ArrayBuffer | ArrayBufferView;
  mimeType: string;
  provider?: string;
  model?: string;
  retentionClass: ArtifactRecord["retention_class"];
  createdAt: string;
  relations?: ArtifactRelationInput[];
};

export type StoredArtifact = {
  record: ArtifactRecord;
  reused: boolean;
};

export type RegisterExternalArtifactInput = Omit<PutArtifactInput, "body"> & {
  sha256: string;
  byteSize: number;
};

export type ArtifactRead = {
  record: ArtifactRecord;
  object: R2ObjectBody;
};

export class ArtifactConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactConflictError";
  }
}

export class ArtifactIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactIntegrityError";
  }
}

export class ArtifactNotFoundError extends Error {
  constructor(artifactId: string) {
    super(`Artifact ${artifactId} was not found`);
    this.name = "ArtifactNotFoundError";
  }
}

export class R2ArtifactStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly database: D1Database
  ) {}

  async putImmutable(input: PutArtifactInput): Promise<StoredArtifact> {
    const body = toArrayBuffer(input.body);
    const digest = await sha256(body);
    const proposed = toRecord(input, digest.hex, body.byteLength);
    const existing = await this.findByIdentity(
      input.artifactId,
      input.objectKey
    );
    if (existing) return this.reuse(existing, proposed);

    const written = await this.bucket.put(input.objectKey, body, {
      onlyIf: new Headers({ "If-None-Match": "*" }),
      httpMetadata: { contentType: input.mimeType },
      customMetadata: {
        artifactId: input.artifactId,
        runId: input.runId,
        sha256: digest.hex,
        schemaVersion: input.schemaVersion,
        retentionClass: input.retentionClass,
      },
      sha256: digest.bytes,
    });

    if (written === null) {
      const object = await this.bucket.head(input.objectKey);
      if (!object || !objectMatchesRecord(proposed, object)) {
        throw new ArtifactConflictError(
          `Immutable object key ${input.objectKey} already contains different bytes or metadata`
        );
      }
    }

    try {
      await this.insertMetadata(proposed, input.relations ?? []);
      return { record: proposed, reused: written === null };
    } catch (error) {
      const concurrent = await this.findByIdentity(
        input.artifactId,
        input.objectKey
      );
      if (concurrent) return this.reuse(concurrent, proposed);
      if (written !== null) await this.bucket.delete(input.objectKey);
      throw error;
    }
  }

  async registerExternalImmutable(
    input: RegisterExternalArtifactInput
  ): Promise<StoredArtifact> {
    const proposed = toExternalRecord(input);
    const existing = await this.findByIdentity(
      input.artifactId,
      input.objectKey
    );
    if (existing) return this.reuse(existing, proposed);

    const object = await this.bucket.head(input.objectKey);
    if (!object || !objectMatchesRecord(proposed, object)) {
      throw new ArtifactIntegrityError(
        `External R2 object ${input.objectKey} does not match Artifact ${input.artifactId}`
      );
    }
    try {
      await this.insertMetadata(proposed, input.relations ?? []);
      return { record: proposed, reused: false };
    } catch (error) {
      const concurrent = await this.findByIdentity(
        input.artifactId,
        input.objectKey
      );
      if (concurrent) return this.reuse(concurrent, proposed);
      throw error;
    }
  }

  async read(artifactId: string): Promise<ArtifactRead> {
    const record = await this.getRecord(artifactId);
    if (!record || record.deleted_at)
      throw new ArtifactNotFoundError(artifactId);
    const object = await this.bucket.get(record.object_key);
    if (!object) {
      throw new ArtifactIntegrityError(
        `R2 object ${record.object_key} is missing for Artifact ${artifactId}`
      );
    }
    verifyObject(record, object);
    return { record, object };
  }

  async verify(artifactId: string): Promise<ArtifactRecord> {
    const record = await this.getRecord(artifactId);
    if (!record || record.deleted_at)
      throw new ArtifactNotFoundError(artifactId);
    const object = await this.bucket.head(record.object_key);
    if (!object) {
      throw new ArtifactIntegrityError(
        `R2 object ${record.object_key} is missing for Artifact ${artifactId}`
      );
    }
    verifyObject(record, object);
    return record;
  }

  async delete(artifactId: string, deletedAt: string): Promise<void> {
    const record = await this.getRecord(artifactId);
    if (!record || record.deleted_at) return;
    await this.bucket.delete(record.object_key);
    await this.database
      .prepare(
        `UPDATE artifacts
         SET deleted_at = ?
         WHERE artifact_id = ? AND deleted_at IS NULL`
      )
      .bind(deletedAt, artifactId)
      .run();
  }

  async getRecord(artifactId: string): Promise<ArtifactRecord | null> {
    return this.database
      .prepare("SELECT * FROM artifacts WHERE artifact_id = ?")
      .bind(artifactId)
      .first<ArtifactRecord>();
  }

  async listRunRecords(runId: string): Promise<ArtifactRecord[]> {
    const result = await this.database
      .prepare(
        `SELECT * FROM artifacts
         WHERE run_id = ? AND deleted_at IS NULL
         ORDER BY created_at, artifact_id`
      )
      .bind(runId)
      .all<ArtifactRecord>();
    return result.results;
  }

  async listRetentionCandidates(
    retentionClass: ArtifactRecord["retention_class"],
    createdBefore: string,
    limit = 100
  ): Promise<ArtifactRecord[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new RangeError(
        "Retention candidate limit must be between 1 and 1000"
      );
    }
    const result = await this.database
      .prepare(
        `SELECT * FROM artifacts
         WHERE retention_class = ?
           AND created_at < ?
           AND deleted_at IS NULL
         ORDER BY created_at, artifact_id
         LIMIT ?`
      )
      .bind(retentionClass, createdBefore, limit)
      .all<ArtifactRecord>();
    return result.results;
  }

  private async findByIdentity(
    artifactId: string,
    objectKey: string
  ): Promise<ArtifactRecord | null> {
    return this.database
      .prepare(
        `SELECT * FROM artifacts
         WHERE artifact_id = ? OR object_key = ?
         LIMIT 1`
      )
      .bind(artifactId, objectKey)
      .first<ArtifactRecord>();
  }

  private async reuse(
    existing: ArtifactRecord,
    proposed: ArtifactRecord
  ): Promise<StoredArtifact> {
    assertSameImmutableArtifact(existing, proposed);
    if (existing.deleted_at) {
      throw new ArtifactConflictError(
        `Artifact ${existing.artifact_id} has been deleted and cannot be recreated in place`
      );
    }
    const object = await this.bucket.head(existing.object_key);
    if (!object) {
      throw new ArtifactIntegrityError(
        `R2 object ${existing.object_key} is missing for Artifact ${existing.artifact_id}`
      );
    }
    verifyObject(existing, object);
    return { record: existing, reused: true };
  }

  private async insertMetadata(
    artifact: ArtifactRecord,
    relations: ArtifactRelationInput[]
  ): Promise<void> {
    const statements = [
      this.database
        .prepare(
          `INSERT INTO artifacts
           (artifact_id, run_id, page_id, producing_operation_id, object_key,
            artifact_kind, schema_version, sha256, byte_size, mime_type,
            provider, model, retention_class, deleted_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`
        )
        .bind(
          artifact.artifact_id,
          artifact.run_id,
          artifact.page_id,
          artifact.producing_operation_id,
          artifact.object_key,
          artifact.artifact_kind,
          artifact.schema_version,
          artifact.sha256,
          artifact.byte_size,
          artifact.mime_type,
          artifact.provider,
          artifact.model,
          artifact.retention_class,
          artifact.created_at
        ),
      ...relations.map(relation =>
        this.database
          .prepare(
            `INSERT INTO artifact_relations
             (artifact_id, source_artifact_id, relation_kind)
             VALUES (?, ?, ?)`
          )
          .bind(artifact.artifact_id, relation.sourceArtifactId, relation.kind)
      ),
    ];
    await this.database.batch(statements);
  }
}

const toRecord = (
  input: PutArtifactInput,
  digest: string,
  byteSize: number
): ArtifactRecord => ({
  artifact_id: input.artifactId,
  run_id: input.runId,
  page_id: input.pageId ?? null,
  producing_operation_id: input.producingOperationId ?? null,
  object_key: input.objectKey,
  artifact_kind: input.artifactKind,
  schema_version: input.schemaVersion,
  sha256: digest,
  byte_size: byteSize,
  mime_type: input.mimeType,
  provider: input.provider ?? null,
  model: input.model ?? null,
  retention_class: input.retentionClass,
  deleted_at: null,
  created_at: input.createdAt,
});

const toExternalRecord = (
  input: RegisterExternalArtifactInput
): ArtifactRecord => ({
  artifact_id: input.artifactId,
  run_id: input.runId,
  page_id: input.pageId ?? null,
  producing_operation_id: input.producingOperationId ?? null,
  object_key: input.objectKey,
  artifact_kind: input.artifactKind,
  schema_version: input.schemaVersion,
  sha256: input.sha256,
  byte_size: input.byteSize,
  mime_type: input.mimeType,
  provider: input.provider ?? null,
  model: input.model ?? null,
  retention_class: input.retentionClass,
  deleted_at: null,
  created_at: input.createdAt,
});

const toArrayBuffer = (body: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
  if (body instanceof ArrayBuffer) return body;
  return body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength
  ) as ArrayBuffer;
};

const sha256 = async (
  body: ArrayBuffer
): Promise<{ bytes: ArrayBuffer; hex: string }> => {
  const bytes = await crypto.subtle.digest("SHA-256", body);
  const hex = Array.from(new Uint8Array(bytes), value =>
    value.toString(16).padStart(2, "0")
  ).join("");
  return { bytes, hex };
};

const assertSameImmutableArtifact = (
  existing: ArtifactRecord,
  proposed: ArtifactRecord
): void => {
  const immutableFields = [
    "artifact_id",
    "run_id",
    "page_id",
    "producing_operation_id",
    "object_key",
    "artifact_kind",
    "schema_version",
    "sha256",
    "byte_size",
    "mime_type",
    "provider",
    "model",
    "retention_class",
  ] as const;
  const changed = immutableFields.find(
    field => existing[field] !== proposed[field]
  );
  if (changed) {
    throw new ArtifactConflictError(
      `Immutable Artifact ${existing.artifact_id} conflicts on ${changed}`
    );
  }
};

const verifyObject = (record: ArtifactRecord, object: R2Object): void => {
  if (!objectMatchesRecord(record, object)) {
    throw new ArtifactIntegrityError(
      `R2 metadata does not match Artifact ${record.artifact_id}`
    );
  }
};

const objectMatchesRecord = (
  record: ArtifactRecord,
  object: R2Object
): boolean => {
  const metadata = object.customMetadata;
  const value = (camelCase: string, lowerCase: string): string | undefined =>
    metadata?.[camelCase] ?? metadata?.[lowerCase];
  return !(
    object.size !== record.byte_size ||
    object.httpMetadata?.contentType !== record.mime_type ||
    value("artifactId", "artifactid") !== record.artifact_id ||
    value("sha256", "sha256") !== record.sha256 ||
    (value("schemaVersion", "schemaversion") !== undefined &&
      value("schemaVersion", "schemaversion") !== record.schema_version) ||
    (value("runId", "runid") !== undefined &&
      value("runId", "runid") !== record.run_id) ||
    (value("retentionClass", "retentionclass") !== undefined &&
      value("retentionClass", "retentionclass") !== record.retention_class)
  );
};
