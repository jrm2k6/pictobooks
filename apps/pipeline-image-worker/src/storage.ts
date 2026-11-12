export type StoredObject = {
  body: Uint8Array;
  contentType: string;
  metadata: Record<string, string>;
};

export type ObjectMetadata = {
  byteSize: number;
  contentType: string;
  metadata: Record<string, string>;
};

export type PutObjectInput = {
  key: string;
  body: Uint8Array;
  contentType: string;
  checksumSha256Base64: string;
  metadata: Record<string, string>;
};

export type ImmutablePutResult = {
  created: boolean;
  object: ObjectMetadata;
};

export type ObjectStorage = {
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectMetadata | null>;
  putImmutable(input: PutObjectInput): Promise<ImmutablePutResult>;
};
