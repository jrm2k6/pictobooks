import { resolve } from "node:path";

export const parseArgs = values => {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (key === "--") continue;
    if (!key?.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    const value = values[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${key} requires a value`);
    }
    parsed[key.slice(2)] = value;
    index += 1;
  }
  return parsed;
};

export const resolveInputPath = (
  input,
  initialCwd = process.env.INIT_CWD,
  cwd = process.cwd()
) => resolve(initialCwd || cwd, input);
