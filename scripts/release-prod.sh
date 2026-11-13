#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET="all"
DRY_RUN=false
SITE_PAGES_PROJECT="${PICTOBOOK_PAGES_PROJECT:-pictobooks}"
APP_PAGES_PROJECT="${PICTOBOOK_APP_PAGES_PROJECT:-pictobook-app}"
APP_PUBLIC_URL="${PICTOBOOK_APP_URL:-https://studio.pictobook.app}"
PRODUCTION_BRANCH="main"
PIPELINE_CONFIG="$ROOT_DIR/apps/pipeline-cloudflare/wrangler.production.jsonc"
WRANGLER="$ROOT_DIR/apps/pipeline-cloudflare/node_modules/.bin/wrangler"

usage() {
  cat <<'USAGE'
Usage: scripts/release-prod.sh [--target all|site|app|waitlist-worker|pipeline] [--dry-run]

Builds and deploys selected production targets:
  site            Marketing landing page to Cloudflare Pages
  app             React customer app to Cloudflare Pages
  waitlist-worker Landing-page waitlist Worker
  pipeline        Production D1 migrations and image-generation Worker
  all             All four targets (default)

Options:
  --target TARGET  Select production targets
  --dry-run        Run checks/builds and Wrangler dry runs; do not require main,
                   a GitHub Release, remote secrets, or deploy
  -h, --help       Show this help
USAGE
}

fail() {
  printf 'Release stopped: %s\n' "$1" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
    --target)
      (($# >= 2)) || fail "--target requires a value"
      TARGET="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
done

case "$TARGET" in
  all|site|app|waitlist-worker|pipeline) ;;
  *) fail "target must be all, site, app, waitlist-worker, or pipeline" ;;
esac

command -v git >/dev/null || fail "git is required"
command -v pnpm >/dev/null || fail "pnpm is required; see README.md for setup"
command -v node >/dev/null || fail "Node.js 22 is required"
[[ -x "$WRANGLER" ]] || fail "project Wrangler is missing; run pnpm install"

DEPLOY_SITE=false
DEPLOY_APP=false
DEPLOY_WAITLIST=false
DEPLOY_PIPELINE=false
case "$TARGET" in
  all)
    DEPLOY_SITE=true
    DEPLOY_APP=true
    DEPLOY_WAITLIST=true
    DEPLOY_PIPELINE=true
    ;;
  site) DEPLOY_SITE=true ;;
  app) DEPLOY_APP=true ;;
  waitlist-worker) DEPLOY_WAITLIST=true ;;
  pipeline) DEPLOY_PIPELINE=true ;;
esac

if [[ "$DRY_RUN" != true ]]; then
  command -v gh >/dev/null || fail "GitHub CLI (gh) is required to verify the release"
  [[ "$(git -C "$ROOT_DIR" branch --show-current)" == "main" ]] ||
    fail "run from the main branch after the release PRs have merged"
  [[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ]] ||
    fail "working tree is not clean; commit or move local changes before releasing"

  git -C "$ROOT_DIR" fetch --tags origin main
  RELEASE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  REMOTE_MAIN="$(git -C "$ROOT_DIR" rev-parse origin/main)"
  [[ "$RELEASE_COMMIT" == "$REMOTE_MAIN" ]] ||
    fail "local main is not at origin/main; update it and retry"

  RELEASE_TAG="$(git -C "$ROOT_DIR" tag --points-at "$RELEASE_COMMIT" --list 'v[0-9]*' | head -n 1)"
  [[ -n "$RELEASE_TAG" ]] ||
    fail "the automatic GitHub Release workflow has not tagged this main commit yet"
  gh release view "$RELEASE_TAG" >/dev/null ||
    fail "GitHub Release $RELEASE_TAG is not available yet"
else
  RELEASE_COMMIT="$(git -C "$ROOT_DIR" rev-parse HEAD)"
  RELEASE_TAG="dry-run"
fi

