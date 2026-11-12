import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ProviderBundle } from "./config/providers.js";
import type { Logger } from "./io/logger.js";
import { runPhoto } from "./runPrototype.js";

const silentLogger: Logger = {
  info() {},
  warn() {},
  error() {},
  step() {},
};

test("a rejected intake is persisted as terminal instead of aborting the batch", async () => {
  const root = await mkdtemp(join(tmpdir(), "pictobook-rejected-photo-"));
  const inputPath = join(root, "source.png");
  const photoDir = join(root, "photo-001");
  const candidateDir = join(photoDir, "candidates");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nH0AAAAASUVORK5CYII=",
    "base64"
  );
  await writeFile(inputPath, png);

  const providers: ProviderBundle = {
    config: {
      name: "mock",
      visionModel: "rejected-fixture",
      imageModel: "must-not-run",
    },
    visionProvider: {
      async analyzePhoto(input) {
        return {
          schema_version: "2026-09-16",
          photo_id: input.photoId,
          source_uri: input.sourceUri,
          status: "rejected",
          image_properties: input.imageProperties,
          subjects: [],
          composition_freedom: "reinterpret_cleanly",
          quality_notes: ["No suitable coloring-book subject detected."],
          created_at: new Date(0).toISOString(),
        };
      },
    },
    imageProvider: {
      async generatePage() {
        throw new Error("image generation must not run for rejected input");
      },
    },
  };

  const result = await runPhoto({
    inputPath,
    photoId: "photo_001",
    photoDir,
    candidateDir,
    providers,
    styleReferenceUris: [],
    logger: silentLogger,
  });

  assert.equal(result.status, "rejected");
  assert.equal(result.selected_candidate_uri, null);
  assert.deepEqual(result.qa_results, []);
  assert.equal(
    JSON.parse(await readFile(join(photoDir, "photo-analysis.json"), "utf8"))
      .status,
    "rejected"
  );
});
