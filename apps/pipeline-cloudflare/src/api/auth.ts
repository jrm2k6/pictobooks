export type Principal = { userId: string; sessionId: string };

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthenticationError";
  }
}

type JwkRecord = {
  kid?: string;
  [key: string]: unknown;
};

export type JwksFetcher = (url: string) => Promise<JwkRecord[]>;

/** Module-level JWKS cache shared across all requests in the same isolate. */
const jwksCache = new Map<string, JwkRecord[]>();

const defaultJwksFetcher: JwksFetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new AuthenticationError();
  const data = (await response.json()) as { keys: JwkRecord[] };
  return data.keys;
};

const decodeBase64Url = (input: string): Uint8Array => {
  const base64 = input
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(input.length + ((4 - (input.length % 4)) % 4), "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, c => c.charCodeAt(0));
};

export class JwtAuthenticator {
  constructor(
    private readonly jwksUrl: string,
    private readonly fetcher: JwksFetcher = defaultJwksFetcher
  ) {}

  async authenticate(request: Request): Promise<Principal> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer (.+)$/);
    if (!match) throw new AuthenticationError();
    const token = match[1]!;

    const parts = token.split(".");
    if (parts.length !== 3) throw new AuthenticationError();
    const [headerB64, payloadB64, signatureB64] = parts as [
      string,
      string,
      string,
    ];

    let header: { alg?: string; kid?: string };
    let payload: { sub?: string; exp?: number; jti?: string };
    try {
      header = JSON.parse(
        new TextDecoder().decode(decodeBase64Url(headerB64))
      ) as typeof header;
      payload = JSON.parse(
        new TextDecoder().decode(decodeBase64Url(payloadB64))
      ) as typeof payload;
    } catch {
      throw new AuthenticationError();
    }

    const jwk = await this.findJwk(header.kid);

    let cryptoKey: CryptoKey;
    try {
      cryptoKey = await crypto.subtle.importKey(
        "jwk",
        jwk as JsonWebKey,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"]
      );
    } catch {
      throw new AuthenticationError();
    }

    const signedData = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signature = decodeBase64Url(signatureB64);

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      cryptoKey,
      signature,
      signedData
    );
    if (!valid) throw new AuthenticationError();

    if (!payload.exp || payload.exp < Date.now() / 1000) {
      throw new AuthenticationError();
    }
    if (!payload.sub) throw new AuthenticationError();

    return {
      userId: payload.sub,
      sessionId: payload.jti ?? crypto.randomUUID(),
    };
  }

  private async findJwk(kid: string | undefined): Promise<JwkRecord> {
    if (!jwksCache.has(this.jwksUrl)) {
      const keys = await this.fetcher(this.jwksUrl);
      jwksCache.set(this.jwksUrl, keys);
    }

    let keys = jwksCache.get(this.jwksUrl)!;
    let jwk = kid ? keys.find(k => k.kid === kid) : keys[0];

    if (!jwk && kid) {
      // Unknown kid: re-fetch the JWKS once to pick up key rotation
      const freshKeys = await this.fetcher(this.jwksUrl);
      jwksCache.set(this.jwksUrl, freshKeys);
      keys = freshKeys;
      jwk = keys.find(k => k.kid === kid);
    }

    if (!jwk) throw new AuthenticationError();
    return jwk;
  }
}

export const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};
