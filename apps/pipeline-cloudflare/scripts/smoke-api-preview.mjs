#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";

const baseUrl = required("PICTOBOOK_PREVIEW_URL");
const token = required("PICTOBOOK_PREVIEW_SMOKE_TOKEN");
const suffix = randomUUID();
const authHeaders = { Authorization: `Bearer ${token}` };
addAccessHeaders(authHeaders);

const bookKey = `wp6-book-${suffix}`;
const book = await api("POST", "/v1/books", {}, bookKey);
const bookReplay = await api("POST", "/v1/books", {}, bookKey);
assert(bookReplay.bookId === book.bookId, "Book replay changed its ID");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const sha256 = createHash("sha256").update(png).digest("hex");
const created = await api(
  "POST",
  `/v1/books/${book.bookId}/runs`,
  {
    photos: [{ contentType: "image/png", byteSize: png.byteLength, sha256 }],
  },
  `wp6-run-${suffix}`
);
const upload = created.uploads[0].upload;
const uploadResponse = await fetch(upload.url, {
  method: upload.method,
  headers: upload.headers,
  body: png,
});
if (!uploadResponse.ok) {
  fail(`R2 upload failed with ${uploadResponse.status}`);
}

await api(
  "POST",
  `/v1/books/${book.bookId}/runs/${created.runId}/start`,
  {},
  `wp6-start-${suffix}`
);

let status;
const deadline = Date.now() + 12 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 2_000));
  status = await api("GET", `/v1/books/${book.bookId}/runs/${created.runId}`);
  if (
    ["completed", "partially_completed", "failed"].includes(status.run.status)
  ) {
    break;
  }
}
assert(status?.run?.status === "completed", "Book Run did not complete");
const page = status.pages[0];
const approvedCandidate = status.candidates.find(
  candidate => candidate.candidate_id === page.approved_candidate_id
);
assert(
  approvedCandidate?.clean_artifact_id,
  "Approved Candidate has no clean Artifact"
);

const review = await api(
  "POST",
  `/v1/books/${book.bookId}/pages/${page.page_id}/reviews`,
  {
    candidateId: approvedCandidate.candidate_id,
    decision: "approved",
    notes: "WP6 synthetic preview validation",
  },
  `wp6-review-${suffix}`
);
const canonical = await api(
  "POST",
  `/v1/books/${book.bookId}/candidates/${approvedCandidate.candidate_id}/canonical-promotions`,
  {
    reviewId: review.reviewId,
    stylePackVersion: "pictobook-preschool-v0.1",
  },
  `wp6-canonical-${suffix}`
);
const access = await api(
  "GET",
  `/v1/artifacts/${encodeURIComponent(approvedCandidate.clean_artifact_id)}/access`
);
assert(access.access.method === "GET", "Artifact access was not a signed GET");
const regeneration = await api(
  "POST",
  `/v1/books/${book.bookId}/pages/${page.page_id}/regenerations`,
  {},
  `wp6-regenerate-${suffix}`
);

console.log(
  JSON.stringify(
    {
      bookId: book.bookId,
      runId: created.runId,
      approvedCandidateId: approvedCandidate.candidate_id,
      reviewId: review.reviewId,
      canonicalReferenceId: canonical.canonicalReferenceId,
      regenerationRunId: regeneration.runId,
      replaySafeBookCreation: true,
      privateArtifactAccess: "short-lived-signed-url",
    },
    null,
    2
  )
);

async function api(method, path, body, idempotencyKey) {
  const headers = { ...authHeaders };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  let encodedBody;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    encodedBody = JSON.stringify(body);
  }
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: method === "GET" ? undefined : encodedBody,
  });
  const text = await response.text();
  let result;
  try {
    result = JSON.parse(text);
  } catch {
    fail(`Expected JSON from ${path}, received HTTP ${response.status}`);
  }
  if (!response.ok) fail(`${method} ${path} failed: ${JSON.stringify(result)}`);
  return result;
}

function addAccessHeaders(headers) {
  const clientId = process.env.PICTOBOOK_PREVIEW_ACCESS_CLIENT_ID;
  const clientSecret = process.env.PICTOBOOK_PREVIEW_ACCESS_CLIENT_SECRET;
  if (Boolean(clientId) !== Boolean(clientSecret)) {
    fail("Set both preview Access client variables or neither");
  }
  if (clientId && clientSecret) {
    headers["CF-Access-Client-Id"] = clientId;
    headers["CF-Access-Client-Secret"] = clientSecret;
  }
}

function required(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
