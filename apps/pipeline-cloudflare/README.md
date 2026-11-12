# Pipeline Cloudflare Spike

This Worker validates the production control-plane shape with local and remote D1/R2 resources plus a locally emulated Workflow. It is deliberately separate from `apps/functions`, which continues to serve the waitlist.

## Local development

Apply the local migration and start the Worker:

```bash
pnpm --filter pipeline-cloudflare exec wrangler d1 migrations apply \
  pictobook-pipeline-spike-dev --local \
  --persist-to ../../tmp/cloudflare-spike/state

pnpm --filter pipeline-cloudflare dev
```

Local state is persisted under the repository's ignored `tmp/cloudflare-spike/` directory. Local D1, R2, and Workflow data are isolated from their remote counterparts.

The productionized WP4 Container reads and writes R2 directly through its S3
endpoint. The old standalone Docker command no longer exercises the real
boundary because it has no object store shared with the Worker's locally emulated
R2 binding. Use the credential-free Container tests locally, then the isolated
remote smoke documented in the
[WP4 report](../../docs/cloudflare-wp4-node-image-container.md). Do not point a
local Worker at a production bucket.

## Production state-model tests

WP2 keeps the WP0 tables under `spike_*` names and adds the production pipeline
schema. Verify empty-database migration, upgrade from WP0, state constraints,
and object keys without touching remote resources:

```bash
pnpm --filter pipeline-cloudflare test
```

See [the WP2 state-model report](../../docs/cloudflare-wp2-state-model.md) for
the enforced invariants and schema boundaries.
The [D1 schema reference](../../docs/cloudflare-d1-schema.md) documents every
table, relationship, Page state, and end-to-end data flow.

WP3's R2 Artifact Adapter is covered by the same test command. The tests run
against isolated local Worker-runtime R2 and D1 bindings; they do not access the
remote development bucket or database. See the
[WP3 storage report](../../docs/cloudflare-wp3-r2-artifact-storage.md).

WP4's Node Container tests cover normalize/cleanup/Print QA equivalence,
immutable replays, and crash recovery:

```bash
pnpm --filter pipeline-image-worker test
```

The [WP4 report](../../docs/cloudflare-wp4-node-image-container.md) also defines
the guarded local-to-preview and explicit production infrastructure smoke flow.

## WP5 Book Run Workflow

Run the D1/R2-isolated orchestration and replay tests locally with the package
test command above. To exercise the deployed preview Workflow, mock provider,
R2/D1 state, and image Container end to end:

```bash
pnpm --filter pipeline-cloudflare smoke:book-run:preview -- \
  --pages 1 \
  --profile mock_pass_after_repair
```

The smoke command reads the ignored `.env.preview` file. It creates only
synthetic data in the dedicated preview resources. See the
[WP5 report](../../docs/cloudflare-wp5-book-run-workflow.md) for replay,
automatic approval, repair, and budget semantics.

## WP6 authenticated API

The `/v1` routes use hashed opaque sessions, owner authorization, and mandatory
idempotency keys for mutations. The preview proof creates a Book and Run,
uploads directly through a short-lived R2 URL, starts and reviews the Run,
promotes a canonical reference, requests private Artifact access, and launches
a versioned regeneration:

```bash
pnpm --filter pipeline-cloudflare smoke:api:preview
```

The preview smoke session is test-only. Session issuance for real accounts will
be owned by the eventual identity provider. See the
[WP6 report](../../docs/cloudflare-wp6-authenticated-api.md) for the route and
security contracts.

## WP8 Gemini image generation and Style QA

Production book runs use Nano Banana 2.1 (`gemini-nano-banana-2.1`) for
candidate images and a Gemini Flash vision model for Style QA. The Worker first
normalizes the source photo to PNG, then provides the image provider with the
source, the style bible stored in R2, and up to two approved canonical
references. Gemini Style QA scores line weight, facial vocabulary, detail
density, proportions, background restraint, and coloring-area size. Failed
scores produce findings and a correction prompt that are passed into bounded
automatic repair attempts.

Source-based regeneration stores a snapshot of the original page's QA results
and reviewer notes in `book_run_regenerations.feedback_json`; the workflow sends
that feedback to the image provider. The snapshot keeps the regeneration
reproducible if the source page receives later reviews.

Preview is configured for Gemini, but the API rejects new runs until the key
exists. First apply the new migrations to preview D1, then add the key. Wrangler
deploys a new Worker version immediately when `secret put` succeeds:

```bash
pnpm --filter pipeline-cloudflare exec wrangler d1 migrations apply \
  PIPELINE_DB --remote --env preview
pnpm --filter pipeline-cloudflare exec wrangler secret put GEMINI_API_KEY \
  --env preview
```

Wrangler prompts for the key; enter it there rather than in a shell command or
chat. `GEMINI_IMAGE_MODEL`, `GEMINI_VISION_MODEL`, and candidate cost estimates
are configured in `wrangler.jsonc`. The configured image model is Nano Banana
2.1, matching the local pipeline. Its 2K image output is listed at $0.0504;
text and image input tokens are billed separately. The current budget estimates
are 65,000 micros per generated candidate and 10,000 micros per Style QA. These
are conservative budget estimates, not provider-reported invoice amounts. The
default per-page ceiling covers the initial three candidates and the four
candidates allowed by two repair rounds. Adjust the estimates if the model,
resolution, or Google pricing changes. See [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

The API key must be present and both cost estimates must be positive before an
authenticated run can be created with `IMAGE_PROVIDER=gemini`. Existing runs
keep the provider/model and cost estimates captured when they were created.

## Preview resources

- Worker: `pictobook-pipeline-spike-dev-preview`
- D1: `pictobook-pipeline-preview`
- R2: `pictobook-pipeline-preview`
- Workflow: `pictobook-production-book-run-preview`

The synthetic endpoints are test-only and protected by a dedicated smoke token.
They are not the authenticated customer API planned for WP6.
