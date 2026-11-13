# Pictobook

Pictobook turns family photos into personalized coloring books for kids ages
3–12. This repository is a pnpm monorepo containing the marketing site, a
customer-app prototype, a local image-generation pipeline, and its Cloudflare
service implementation.

## Get started

### Requirements

- Git
- Node.js 22 (the CI workflow uses Node 22)
- Corepack, included with the Node.js 22 distribution
- Docker only for building or packaging the Cloudflare image Container
- `ffmpeg` is optional; the local smoke script uses it to make an MP4 on macOS

### Install

Clone the repository, then install its dependencies:

```sh
git clone https://github.com/jrm2k6/pictobooks.git
cd pictobooks
corepack enable pnpm
pnpm --version
pnpm install --frozen-lockfile
```

The root `package.json` pins pnpm 10.4.1 through its `packageManager` field.
Corepack uses that pin when running pnpm from this repository. See the
[Node.js Corepack guide](https://nodejs.org/api/corepack.html) if Corepack is
not available on your machine.

### Run an app

Start the landing page:

```sh
pnpm --filter landing dev
```

Open <http://localhost:3000>.

Start the customer-app storybook prototype:

```sh
pnpm --filter web dev
```

Open <http://127.0.0.1:4176>. The prototype uses sample data and is not yet
connected to the customer API.

To browse the API contract in Swagger UI, start a second process:

```sh
pnpm --filter web api-docs
```

Open <http://127.0.0.1:4177/customer-api.html>. The OpenAPI document describes
the planned customer journey; some operations are not implemented yet.

## Monorepo layout

`pnpm-workspace.yaml` includes every directory under `apps/` and `packages/`.
Run commands from the repository root and select a workspace by its package
name with `pnpm --filter <package> <command>`.

| Path                         | Responsibility                                                                 | Current state                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `apps/landing`               | React/Vite marketing site                                                      | Local development and static build                                                    |
| `apps/functions`             | Cloudflare Worker for landing-page waitlist endpoints                          | Separate from the image pipeline; local secrets and a KV binding are needed to run it |
| `apps/web`                   | React customer app using TanStack Router and TanStack Query                     | Branded login in production; screen prototype/storybook is local-only                 |
| `apps/pipeline`              | Node image pipeline, provider adapters, QA, repair, and local review dashboard | Runs locally with a mock provider or Gemini                                           |
| `apps/pipeline-cloudflare`   | Worker API, D1/R2 storage, and durable Book Run Workflows                      | Local and preview configurations; preview uses remote Cloudflare resources            |
| `apps/pipeline-image-worker` | Node/Sharp image operations used by the Cloudflare Container                   | Tested locally; Container packaging requires Docker                                   |
| `packages/shared`            | Shared code used by workspace apps                                             | Currently supports the landing app                                                    |
| `apps/api`                   | Reserved API placeholder                                                       | No active app yet                                                                     |
| `db`                         | dbmate migrations for the existing waitlist database                           | Requires a configured PostgreSQL connection to apply                                  |

The API routes live in the pipeline Worker; there is not a Worker per endpoint
or picture. The separate image worker is compute invoked by the pipeline, not a
public API. See the [architecture decisions](docs/adr/) and
[D1 schema and state flow](docs/cloudflare-d1-schema.md).

## Local image pipeline

Install dependencies first. Tests use local fixtures and the mock provider; no
provider credentials or Cloudflare account are needed:

```sh
pnpm --filter pipeline test
pnpm --filter pipeline build
```

For a local mock run, put your input photos in an ignored folder under
`samples/`, then run:

```sh
pnpm --filter pipeline prototype -- \
  --input-dir samples/my-book \
  --out tmp/my-book \
  --provider mock
```

The mock provider creates deterministic placeholder art, not AI-generated
images. To use Gemini locally, create the ignored environment file and set
`PICTOBOOK_PIPELINE_PROVIDER=gemini` and `GEMINI_API_KEY` in it:

```sh
cp apps/pipeline/.env.example apps/pipeline/.env.development
```

Then run the pipeline with `--provider gemini --env-file
apps/pipeline/.env.development`. Real provider calls can incur charges. The
[pipeline operations guide](docs/coloring-book-pipeline-operations.md) explains
inputs, canonical references, QA, bounded repair, and review.

Local photos and generated canonical-reference catalogs are private working
data. Root `samples/` and `catalog/` are ignored by Git; do not force-add them.

## Local Cloudflare API smoke test

This flow uses Wrangler's local configuration, local D1/R2/Workflow state, and
synthetic image payloads with the mock provider. It does not call remote
Cloudflare resources or an AI, payment, or fulfillment provider.

In one terminal, start the local Worker:

```sh
pnpm --filter pipeline-cloudflare dev
```

In another terminal, run the smoke test:

```sh
pnpm --filter pipeline-cloudflare smoke:local
```

The run writes JSON and HTML evidence under `artifacts/smoke/`. On macOS, the
script also writes an MP4 when `ffmpeg` is installed. Every report identifies
the data as synthetic and the provider as mock. See the
[Cloudflare app guide](apps/pipeline-cloudflare/README.md) before using preview
or production resources.

## Environment and secrets

No environment files are required for installation, builds, or the default
mock tests. Copy a checked-in example only when using the corresponding
integration:

| Example                                         | Copy to                                 | Used by                                                                 |
| ----------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `apps/landing/.env.example`                     | `apps/landing/.env.development`         | Vite landing-page variables (`VITE_*` values are public in the browser) |
| `apps/functions/.dev.vars.example`              | `apps/functions/.dev.vars`              | Local waitlist Worker secrets and variables                             |
| `apps/pipeline/.env.example`                    | `apps/pipeline/.env.development`        | Local pipeline provider and reviewer settings                           |
| `apps/pipeline-cloudflare/.env.preview.example` | `apps/pipeline-cloudflare/.env.preview` | Preview smoke-test URL and token; not the Gemini key                    |
| `.env.example`                                  | `.env.development`                      | Root backend scripts such as dbmate                                     |

The local target filenames in this table are ignored by Git. Never put secrets
in `wrangler.jsonc`, a frontend `VITE_*` variable, or a committed example. The
deployed Gemini key is a Wrangler Worker secret; Wrangler lists secret names
without revealing their values. If you add a new local env filename, verify it
is ignored before adding credentials.

## Checks

Run the checks most relevant to your changes:

```sh
pnpm format:check
pnpm lint
pnpm --filter pipeline test
pnpm --filter pipeline-cloudflare test
pnpm --filter pipeline-cloudflare check
pnpm --filter pipeline-image-worker test
pnpm --filter web build
pnpm --filter landing build
```

`pnpm ci:check` runs the repository CI checks, including Wrangler's deployment
dry run for the Container-backed Worker. That step may require Docker and
network access. GitHub Actions runs this check for pull requests.

## Documentation guide

- [Cloudflare architecture decisions](docs/adr/)
- [Cloudflare pipeline implementation plan and progress](docs/cloudflare-pipeline-implementation-plan.md)
- [Pipeline behavior and operations](docs/coloring-book-pipeline-operations.md)
- [Pictobook style bible](docs/pictobook-preschool-style-bible.md)
- [D1 tables, relationships, and state flow](docs/cloudflare-d1-schema.md)
- [Customer API contract](docs/customer-api-contract.md)
- [OpenAPI specification](docs/customer-api.openapi.yaml)
- [Customer screen-to-endpoint map](docs/customer-screen-api-map.yaml)
- [Customer UI storybook](docs/customer-product-storybook/README.md)
- [Cloudflare dashboard visual review gallery](docs/ui-review/wp7/index.html)
- [Release and versioning policy](docs/releases.md)
