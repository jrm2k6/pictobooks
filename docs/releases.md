# Releases

The `Release` GitHub Actions workflow creates a GitHub Release and matching Git tag whenever `main` is updated. Merging a pull request into `main` starts the workflow. The first release is `v0.1.0`.

For later releases, the workflow examines Conventional Commit subjects since the last `vMAJOR.MINOR.PATCH` tag:

- `feat:` increments the minor version.
- `fix:`, `chore:`, `docs:`, and other non-breaking commit types increment the patch version.
- A `!` before the colon or a `BREAKING CHANGE:` marker increments the major version.

The GitHub-generated release notes summarize the changes since the previous tag. The workflow has `contents: write` permission so its repository token can create the tag and release. Closely spaced merges may be grouped into one release from the latest `main` commit.

## Production deployment

Release tagging and production deployment are separate operations. A merge to
`main` creates a GitHub Release and tag; production deployment remains an
explicit manual action. Production changes must come from a reviewed and merged
pull request. Do not deploy a branch or deploy before its PR is merged.

After the GitHub Release workflow completes, update a local checkout to the
tagged `main` commit, confirm the working tree is clean, and run:

```sh
scripts/release-prod.sh --dry-run
scripts/release-prod.sh
```

The script checks that the commit is exactly `origin/main`, verifies its GitHub
Release, runs repository checks and selected builds, checks Cloudflare
authentication and required production secrets, and requires the exact
confirmation phrase `deploy to production` before deployment. Choose a single
target with `--target site`, `app`, `waitlist-worker`, or `pipeline`; the default
`all` target includes all four. `--dry-run` does not deploy or apply migrations.

The marketing Pages project `pictobooks` has Git integration. If that
integration deploys `main` automatically, avoid also selecting `site` in the
manual release script for the same commit. The customer app Pages project is
`pictobook-app`, with `studio.pictobook.app` attached to its `main` production
branch. Its current login page is a placeholder and does not provide real
authentication.

See the [production release runbook](production-release.md) for Worker, D1, R2,
and secret configuration.
