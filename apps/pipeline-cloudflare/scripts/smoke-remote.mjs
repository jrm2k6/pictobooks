#!/usr/bin/env node

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname } from "node:path";
import { parseArgs, resolveInputPath } from "./smokeCliArgs.mjs";

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
let args;
try {
  args = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
const target = args.target ?? "preview";

if (!args.input) fail("--input <image-path> is required");
if (target !== "preview" && target !== "production") {
  fail("--target must be preview or production");
}
if (
  target === "production" &&
  args["confirm-production"] !== "pictobook-production"
) {
  fail(
    "Production requires --confirm-production pictobook-production; use preview first"
  );
}

const prefix =
  target === "preview" ? "PICTOBOOK_PREVIEW" : "PICTOBOOK_PRODUCTION";
const baseUrl = requiredEnvironment(`${prefix}_URL`);
const smokeToken = requiredEnvironment(`${prefix}_SMOKE_TOKEN`);
const parsedUrl = new URL(baseUrl);
if (parsedUrl.protocol !== "https:") fail(`${prefix}_URL must use HTTPS`);

const inputPath = resolveInputPath(args.input);
const inputStat = await stat(inputPath);
if (
  !inputStat.isFile() ||
  inputStat.size <= 0 ||
  inputStat.size > MAX_SOURCE_BYTES
) {
  fail(
    `Input must be a non-empty file no larger than ${MAX_SOURCE_BYTES} bytes`
  );
}
const input = await readFile(inputPath);
const endpoint = new URL("/internal/smoke/image-normalize", parsedUrl);
if (args.output) endpoint.searchParams.set("download", "true");
const headers = {
  Authorization: `Bearer ${smokeToken}`,
  "Content-Type": contentType(inputPath),
  "Content-Length": String(input.byteLength),
};
const accessClientId = process.env[`${prefix}_ACCESS_CLIENT_ID`];
const accessClientSecret = process.env[`${prefix}_ACCESS_CLIENT_SECRET`];
if (Boolean(accessClientId) !== Boolean(accessClientSecret)) {
  fail(
    `Set both ${prefix}_ACCESS_CLIENT_ID and ${prefix}_ACCESS_CLIENT_SECRET`
  );
}
if (accessClientId && accessClientSecret) {
  headers["CF-Access-Client-Id"] = accessClientId;
  headers["CF-Access-Client-Secret"] = accessClientSecret;
}

console.log(`Running isolated WP4 smoke test against ${target}...`);
const response = await fetch(endpoint, {
  method: "POST",
  headers,
  body: input,
});
if (args.output) {
  if (!response.ok) {
    const errorBody = await response.text();
    console.error(errorBody);
    fail(`Smoke test failed with HTTP ${response.status}`);
  }
  const replayStatus = response.headers.get("x-pictobook-replay-status");
  if (replayStatus !== "reused") {
    fail(`Smoke replay returned ${replayStatus ?? "no status"}`);
  }
  const outputPath = resolveInputPath(args.output);
  const output = Buffer.from(await response.arrayBuffer());
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, output);
  console.log(
    JSON.stringify(
      {
        target,
        smokeId: response.headers.get("x-pictobook-smoke-id"),
        firstStatus: response.headers.get("x-pictobook-first-status"),
        replayStatus,
        sha256: response.headers.get("x-pictobook-artifact-sha256"),
        widthPx: Number(response.headers.get("x-pictobook-artifact-width")),
        heightPx: Number(response.headers.get("x-pictobook-artifact-height")),
        outputPath,
        byteSize: output.byteLength,
        remoteCleanup:
          response.headers.get("x-pictobook-remote-cleanup") === "complete",
      },
      null,
      2
    )
  );
  process.exit(0);
}
const text = await response.text();
let result;
try {
  result = JSON.parse(text);
} catch {
  fail(`Smoke endpoint returned ${response.status} with a non-JSON response`);
}
if (!response.ok || result.ok !== true || result.replayStatus !== "reused") {
  console.error(JSON.stringify(result, null, 2));
  fail(`Smoke test failed with HTTP ${response.status}`);
}

console.log(
  JSON.stringify(
    {
      target,
      smokeId: result.smokeId,
      firstStatus: result.firstStatus,
      replayStatus: result.replayStatus,
      artifact: result.artifact,
      cleanedUp: result.cleanedUp,
    },
    null,
    2
  )
);

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function contentType(path) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
