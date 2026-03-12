import {
  WAITLIST_ENDPOINT,
  type WaitlistSignupRequest,
  type WaitlistSignupResponse,
} from "../../../packages/shared/src/waitlist";

type Env = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TURNSTILE_SECRET: string;
  ALLOWED_ORIGIN: string;
  IP_HASH_SALT: string;
  WAITLIST_RATE_LIMIT: KVNamespace;
};

type KVNamespace = {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: {
      expirationTtl?: number;
    }
  ) => Promise<void>;
};

type RateLimitState = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = 5;

const corsHeaders = (origin: string) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  Vary: "Origin",
});

const json = (
  status: number,
  body: WaitlistSignupResponse,
  origin: string
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
    },
  });

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const isValidEmail = (value: string): boolean => {
  // Lightweight validation is enough here; provider-level validation is not required for waitlist capture.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

const getIp = (request: Request): string => {
  const cfIp = request.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return "unknown";
};

const sha256 = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hash = Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return hash;
};

const verifyTurnstile = async (
  token: string,
  ip: string,
  env: Env
): Promise<boolean> => {
  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET,
    response: token,
    remoteip: ip,
  });

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    }
  );

  if (!response.ok) return false;

  const payload = (await response.json()) as { success?: boolean };
  return payload.success === true;
};

const checkRateLimit = async (key: string, env: Env): Promise<boolean> => {
  const now = Date.now();
  const raw = await env.WAITLIST_RATE_LIMIT.get(key);
  const state = raw ? (JSON.parse(raw) as RateLimitState) : null;

  if (!state || now >= state.resetAt) {
    const nextState: RateLimitState = {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    };
    await env.WAITLIST_RATE_LIMIT.put(key, JSON.stringify(nextState), {
      expirationTtl: Math.ceil(RATE_LIMIT_WINDOW_MS / 1000),
    });
    return true;
  }

  if (state.count >= RATE_LIMIT_MAX) {
    return false;
  }

  state.count += 1;
  await env.WAITLIST_RATE_LIMIT.put(key, JSON.stringify(state), {
    expirationTtl: Math.ceil((state.resetAt - now) / 1000),
  });

  return true;
};

const upsertWaitlist = async (
  payload: WaitlistSignupRequest,
  emailNormalized: string,
  ipHash: string,
  userAgent: string,
  env: Env
): Promise<"created" | "updated"> => {
  const existingResponse = await fetch(
    `${env.SUPABASE_URL}/rest/v1/waitlist_signups?email_normalized=eq.${encodeURIComponent(emailNormalized)}&select=signup_count`,
    {
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    }
  );
  if (!existingResponse.ok) {
    throw new Error(
      `Supabase read failed with status ${existingResponse.status}`
    );
  }
  const existingRows = (await existingResponse.json()) as Array<{
    signup_count: number;
  }>;
  const existingCount = existingRows[0]?.signup_count ?? 0;

  const url = new URL(`${env.SUPABASE_URL}/rest/v1/waitlist_signups`);
  url.searchParams.set("on_conflict", "email_normalized");

  const upsertPayload = {
    email: payload.email,
    email_normalized: emailNormalized,
    source: payload.source ?? null,
    campaign: payload.campaign ?? null,
    page: payload.page ?? null,
    signup_count: existingCount + 1,
    ip_hash: ipHash,
    user_agent: userAgent,
    last_seen_at: new Date().toISOString(),
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(upsertPayload),
  });

  if (!response.ok) {
    throw new Error(`Supabase upsert failed with status ${response.status}`);
  }

  return existingCount > 0 ? "updated" : "created";
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("origin") ?? "";
    const allowedOrigin = env.ALLOWED_ORIGIN;

    if (request.method === "OPTIONS") {
      if (origin !== allowedOrigin) {
        return new Response(null, { status: 403 });
      }

      return new Response(null, {
        status: 204,
        headers: corsHeaders(allowedOrigin),
      });
    }

    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== WAITLIST_ENDPOINT
    ) {
      return new Response("Not found", { status: 404 });
    }

    if (origin !== allowedOrigin) {
      return json(
        403,
        {
          ok: false,
          code: "forbidden_origin",
          message: "Origin is not allowed.",
        },
        allowedOrigin
      );
    }

    let body: WaitlistSignupRequest;
    try {
      body = (await request.json()) as WaitlistSignupRequest;
    } catch {
      return json(
        400,
        { ok: false, code: "invalid_json", message: "Invalid request body." },
        allowedOrigin
      );
    }

    const emailNormalized = normalizeEmail(body.email ?? "");
    if (!emailNormalized || !isValidEmail(emailNormalized)) {
      return json(
        400,
        {
          ok: false,
          code: "invalid_email",
          message: "Please provide a valid email.",
        },
        allowedOrigin
      );
    }

    if (!body.turnstileToken) {
      return json(
        400,
        {
          ok: false,
          code: "missing_turnstile",
          message: "Turnstile verification is required.",
        },
        allowedOrigin
      );
    }

    const ip = getIp(request);
    const ipHash = await sha256(`${env.IP_HASH_SALT}:${ip}`);
    const rateLimitOk = await checkRateLimit(`waitlist:${ipHash}`, env);
    if (!rateLimitOk) {
      return json(
        429,
        {
          ok: false,
          code: "rate_limited",
          message: "Too many attempts. Try again later.",
        },
        allowedOrigin
      );
    }

    const turnstileOk = await verifyTurnstile(body.turnstileToken, ip, env);
    if (!turnstileOk) {
      return json(
        403,
        {
          ok: false,
          code: "turnstile_failed",
          message: "Verification failed. Please try again.",
        },
        allowedOrigin
      );
    }

    const userAgent = request.headers.get("user-agent") ?? "unknown";

    try {
      const status = await upsertWaitlist(
        {
          ...body,
          email: emailNormalized,
        },
        emailNormalized,
        ipHash,
        userAgent,
        env
      );

      const statusCode = status === "created" ? 201 : 200;
      return json(statusCode, { ok: true, status }, allowedOrigin);
    } catch {
      return json(
        500,
        {
          ok: false,
          code: "internal_error",
          message: "Could not process signup.",
        },
        allowedOrigin
      );
    }
  },
};
