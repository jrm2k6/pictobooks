import { mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export const ensureDir = async (path: string) => {
  await mkdir(path, { recursive: true });
};

export const removeDir = async (path: string) => {
  await rm(path, { recursive: true, force: true });
};

export const copy = async (from: string, to: string) => {
  await ensureDir(dirname(to));
  await copyFile(from, to);
};

export const writeJson = async (path: string, value: unknown) => {
  await ensureDir(dirname(path));
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const writeText = async (path: string, value: string) => {
  await ensureDir(dirname(path));
  await writeFile(path, value, "utf8");
};
