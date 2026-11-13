export type Principal = { userId: string; sessionId: string };

export class AuthenticationError extends Error {
  constructor() {
    super("Authentication is required");
    this.name = "AuthenticationError";
  }
}

export class SessionAuthenticator {
  constructor(
    private readonly database: D1Database,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async authenticate(request: Request): Promise<Principal> {
    const authorization = request.headers.get("authorization") ?? "";
    const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,200})$/);
    if (!match) throw new AuthenticationError();
    const tokenHash = await sha256Hex(match[1]!);
    const session = await this.database
      .prepare(
        `SELECT session_id, user_id FROM api_sessions
         WHERE token_sha256 = ? AND revoked_at IS NULL AND expires_at > ?`
      )
      .bind(tokenHash, this.now())
      .first<{ session_id: string; user_id: string }>();
    if (!session) throw new AuthenticationError();
    return { userId: session.user_id, sessionId: session.session_id };
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
