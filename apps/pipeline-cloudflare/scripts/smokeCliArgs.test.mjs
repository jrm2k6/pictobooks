import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, resolveInputPath } from "./smokeCliArgs.mjs";

test("accepts the pnpm argument separator", () => {
  assert.deepEqual(
    parseArgs([
      "--target",
      "preview",
      "--",
      "--input",
      "samples/book-001/portrait.jpeg",
      "--output",
      "tmp/wp4/normalized.png",
    ]),
    {
      target: "preview",
      input: "samples/book-001/portrait.jpeg",
      output: "tmp/wp4/normalized.png",
    }
  );
});

test("resolves input paths from the shell that invoked pnpm", () => {
  assert.equal(
    resolveInputPath(
      "samples/book-001/portrait.jpeg",
      "/workspace/pictobook",
      "/workspace/pictobook/apps/pipeline-cloudflare"
    ),
    "/workspace/pictobook/samples/book-001/portrait.jpeg"
  );
});
