import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import test from "node:test";

test("automatic repair skips photos rejected before generation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pictobook-auto-repair-"));
  const photoDir = join(root, "photos", "photo-001");
  await mkdir(photoDir, { recursive: true });
  await writeFile(
    join(photoDir, "photo-result.json"),
    JSON.stringify({
      photo_id: "photo_001",
      status: "rejected",
      selected_candidate_uri: null,
      qa_results: [],
    })
  );

  const repositoryRoot = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../.."
  );
  const result = await runCli(repositoryRoot, root);
  assert.equal(result.code, 0, result.stderr);

  const summary = JSON.parse(
    await readFile(join(root, "auto-style-repair-summary.json"), "utf8")
  ) as { photos: unknown[]; ready_count: number };
  assert.deepEqual(summary.photos, []);
  assert.equal(summary.ready_count, 0);
});

const runCli = (repositoryRoot: string, runDir: string) =>
  new Promise<{ code: number | null; stderr: string }>(resolveResult => {
    const child = spawn(
      process.execPath,
      [
        join(repositoryRoot, "apps/pipeline/dist/autoStyleRepairCli.js"),
        "--run",
        runDir,
        "--catalog",
        join(repositoryRoot, "catalog"),
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          INIT_CWD: repositoryRoot,
          GEMINI_API_KEY: "test-key-not-used",
        },
      }
    );
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr += String(chunk);
    });
    child.on("close", code => resolveResult({ code, stderr }));
  });
