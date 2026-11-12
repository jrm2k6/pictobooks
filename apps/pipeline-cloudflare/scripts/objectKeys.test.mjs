import assert from "node:assert/strict";
import test from "node:test";
import { objectKeys } from "../src/domain/objectKeys.ts";

test("builds deterministic candidate and QA keys", () => {
  const base = { bookId: "book_1", runId: "run_1", pageId: "page_1" };
  assert.equal(
    objectKeys.candidate({
      ...base,
      candidateId: "candidate_1",
      variant: "clean",
    }),
    "books/book_1/runs/run_1/pages/page_1/candidates/candidate_1/clean.png"
  );
  assert.equal(
    objectKeys.candidateQa({
      ...base,
      candidateId: "candidate_1",
      kind: "style",
    }),
    "books/book_1/runs/run_1/pages/page_1/candidates/candidate_1/style-qa.json"
  );
});

test("rejects unsafe or mutable path segments", () => {
  assert.throws(
    () =>
      objectKeys.bookExport({
        bookId: "../another-book",
        runId: "run_1",
        revision: "v1",
      }),
    /safe object-key segment/
  );
});
