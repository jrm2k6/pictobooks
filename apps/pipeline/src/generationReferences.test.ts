import assert from "node:assert/strict";
import test from "node:test";
import { selectGenerationStyleReferences } from "./style/generationReferences.js";
import type { CanonicalReference } from "./style/styleJudge.js";

const references = (count: number): CanonicalReference[] =>
  Array.from({ length: count }, (_, index) => ({
    reviewId: `reference-${index + 1}`,
    imagePath: `/catalog/reference-${index + 1}.png`,
    notes: "",
  }));

test("generation references span the canonical catalogue", () => {
  const selected = selectGenerationStyleReferences(references(13));
  assert.deepEqual(
    selected.map(reference => reference.reviewId),
    ["reference-1", "reference-7", "reference-13"]
  );
});

test("generation references retain all entries when below the limit", () => {
  const selected = selectGenerationStyleReferences(references(2));
  assert.deepEqual(
    selected.map(reference => reference.reviewId),
    ["reference-1", "reference-2"]
  );
});

test("a single generation reference prefers the newest canonical", () => {
  const selected = selectGenerationStyleReferences(references(5), 1);
  assert.equal(selected[0]?.reviewId, "reference-5");
});
