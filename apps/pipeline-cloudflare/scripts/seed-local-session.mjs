import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const persistDir = "../../tmp/cloudflare-spike/state";
const database = "pictobook-pipeline-spike-dev";
const runWrangler = args => {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "--config", "wrangler.local.jsonc", ...args],
    {
      cwd: appDir,
      encoding: "utf8",
      stdio: "inherit",
    }
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
};

// Local-only by construction: both commands explicitly target a local D1 DB
// and share the same persistence directory as `pnpm --filter pipeline-cloudflare dev`.
runWrangler([
  "d1",
  "migrations",
  "apply",
  database,
  "--local",
  "--persist-to",
  persistDir,
]);

const token = randomBytes(32).toString("base64url");
const tokenHash = createHash("sha256").update(token).digest("hex");
const sessionId = `local-${randomUUID()}`;
const userId = "local-customer";
const now = new Date();
const expiresAt = new Date(
  now.getTime() + 30 * 24 * 60 * 60 * 1000
).toISOString();
const sql = `INSERT INTO api_sessions (session_id, token_sha256, user_id, expires_at, revoked_at, created_at) VALUES ('${sessionId}', '${tokenHash}', '${userId}', '${expiresAt}', NULL, '${now.toISOString()}');`;

runWrangler([
  "d1",
  "execute",
  database,
  "--local",
  "--persist-to",
  persistDir,
  "--command",
  sql,
]);

console.log("Local session created for user local-customer.");
console.log("Token (shown once; store only in your local terminal):");
console.log(token);
