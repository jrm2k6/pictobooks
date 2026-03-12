# Pictobook Functions

Cloudflare Worker for backend endpoints used by the landing page.

Database schema migrations are managed at the repo root with dbmate (`db/migrations`).

## Waitlist endpoint

- Route: `POST /api/waitlist`
- Payload: `{ email, turnstileToken, source?, campaign?, page? }`
- Behavior:
  - Validates email
  - Verifies Turnstile token server-side
  - Applies IP-based rate limiting (KV)
  - Upserts into Supabase `waitlist_signups`

## Environment variables

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TURNSTILE_SECRET`
- `ALLOWED_ORIGIN`
- `IP_HASH_SALT`

## Local dev

```bash
# One-time local setup
cp apps/functions/.dev.vars.example apps/functions/.dev.vars

# Start worker
pnpm --filter functions dev
```

Local Worker env loading notes:

- `wrangler dev` reads secrets/vars from `apps/functions/.dev.vars`.

You also need a KV namespace bound as `WAITLIST_RATE_LIMIT` in `wrangler.toml`.
