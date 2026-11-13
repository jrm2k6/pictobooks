---
status: accepted
---

# Run image processing in a stateless Container data plane

## Decision

The existing Node and Sharp workload does not belong in the Worker control plane. We decided that Containers receive operation and artifact identifiers, read and write image bytes directly through R2’s S3-compatible API, and return metadata; Container-local files and memory are disposable. This refines the execution boundary in [ADR 0002](./0002-cloudflare-production-platform.md).

## Outcome

The image Container is a stateless data-plane worker. Its HTTP requests contain
operation and Artifact identifiers, R2 object keys, and the expected source
SHA-256; image bytes never travel through the Worker or Durable Object. The
Container reads the source through R2's S3-compatible API, writes an immutable
output, verifies ownership metadata, and only then returns Artifact metadata.

The entrypoint supports:

| Endpoint                   | Durable output   | Reference behavior                         |
| -------------------------- | ---------------- | ------------------------------------------ |
| `/v1/operations/normalize` | PNG Artifact     | rotate, fit within 2480×3508, remove alpha |
| `/v1/operations/cleanup`   | PNG Artifact     | flatten white, grayscale, threshold at 220 |
| `/v1/operations/print-qa`  | JSON QA Artifact | existing deterministic print metrics       |

All three use schema version `2026-11-08`. The operation contract is deliberately
small: `operationId`, input Artifact identity/key/checksum, and output Artifact
identity/key. The S3 Adapter is the only module that knows R2 credentials or AWS
SDK types.

## Replay and crash behavior

R2 is authoritative; neither the Container filesystem nor Durable Object memory
is authoritative.

1. The operation checks the output key first.
2. A matching output is returned as `reused` without reprocessing the source.
3. A missing output is calculated and written with `If-None-Match: *`.
4. If another invocation wins the conditional write, the loser verifies and
   reuses that object.
5. An object at the same key with different operation, source, checksum, or
   Artifact metadata is a conflict; it is never overwritten.

This also covers a process crash after R2 accepts the output but before the HTTP
response reaches the Workflow. A replay finds the durable object and returns it.
The test suite simulates this exact boundary.

R2 conditional writes and strong consistency are documented by Cloudflare:

- <https://developers.cloudflare.com/r2/api/s3/extensions/>
- <https://developers.cloudflare.com/r2/reference/consistency/>

## Credentials and Container configuration

The Durable Object starts the Container with outbound internet enabled and
injects these values into the process:

- `R2_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `R2_BUCKET=<environment-specific-private-bucket>`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Use an R2 S3 token scoped to object read/write on exactly one environment bucket.
Do not use an account-wide token and do not place credentials in `wrangler.jsonc`
or a committed env file. Cloudflare's S3 endpoint uses region `auto`:
<https://developers.cloudflare.com/r2/get-started/s3/>.

The Worker verifies that returned metadata matches the requested operation and
that the output is visible through its R2 binding before it commits D1 state.

## Testing from a developer machine

There are three distinct levels; calling all of them “preview” hides important
safety differences.

### 1. Local deterministic tests

Run without Cloudflare or credentials:

```bash
pnpm --filter pipeline-image-worker test
```

The seven tests cover normalization parity, cleanup parity, Print QA parity,
replay, immutable-key conflicts, source integrity, and a simulated crash after
the durable write.

### 2. Isolated remote preview/staging smoke

Use a deployed non-production Worker whose R2 binding and injected S3 token both
target the same dedicated preview bucket. Enable the endpoint with two Worker
secrets/variables:

- `SMOKE_TESTS_ENABLED=true`
- `SMOKE_TEST_TOKEN=<random high-entropy value>`

Copy the committed template once and fill in the URL and token:

```bash
cp apps/pipeline-cloudflare/.env.preview.example \
  apps/pipeline-cloudflare/.env.preview
```

Then run; the package script loads `.env.preview` automatically:

```bash
pnpm --filter pipeline-cloudflare smoke:preview -- \
  --input samples/book-001-happy-path/portrait-1.jpeg \
  --output tmp/wp4-preview-normalized.png
```

If Cloudflare Access protects the host, also set
`PICTOBOOK_PREVIEW_ACCESS_CLIENT_ID` and
`PICTOBOOK_PREVIEW_ACCESS_CLIENT_SECRET`.

The endpoint writes under a random `smoke/image-normalize/` prefix, invokes the
same operation twice, requires the replay to return `reused`, verifies the R2
output, optionally downloads the verified PNG to `--output`, and deletes both
remote test objects in `finally`. It does not invoke an image provider and
therefore cannot incur Nano Banana charges.

Worker Preview automatically isolates Container apps and Durable Object
namespaces, but D1 and R2 are only isolated when the preview bindings target
separate resources. Workflows also require a dedicated non-production binding.
For the full WP5 Book Run test, use a persistent staging environment with its own
D1, R2, Workflow, S3 token, and budgets rather than an ephemeral Worker Preview.
See <https://developers.cloudflare.com/workers/previews/resources/>.

### 3. Production infrastructure smoke

Production is disabled unless `SMOKE_TESTS_ENABLED` and `SMOKE_TEST_TOKEN` are
explicitly configured there. Use only a synthetic/non-customer image. The CLI
also requires an exact confirmation string:

```bash
cp apps/pipeline-cloudflare/.env.production.example \
  apps/pipeline-cloudflare/.env.production

pnpm --filter pipeline-cloudflare smoke:production -- \
  --input test/fixtures/synthetic-photo.png \
  --confirm-production pictobook-production
```

This is an infrastructure smoke, not a customer Book Run. After WP5, add a
separate staging-only full-run smoke with a provider cost cap, one page, bounded
repair attempts, and a unique test tenant. Production provider calls should not
be part of the routine WP4 smoke.

## Acceptance evidence

- Container state is disposable; all authoritative inputs and outputs are R2
  Artifacts.
- Requests contain identifiers and checksums, not embedded images.
- Outputs are durably and conditionally written before metadata is returned.
- Replays cannot overwrite or diverge an existing output.
- Crash-after-write recovery is tested.
- Normalization, cleanup, and Print QA match the local reference implementation.
- Root `ci:check` runs the Container tests in addition to formatting, linting,
  Worker tests, type checks, and a deployment dry run.
