import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

type RunMetadata = {
  input_dir?: unknown;
  input?: unknown;
};

export const resolveRunLabel = async (runDir: string) => {
  let metadata: RunMetadata = {};
  try {
    metadata = JSON.parse(
      await readFile(resolve(runDir, "run.json"), "utf8")
    ) as RunMetadata;
  } catch {
    // Fall back to the run directory name for older or incomplete runs.
  }
  return runLabelFromMetadata(metadata, runDir);
};

export const runLabelFromMetadata = (metadata: RunMetadata, runDir: string) => {
  const inputDir = stringValue(metadata.input_dir);
  const input = stringValue(metadata.input);
  const inputLabel = inputDir
    ? basename(inputDir)
    : input
      ? basename(resolve(input, ".."))
      : "";
  if (/^book-\d+/i.test(inputLabel)) {
    return cleanLabel(inputLabel);
  }
  return cleanLabel(basename(resolve(runDir)).replace(/^pictobook-/i, ""));
};

const cleanLabel = (value: string) =>
  value.replace(/\.([a-z0-9]{4,})$/i, "").replace(/-input$/i, "");

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : "";
