import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { HttpRequest } from "@smithy/core/protocols";
import type {
  ImmutablePutResult,
  ObjectMetadata,
  ObjectStorage,
  PutObjectInput,
  StoredObject,
} from "./storage.js";

export type S3StorageConfig = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;

  constructor(private readonly config: S3StorageConfig) {
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: "auto",
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const output = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucket, Key: key })
      );
      if (!output.Body) throw new Error(`S3 object ${key} has no body`);
      return {
        body: await output.Body.transformToByteArray(),
        contentType: output.ContentType ?? "application/octet-stream",
        metadata: normalizeMetadata(output.Metadata),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async head(key: string): Promise<ObjectMetadata | null> {
    try {
      const output = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: key })
      );
      return {
        byteSize: output.ContentLength ?? 0,
        contentType: output.ContentType ?? "application/octet-stream",
        metadata: normalizeMetadata(output.Metadata),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async putImmutable(input: PutObjectInput): Promise<ImmutablePutResult> {
    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: input.key,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: input.contentType,
      ChecksumSHA256: input.checksumSha256Base64,
      Metadata: input.metadata,
    });
    command.middlewareStack.add(
      next => async args => {
        if (HttpRequest.isInstance(args.request)) {
          args.request.headers["if-none-match"] = "*";
        }
        return next(args);
      },
      { step: "build", name: "pictobookImmutableWrite" }
    );

    try {
      await this.client.send(command);
      return {
        created: true,
        object: {
          byteSize: input.body.byteLength,
          contentType: input.contentType,
          metadata: input.metadata,
        },
      };
    } catch (error) {
      if (!isPreconditionFailed(error)) throw error;
      const existing = await this.head(input.key);
      if (!existing) {
        throw new Error(
          `Conditional write for ${input.key} failed but the object is missing`,
          { cause: error }
        );
      }
      return { created: false, object: existing };
    }
  }
}

const normalizeMetadata = (
  metadata?: Record<string, string>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(metadata ?? {}).flatMap(([key, value]) =>
      value === undefined ? [] : [[key.toLowerCase(), value]]
    )
  );

const statusCode = (error: unknown): number | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const metadata = Reflect.get(error, "$metadata");
  if (typeof metadata !== "object" || metadata === null) return undefined;
  const value = Reflect.get(metadata, "httpStatusCode");
  return typeof value === "number" ? value : undefined;
};

const errorName = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null) return undefined;
  const value = Reflect.get(error, "name");
  return typeof value === "string" ? value : undefined;
};

const isNotFound = (error: unknown): boolean =>
  statusCode(error) === 404 || errorName(error) === "NoSuchKey";

const isPreconditionFailed = (error: unknown): boolean =>
  statusCode(error) === 412 || errorName(error) === "PreconditionFailed";
