# Customer API local implementation handoff

- **Status:** In progress
- **Last updated:** 2026-11-11
- **Owner:** Primary implementation agent
- **Goal:** Make the customer API flow usable end to end against local Worker,
  D1, R2, and Workflow bindings, with no calls to remote Cloudflare resources,
  Clerk, Gemini, payment, or fulfillment providers.

## Guardrails

- Local development only. Do not run `wrangler ... --remote`, `cf` commands,
  preview/production smoke scripts, deployment commands, or use `.env.preview`
  / `.env.production`.
- Keep `IMAGE_PROVIDER=mock` locally. No Gemini key should be read or needed.
- Use `wrangler.local.jsonc` and the ignored local state at
  `tmp/cloudflare-spike/state`.
- Local login uses an opaque test session in local D1. Clerk integration stays
  a separate future step; local flows must not call Clerk.
- Local checkout uses a clearly labeled mock payment path. Never create a real
  payment, send an order to a printer, or imply that a mock order is paid by an
  external provider.
- Keep all HTTP endpoints in the existing pipeline Worker. Do not create a
  Worker per route or per image.
- Preserve existing user changes and avoid unrelated cleanup. The repository
  currently has broad uncommitted work.

## Current architecture and findings

- The deployed Worker route handler is `apps/pipeline-cloudflare/src/api/router.ts`;
  domain methods and idempotency are in `src/api/pipelineApi.ts`.
- The main `wrangler.jsonc` preview environment points to remote resources and
  must not be used for this task. The top-level config's `wrangler dev` bindings
  are local, but it still declares the image Container.
- Use `pnpm --filter pipeline-cloudflare dev`, which selects
  `wrangler.local.jsonc`; it omits the image Container binding so mock runs
  don't build or download the Container image. `dev:full` uses the main config
  and may need Docker Hub/npm access; don't use it for the offline local path.
- A first startup attempt with the main config began pulling the image base and
  package dependencies from Docker Hub/npm. It was interrupted before the
  Worker started. No Cloudflare remote D1/R2/Workflow resources or AI/payment
  providers were accessed. The local config and smoke command now avoid that
  Container build path.
- The API requires an opaque bearer session in D1. `local:session` seeds one
  without storing the raw token; `smoke:local` creates its own ephemeral
  session internally.
- Run creation returns a signed R2 URL outside local mode. The local config
  instead returns an authenticated Worker upload URL; that route validates the
  upload and writes through the local R2 binding.
- `ProductionBookRunWorkflow` selects `LocalMockImageProcessor` when
  `LOCAL_CUSTOMER_API=true` and the provider is `mock`. It copies mock SVG
  candidates and writes deterministic QA data through local R2. Other modes
  use `ContainerImageProcessor`.
- Mock generation already creates deterministic SVG candidates and deterministic
  Style QA scores in `src/wp5/bookRun.ts`. Preserve this behavior for local runs.
- Local artifact access checks book ownership and streams the artifact through
  the Worker; it does not expose the local bucket publicly. Non-local access
  retains the signed R2 URL path.
- The OpenAPI target contract and component map are
  [`customer-api.openapi.yaml`](./customer-api.openapi.yaml),
  [`customer-api-contract.md`](./customer-api-contract.md), and
  [`customer-screen-api-map.yaml`](./customer-screen-api-map.yaml). Update the
  operation statuses in the YAML map as endpoints become locally usable.

## Progress checklist

### Local runtime and safety

- [x] Add a documented local-only session seeding command and sample token
      handling; store only the token digest in local D1.
- [x] Add a local Worker-mediated upload path that validates the authenticated
      owner and upload intent, then writes to the local R2 binding.
- [x] Add a local mock image processor using local R2 bindings; bypass Containers
      in local mock mode.
- [x] Add local owner-authorized artifact reads so previews do not use remote
      signed URLs.
- [x] Add explicit local runtime configuration and checks that prevent the mock
      routes from being enabled in preview/production configuration.
- [ ] Add a local mock checkout completion path and order status, with a clear
      `mock` state that cannot be mistaken for real payment/fulfillment.
- [x] Add one local-only smoke command that exercises the flow without network
      calls to providers or remote Cloudflare resources.
- [x] Make the smoke command emit timestamped MP4, HTML, and JSON evidence that
      clearly labels the run as synthetic data with the mock provider.

### Customer API operations

- [ ] `GET /v1/books` — owner-scoped camelCase book summaries with current run
      and order summaries.
- [ ] `POST /v1/books` — create an idempotent draft with title, child name, and
      age.
