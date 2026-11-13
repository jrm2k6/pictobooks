import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { loadPipelineEnv } from "./config/env.js";
import {
  isProviderName,
  providerNameFromEnv,
  type ProviderName,
} from "./config/providers.js";
import { createLogger } from "./io/logger.js";
import { runPrototype } from "./runPrototype.js";

type CliArgs = {
  input?: string;
  inputDir?: string;
  out?: string;
  style: "pictobook-preschool-v0.1";
  provider?: ProviderName;
  envFile?: string;
  catalog?: string;
  resume: boolean;
};

const parseArgs = (argv: string[]): CliArgs => {
  const args: CliArgs = {
    style: "pictobook-preschool-v0.1",
    resume: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--") {
      continue;
    } else if (arg === "--input") {
      args.input = value;
      index += 1;
    } else if (arg === "--input-dir") {
      args.inputDir = value;
      index += 1;
    } else if (arg === "--out") {
      args.out = value;
      index += 1;
    } else if (arg === "--style") {
      if (value !== "pictobook-preschool-v0.1") {
        throw new Error(`Unsupported style: ${value}`);
      }
      args.style = value;
      index += 1;
    } else if (arg === "--provider") {
      if (!isProviderName(value)) {
        throw new Error(`Unsupported provider: ${value}`);
      }
      args.provider = value;
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = value;
      index += 1;
    } else if (arg === "--catalog") {
      args.catalog = value;
      index += 1;
    } else if (arg === "--resume") {
      args.resume = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const printUsage = () => {
  console.log(`Usage:
  pnpm --filter pipeline prototype -- --input <path> --out <dir> [--style pictobook-preschool-v0.1] [--provider mock] [--env-file apps/pipeline/.env.development]
  pnpm --filter pipeline prototype -- --input-dir <dir> --out <dir> [--style pictobook-preschool-v0.1] [--provider mock] [--catalog ./catalog] [--resume] [--env-file apps/pipeline/.env.development]

Example:
  pnpm --filter pipeline prototype -- --input ./samples/mock-family-photo.jpg --out ./runs/mock-001 --provider mock
  pnpm --filter pipeline prototype -- --input-dir samples/book-001-happy-path --out /tmp/pictobook-book-001 --provider mock`);
};

const main = async () => {
  const logger = createLogger();

  try {
    const args = parseArgs(process.argv.slice(2));
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    const env = loadPipelineEnv({
      invocationCwd,
      envFile: args.envFile,
    });
    const provider = args.provider ?? providerNameFromEnv();

    if ((!args.input && !args.inputDir) || !args.out) {
      printUsage();
      process.exitCode = 1;
      return;
    }

    if (args.input && args.inputDir) {
      console.error("Use either --input or --input-dir, not both.");
      printUsage();
      process.exitCode = 1;
      return;
    }

    logger.info("Pipeline configuration loaded", {
      provider,
      env_files: env.loadedFiles,
    });

    await access(resolve(invocationCwd, args.input ?? args.inputDir ?? ""));
    await runPrototype(
      {
        input: args.input,
        inputDir: args.inputDir,
        out: args.out,
        style: args.style,
        provider,
        catalog: args.catalog,
        resume: args.resume,
      },
      logger
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(message);
    printUsage();
    process.exitCode = 1;
  }
};

await main();