if [[ "$DEPLOY_SITE" == true ]]; then
  SITE_ENV="$ROOT_DIR/apps/landing/.env.production"
  [[ -f "$SITE_ENV" ]] ||
    fail "missing apps/landing/.env.production; copy its example and set production values"

  node --input-type=module - "$SITE_ENV" <<'NODE'
import { readFileSync } from "node:fs";

const file = process.argv[2];
const required = [
  "VITE_SITE_URL",
  "VITE_WAITLIST_API_URL",
  "VITE_TURNSTILE_SITE_KEY",
];
const values = new Map();
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (!match) continue;
  let value = match[2].trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  values.set(match[1], value);
}
for (const key of required) {
  if (!values.get(key)) {
    console.error(`Missing or empty ${key} in apps/landing/.env.production`);
    process.exitCode = 1;
  }
}
for (const key of ["VITE_SITE_URL", "VITE_WAITLIST_API_URL"]) {
  if (values.get(key) && !values.get(key).startsWith("https://")) {
    console.error(`${key} must use HTTPS for a production release`);
    process.exitCode = 1;
  }
}
NODE
fi

if [[ "$DEPLOY_PIPELINE" == true ]]; then
  [[ -f "$PIPELINE_CONFIG" ]] ||
    fail "missing production Worker config; follow docs/production-release.md to create wrangler.production.jsonc"
  grep -q '"name": "pictobook-pipeline-production"' "$PIPELINE_CONFIG" ||
    fail "production Wrangler config must name pictobook-pipeline-production"
  grep -q '"database_name": "pictobook-pipeline-production"' "$PIPELINE_CONFIG" ||
    fail "production D1 must be named pictobook-pipeline-production"
  grep -q '"bucket_name": "pictobook-pipeline-production"' "$PIPELINE_CONFIG" ||
    fail "production R2 bucket must be named pictobook-pipeline-production"
  if grep -Eq 'REPLACE_WITH_|pictobook-pipeline-preview|pictobook-pipeline-spike-dev|34d7b3b0-1006-467a-8830-c8c584da687c' "$PIPELINE_CONFIG"; then
    fail "production Wrangler config has a placeholder or references preview/development resources"
  fi
  grep -q '"IMAGE_PROVIDER": "gemini"' "$PIPELINE_CONFIG" ||
    fail "production image provider must be Gemini"
  grep -q '"LOCAL_CUSTOMER_API": "false"' "$PIPELINE_CONFIG" ||
    fail "production config must disable local customer API mode"
  grep -q '"SMOKE_TESTS_ENABLED": "false"' "$PIPELINE_CONFIG" ||
    fail "production config must disable synthetic smoke endpoints"
fi

printf 'Checking release %s (%s)\n' "$RELEASE_TAG" "$RELEASE_COMMIT"
pnpm --dir "$ROOT_DIR" ci:check

if [[ "$DEPLOY_WAITLIST" == true ]]; then
  pnpm --dir "$ROOT_DIR" --filter functions check
  "$WRANGLER" --cwd "$ROOT_DIR/apps/functions" deploy --dry-run
fi

if [[ "$DEPLOY_SITE" == true ]]; then
  pnpm --dir "$ROOT_DIR" --filter landing build
fi

if [[ "$DEPLOY_APP" == true ]]; then
  pnpm --dir "$ROOT_DIR" --filter web build
  grep -Fq '<title>Sign in · Pictobook</title>' "$ROOT_DIR/apps/web/dist/index.html" ||
    fail "customer app build is not the login-only production app; merge the local-only prototype separation before deploying it"
fi

if [[ "$DEPLOY_PIPELINE" == true ]]; then
  "$WRANGLER" --cwd "$ROOT_DIR/apps/pipeline-cloudflare" \
    --config "$PIPELINE_CONFIG" deploy --dry-run
fi

