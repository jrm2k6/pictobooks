import { AwsClient } from "aws4fetch";

export type SignedArtifactRequest = {
  url: string;
  method: "GET" | "PUT";
  headers: Record<string, string>;
  expiresAt: string;
};

export type ArtifactSigner = {
  signUpload(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    artifactId: string;
    runId: string;
    expiresInSeconds: number;
  }): Promise<SignedArtifactRequest>;
  signDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<SignedArtifactRequest>;
};

export class R2Presigner implements ArtifactSigner {
  private readonly client: AwsClient;

  constructor(
    accessKeyId: string,
    secretAccessKey: string,
    private readonly endpoint: string,
    private readonly bucket: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.client = new AwsClient({
      service: "s3",
      region: "auto",
      accessKeyId,
      secretAccessKey,
    });
  }

  async signUpload(input: {
    objectKey: string;
    contentType: string;
    byteSize: number;
    sha256: string;
    artifactId: string;
    runId: string;
    expiresInSeconds: number;
  }): Promise<SignedArtifactRequest> {
    const headers = {
      "Content-Type": input.contentType,
      "Content-Length": String(input.byteSize),
      "x-amz-checksum-sha256": hexToBase64(input.sha256),
      "x-amz-meta-artifactid": input.artifactId,
      "x-amz-meta-runid": input.runId,
      "x-amz-meta-sha256": input.sha256,
      "x-amz-meta-schemaversion": "2026-11-10",
      "x-amz-meta-retentionclass": "source",
    };
    const now = this.now();
    const url = new URL(this.objectUrl(input.objectKey));
    url.searchParams.set("X-Amz-Expires", String(input.expiresInSeconds));
    const request = new Request(url, {
      method: "PUT",
      headers,
    });
    const signed = await this.client.sign(request, {
      aws: {
        signQuery: true,
        allHeaders: true,
        datetime: now.toISOString().replace(/[:-]|\.\d{3}/g, ""),
      },
    });
    return {
      url: signed.url.toString(),
      method: "PUT",
      headers,
      expiresAt: new Date(
        now.getTime() + input.expiresInSeconds * 1000
      ).toISOString(),
    };
  }

  async signDownload(input: {
    objectKey: string;
    expiresInSeconds: number;
  }): Promise<SignedArtifactRequest> {
    const now = this.now();
    const url = new URL(this.objectUrl(input.objectKey));
    url.searchParams.set("X-Amz-Expires", String(input.expiresInSeconds));
    const signed = await this.client.sign(new Request(url), {
      aws: { signQuery: true },
    });
    return {
      url: signed.url.toString(),
      method: "GET",
      headers: {},
      expiresAt: new Date(
        now.getTime() + input.expiresInSeconds * 1000
      ).toISOString(),
    };
  }

  private objectUrl(objectKey: string): string {
    return `${this.endpoint.replace(/\/$/, "")}/${encodeURIComponent(this.bucket)}/${objectKey
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }
}

const hexToBase64 = (hex: string): string => {
  const bytes = new Uint8Array(
    hex.match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) ?? []
  );
  let binary = "";
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};
