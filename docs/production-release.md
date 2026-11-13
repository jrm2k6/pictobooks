# Production release runbook

This runbook covers the Cloudflare resources used by
[`scripts/release-prod.sh`](../scripts/release-prod.sh). Resource names and IDs
are configuration, not credentials; keep them in `wrangler.production.jsonc`.
Keep API keys and R2 S3 credentials in Wrangler Worker secrets only.

## Current production resources

| Resource                   | Name / value                    |
| -------------------------- | ------------------------------- |
| Pipeline Worker            | `pictobook-pipeline-production` |
| Pipeline D1                | `pictobook-pipeline-production` |
| Pipeline R2 bucket         | `pictobook-pipeline-production` |
| Marketing Pages project    | `pictobooks`                    |
| Customer app Pages project | `pictobook-app`                 |
| Customer app URL           | `https://studio.pictobook.app`  |

The production Worker configuration is
[`apps/pipeline-cloudflare/wrangler.production.jsonc`](../apps/pipeline-cloudflare/wrangler.production.jsonc).
It uses the production D1 ID and bucket binding, and contains no secret values.
The `.example` file documents the required shape for a separate account.

The app Pages project must have `main` set as its production branch and
`studio.pictobook.app` attached as a custom domain. Keep the Pages project
domain association in Cloudflare; a DNS CNAME by itself is not sufficient.

## Worker secrets

The Worker requires these secrets:

- `GEMINI_API_KEY`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

Create an R2 API token restricted to Object Read & Write on the production
bucket. Add all values interactively so they do not enter shell history:

```sh
./apps/pipeline-cloudflare/node_modules/.bin/wrangler \
  --cwd apps/pipeline-cloudflare \
  --config wrangler.production.jsonc secret put GEMINI_API_KEY

./apps/pipeline-cloudflare/node_modules/.bin/wrangler \
  --cwd apps/pipeline-cloudflare \
  --config wrangler.production.jsonc secret put R2_ACCESS_KEY_ID

./apps/pipeline-cloudflare/node_modules/.bin/wrangler \
  --cwd apps/pipeline-cloudflare \
  --config wrangler.production.jsonc secret put R2_SECRET_ACCESS_KEY
```

The release script checks for the secret names without printing secret values.
Updating a Worker secret deploys a Worker version, so make secret changes as a
reviewed production operation.

## Release procedure

1. Merge the reviewed release PR to `main` and wait for the automatic GitHub
   Release workflow to create a version tag.
2. Update a clean local `main` checkout to that tagged commit.
3. Review the release targets and run `scripts/release-prod.sh --dry-run`.
4. Run `scripts/release-prod.sh`, choose `all` or a single `--target`, and type
   `deploy to production` when its target summary is correct.

For `pipeline`, the script first applies unapplied D1 migrations remotely, then
deploys the Worker. It checks the production config for placeholders and
development or preview resource references, and checks that the required Worker
secrets exist before asking for confirmation.

The app's current login page is a front-end placeholder; authentication and
customer API integration are separate implementation work. The production
pipeline uses Gemini and the configured bounded candidate count. Keep synthetic
smoke endpoints disabled in production.
