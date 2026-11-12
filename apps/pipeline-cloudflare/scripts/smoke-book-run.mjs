#!/usr/bin/env node

import { parseArgs } from "./smokeCliArgs.mjs";

const args = parseArgs(process.argv.slice(2));
const target = args.target ?? "preview";
if (target !== "preview") {
  fail("Synthetic Book Run smoke tests are preview-only");
}
const pageCount = Number(args.pages ?? "1");
if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 3) {
  fail("--pages must be an integer between 1 and 3");
}
const executionProfile = args.profile ?? "mock_pass_after_repair";
if (
  !["mock_pass_initial", "mock_pass_after_repair", "mock_never_pass"].includes(
    executionProfile
  )
) {
  fail("--profile is not a supported mock execution profile");
}

const baseUrl = requiredEnvironment("PICTOBOOK_PREVIEW_URL");
const token = requiredEnvironment("PICTOBOOK_PREVIEW_SMOKE_TOKEN");
const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
addAccessHeaders(headers);

const createResponse = await fetch(
  new URL("/internal/synthetic-book-runs", baseUrl),
  {
    method: "POST",
    headers,
    body: JSON.stringify({ pageCount, executionProfile }),
  }
);
const created = await readJson(createResponse);
if (!createResponse.ok)
  fail(`Book Run creation failed: ${JSON.stringify(created)}`);

console.log(
  `Created synthetic Book Run ${created.runId}; waiting for completion...`
);
const deadline = Date.now() + 12 * 60 * 1000;
while (Date.now() < deadline) {
  await new Promise(resolve => setTimeout(resolve, 2_000));
  const statusResponse = await fetch(
    new URL(`/internal/synthetic-book-runs/${created.runId}`, baseUrl),
    { headers }
  );
  const status = await readJson(statusResponse);
  if (!statusResponse.ok)
    fail(`Book Run status failed: ${JSON.stringify(status)}`);
  if (["errored", "terminated"].includes(status.workflow.status)) {
    fail(
      `Book Run Workflow ended as ${status.workflow.status}: ${created.runId}`
    );
  }
  if (
    ["completed", "partially_completed", "failed"].includes(status.run.status)
  ) {
    const summary = {
      bookId: created.bookId,
      runId: created.runId,
      runStatus: status.run.status,
      workflowStatus: status.workflow.status,
      costSpentMicros: status.run.cost_spent_micros,
      pages: status.pages.map(page => ({
        pageId: page.page_id,
        state: page.state,
        approvedCandidateId: page.approved_candidate_id,
        repairRounds: page.repair_round_count,
        terminalReason: page.terminal_reason,
      })),
      candidateCount: status.candidates.length,
      providerAttemptCount: status.providerAttempts.length,
      qaResultCount: status.qaResults.length,
    };
    console.log(JSON.stringify(summary, null, 2));
    if (
      executionProfile !== "mock_never_pass" &&
      status.run.status !== "completed"
    ) {
      fail("Synthetic Book Run did not complete successfully");
    }
    process.exit(0);
  }
}
fail(`Timed out waiting for Book Run ${created.runId}`);

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

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    fail(
      `Expected JSON from ${response.url}, received HTTP ${response.status}`
    );
  }
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) fail(`${name} is required`);
  return value;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
