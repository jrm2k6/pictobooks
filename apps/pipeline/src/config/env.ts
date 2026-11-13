import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

export type EnvLoadResult = {
  loadedFiles: string[];
};

export const loadPipelineEnv = ({
  invocationCwd,
  envFile,
}: {
  invocationCwd: string;
  envFile?: string;
}): EnvLoadResult => {
  const candidates = envFile
    ? [resolve(invocationCwd, envFile)]
    : [
        resolve(invocationCwd, ".env"),
        resolve(invocationCwd, ".env.development"),
        resolve(invocationCwd, "apps/pipeline/.env"),
        resolve(invocationCwd, "apps/pipeline/.env.development"),
      ];

  const loadedFiles: string[] = [];
  for (const path of candidates) {
    if (!existsSync(path)) {
      continue;
    }

    dotenv.config({ path, override: false });
    loadedFiles.push(path);
  }

  return { loadedFiles };
};
