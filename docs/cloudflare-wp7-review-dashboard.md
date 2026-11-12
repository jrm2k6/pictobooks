# WP7: Cloudflare review dashboard

Status: Complete
Last updated: 2026-11-10

## Delivered

- Added owner-scoped API reads for book lists, Book Runs, Canonical References,
  and run details including photos, artifacts, and human reviews.
- Added a desktop-only local reviewer dashboard backed by the authenticated
  Worker API. The local Node process keeps the bearer token, proxies commands,
  and streams short-lived signed artifact downloads without returning signed
  URLs to the browser.
- Connected the dashboard to the dedicated `preview` Wrangler environment and
  deployed Worker version `c7dabb05-fbe6-4394-87e0-79d07f928bf3`.
- Added explicit approval and rejection confirmations, exact-candidate review,
  separate Print QA and Style QA, original source and page brief access, repair
  lineage, regeneration, and Canonical Reference promotion.
- Added deterministic synthetic browser fixtures and a static visual review
  gallery with 14 desktop screenshots.

## Run the dashboard

From the repository root:

```sh
pnpm --filter pipeline dashboard:cloudflare:preview
```

This reads the ignored `apps/pipeline-cloudflare/.env.preview` file and serves
the reviewer UI at `http://127.0.0.1:4180`. The token remains in the local Node
server. To use another authorized API session, set `PICTOBOOK_API_BASE_URL` and
`PICTOBOOK_API_TOKEN` in `apps/pipeline/.env.development`, then run:

```sh
pnpm --filter pipeline dashboard:cloudflare
```

The server binds only to loopback. Do not expose it through a tunnel or public
host. Preview Worker requests use the owner-scoped API; the dashboard cannot
access a book that the authenticated user does not own.

## Screens and actions

The review flow is Books → Book Runs → Run overview → Page review. Run overview
shows mixed page outcomes, QA status, cost, and terminal reasons. The page
review screen selects the approved Candidate first, shows the source photo and
repair round, and exposes the page brief when one exists. Review submissions
use a generated idempotency key and refresh from D1 after success.

Regeneration is submitted to the existing bounded API workflow and links the
new run to the original Page and photo. The current API does not yet add Style
QA findings or reviewer notes to the image generation request; the dashboard
states this limitation in the confirmation dialog. Canonical promotion is
available after page approval. Repeat review or promotion requests are
protected by the API's idempotency handling.

## Validation

- `pnpm --filter pipeline-cloudflare check` passed.
- Node syntax checks passed for the local dashboard server, browser fixtures,
  and extracted inline dashboard script.
- Wrangler preview dry run packaged the preview bindings successfully.
- Deployed only the dedicated `preview` environment. The deployed API returned
  two owned books; listing and loading runs returned two runs, one page, five
  candidates, one photo, 20 artifacts, and zero human reviews in the selected
  synthetic preview run.
- The local proxy streamed a private candidate PNG from R2 successfully with
  `200 image/png`; the signed URL stayed on the server.
- Captured and visually inspected deterministic fixture screenshots at
  1440 × 1250. No customer imagery or credentials are included in the gallery.
- No test suite was run as part of WP7.

## Scope limits

- This is a local reviewer dashboard, not a deployed end-user interface.
- Creating Books, uploading photos, and starting first-generation runs remain
  outside the review dashboard.
- The Storybook-style gallery is a static visual review tool, not an interactive
  component framework.
- Human review and canonical promotion were validated through the UI states and
  already implemented Worker routes; the gallery itself uses fixtures and does
  not write preview data.
- Passing judge findings and reviewer notes into the real image provider remains
  follow-up work; the current preview generation profile is synthetic.

See the [WP7 visual review gallery](./ui-review/wp7/index.html) and
[gallery notes](./ui-review/wp7/README.md).