- [ ] `PATCH /v1/books/{bookId}` — update owner-scoped draft details.
- [x] `GET /v1/books/{bookId}/runs` — existing route; verify local behavior.
- [x] `POST /v1/books/{bookId}/runs` — create pages and local upload intents;
      keep customer photo count rules consistent with the UI (5–10).
- [x] `PATCH /v1/books/{bookId}/runs/{runId}/photo-order` — persist exact photo
      order before start.
- [x] `POST /v1/books/{bookId}/runs/{runId}/start` — local Workflow binding
      completes a mock run through the running Worker.
- [ ] `GET /v1/books/{bookId}/runs/{runId}` — owner-scoped camelCase nested
      pages/candidates/QA/review response.
- [x] `POST /v1/books/{bookId}/runs/{runId}/upload-intents/{uploadIntentId}/refresh`
      — issue a local upload URL for an existing pending intent.
- [x] `POST /v1/books/{bookId}/pages/{pageId}/reviews` — existing route; local
      tests and flow must cover `changes_requested` notes.
- [x] `POST /v1/books/{bookId}/pages/{pageId}/regenerations` — existing route;
      keep repair feedback and mock workflow local.
- [x] `GET /v1/artifacts/{artifactId}/access` — existing endpoint; local mode
      must return owner-authorized local access rather than an R2 S3 URL.
- [x] `GET /v1/catalog/editions` — local sample catalog, explicitly marked
      illustrative until prices and fulfillment are approved.
- [ ] `POST /v1/books/{bookId}/orders` — create a local mock order/checkout.
- [ ] `GET /v1/orders/{orderId}` — read local mock order status.

### Contract and client

- [ ] Keep `docs/customer-api.openapi.yaml` aligned with implemented local
      request/response shapes and status codes.
- [x] Update `docs/customer-screen-api-map.yaml` operation status and local
      upload/artifact behavior.
- [ ] Connect React Query hooks to the local API only after API response shapes
      stabilize. Do not make presentational screen components call `fetch`.
- [x] Document local session and smoke commands plus mock-only limitations in
      this handoff and the API contract.

## Endpoint subagent assignments

Subagents are asked to work on one endpoint operation each, in separate new
service/test files. They must not edit `router.ts`, `pipelineApi.ts`, shared
migrations, the handoff checklist, or any Wrangler environment. The primary
agent integrates their helpers and updates this checklist.

- [x] `GET /v1/catalog/editions` — local sample catalog helper added and
      wired to the route; focused test passed. Entries are unavailable and
      prototype-only.
- [x] `PATCH /v1/books/{bookId}/runs/{runId}/photo-order` — owner-scoped,
      idempotent photo-order operation helper, wired to the route and covered
      by local D1 tests.
- [x] `POST /v1/books/{bookId}/runs/{runId}/upload-intents/{uploadIntentId}/refresh`
      — owner-scoped local upload-intent refresh helper, wired to the route and
      covered by local tests.

The local customer API test also creates a five-photo run, uploads bytes to
local R2 through the API, changes photo order, refreshes an intent, starts the
run, and reads the source artifact through owner-authorized local access. The
mock image processor test completes a page through both QA stages using local
R2 only. `pnpm --filter pipeline-cloudflare smoke:local` also passed against a
running local Worker: it created five photos, uploaded and reordered them,
completed the mock Workflow, read a private candidate artifact, and loaded the
prototype edition catalog. It confirmed the `mock` provider and no remote
services used. The command now writes an 18-second run-summary MP4 with HTML
and JSON reports under `artifacts/smoke/<timestamp>/`. The MP4 summarizes the
actual run result; it is not a screen recording.

## Local verification plan

Use `pnpm --filter pipeline-cloudflare dev`, then run
`pnpm --filter pipeline-cloudflare smoke:local`. Both use explicit local D1/R2
state and the `mock` provider. The smoke creates a session internally and tests
books → upload → photo order → mock generation/QA → private artifact read →
prototype editions, then writes the timestamped video and provenance reports.
Follow-up coverage should add mock checkout, reviewer
repair in the HTTP smoke, and explicit HTTP rejection checks for missing or
cross-owner credentials.

Local auth setup is now available with
`pnpm --filter pipeline-cloudflare local:session`; it applies migrations to
local D1 and prints a new bearer token once. The current API still needs a
local mock order implementation and customer-facing HTTP review/repair smoke
coverage before the broader customer journey is complete.

## Handoff notes

When resuming in a new session, read this file first, then inspect
`git status --short` before editing. Do not assume that the previous worker
session or any local server is still running. Update the checklist as each
endpoint or local capability becomes complete, and leave failed items checked
only when their local verification has passed.
