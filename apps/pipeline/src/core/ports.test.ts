import assert from "node:assert/strict";
import test from "node:test";
import { inMemoryOperationClaims } from "../adapters/local/localPipelineAdapters.js";
import { decideRepair } from "./repairPolicy.js";

test("a duplicate operation id cannot generate a second candidate set", async () => {
  const claims = inMemoryOperationClaims();
  let generationCount = 0;
  const generate = () => {
    generationCount += 1;
    return Promise.resolve([{ candidate_id: `candidate_${generationCount}` }]);
  };

  const first = await claims.run("generate:page-1:attempt-1", generate);
  const replay = await claims.run("generate:page-1:attempt-1", generate);

  assert.equal(generationCount, 1);
  assert.deepEqual(replay, first);
});

test("repair policy terminates at its retry budget", () => {
  assert.deepEqual(
    decideRepair({
      score: 0.7,
      repairable: true,
      completedRounds: 3,
      maxRounds: 3,
      minImprovement: 0.02,
      acceptScore: 0.85,
    }),
    { state: "needs_human_review", reason: "maximum_rounds_reached" }
  );
});

test("repair policy terminates when improvement stalls", () => {
  assert.deepEqual(
    decideRepair({
      score: 0.7,
      repairable: true,
      completedRounds: 1,
      maxRounds: 3,
      improvement: 0.01,
      minImprovement: 0.02,
      acceptScore: 0.85,
    }),
    { state: "needs_human_review", reason: "improvement_below_minimum" }
  );
});