if [[ "$DRY_RUN" == true ]]; then
  printf '\nDry run passed. Production deploys would be:\n'
  [[ "$DEPLOY_WAITLIST" != true ]] ||
    printf '  Worker pictobook-functions\n'
  [[ "$DEPLOY_PIPELINE" != true ]] ||
    printf '  D1 migrations and Worker pictobook-pipeline-production\n'
  [[ "$DEPLOY_SITE" != true ]] ||
    printf '  Pages %s from apps/landing/dist\n' "$SITE_PAGES_PROJECT"
  [[ "$DEPLOY_APP" != true ]] ||
    printf '  Pages %s from apps/web/dist (%s)\n' "$APP_PAGES_PROJECT" "$APP_PUBLIC_URL"
  exit 0
fi

"$WRANGLER" --cwd "$ROOT_DIR" whoami >/dev/null

if [[ "$DEPLOY_PIPELINE" == true ]]; then
  secret_json="$("$WRANGLER" --cwd "$ROOT_DIR/apps/pipeline-cloudflare" \
    --config "$PIPELINE_CONFIG" secret list --format json)"
  node --input-type=module - "$secret_json" <<'NODE'
const secrets = JSON.parse(process.argv[2]);
const present = new Set(secrets.map(secret => secret.name));
const required = ["GEMINI_API_KEY", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
const missing = required.filter(name => !present.has(name));
if (missing.length) {
  console.error(`Missing production Worker secrets: ${missing.join(", ")}`);
  process.exit(1);
}
NODE
fi

printf '\nThis will deploy release %s to production.\n' "$RELEASE_TAG"
[[ "$DEPLOY_WAITLIST" != true ]] || printf '  Cloudflare Worker: pictobook-functions\n'
[[ "$DEPLOY_PIPELINE" != true ]] || printf '  Cloudflare Worker: pictobook-pipeline-production\n'
[[ "$DEPLOY_SITE" != true ]] || printf '  Cloudflare Pages: %s\n' "$SITE_PAGES_PROJECT"
[[ "$DEPLOY_APP" != true ]] ||
  printf '  Cloudflare Pages: %s (%s)\n' "$APP_PAGES_PROJECT" "$APP_PUBLIC_URL"
printf 'Type "deploy to production" to continue: '
IFS= read -r confirmation
[[ "$confirmation" == "deploy to production" ]] ||
  fail "production deployment was not confirmed"

if [[ "$DEPLOY_WAITLIST" == true ]]; then
  "$WRANGLER" --cwd "$ROOT_DIR/apps/functions" deploy
fi

if [[ "$DEPLOY_PIPELINE" == true ]]; then
  "$WRANGLER" --cwd "$ROOT_DIR/apps/pipeline-cloudflare" \
    --config "$PIPELINE_CONFIG" d1 migrations apply PIPELINE_DB --remote
  "$WRANGLER" --cwd "$ROOT_DIR/apps/pipeline-cloudflare" \
    --config "$PIPELINE_CONFIG" deploy
fi

commit_message="$(git -C "$ROOT_DIR" log -1 --format=%s "$RELEASE_COMMIT")"
if [[ "$DEPLOY_SITE" == true ]]; then
  "$WRANGLER" --cwd "$ROOT_DIR" pages deploy \
    "$ROOT_DIR/apps/landing/dist" \
    --project-name "$SITE_PAGES_PROJECT" \
    --branch "$PRODUCTION_BRANCH" \
    --commit-hash "$RELEASE_COMMIT" \
    --commit-message "$commit_message"
fi

if [[ "$DEPLOY_APP" == true ]]; then
  "$WRANGLER" --cwd "$ROOT_DIR" pages deploy \
    "$ROOT_DIR/apps/web/dist" \
    --project-name "$APP_PAGES_PROJECT" \
    --branch "$PRODUCTION_BRANCH" \
    --commit-hash "$RELEASE_COMMIT" \
    --commit-message "$commit_message"
fi

printf '\nProduction release %s deployed.\n' "$RELEASE_TAG"
