import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPipelineEnv } from "./config/env.js";
import { createProviderBundle } from "./config/providers.js";
import type { GenerationRequest, PageBrief } from "./contracts/types.js";
import { writeJson } from "./io/files.js";
import { measurePrintFitness } from "./io/imageMetrics.js";
import { createLogger } from "./io/logger.js";
import { cleanupImage } from "./stages/cleanupImage.js";
import { qaPage } from "./stages/qaPage.js";
import {
  judgeCandidateStyle,
  loadCanonicalReferences,
} from "./style/styleJudge.js";

type Args = {
  run?: string;
  photo?: string;
  candidate?: string;
  catalog: string;
  count: number;
  envFile?: string;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { catalog: "catalog", count: 2 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--") {
      continue;
    }
    if (arg === "--run") {
      args.run = value;
      index += 1;
    } else if (arg === "--photo") {
      args.photo = value;
      index += 1;
    } else if (arg === "--candidate") {
      args.candidate = value;
      index += 1;
    } else if (arg === "--catalog") {
      args.catalog = value;
      index += 1;
    } else if (arg === "--count") {
      args.count = Number(value);
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
};

const main = async () => {
  const logger = createLogger();
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.run || !args.photo || !args.candidate) {
      throw new Error(
        "Usage: pnpm --filter pipeline style-retry -- --run <run-dir> --photo <photo-id> --candidate <candidate-id> [--catalog ./catalog] [--count 2]"
      );
    }
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 3) {
      throw new Error("Retry candidate count must be between 1 and 3.");
    }

    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    loadPipelineEnv({ invocationCwd, envFile: args.envFile });
    const runDir = resolve(invocationCwd, args.run);
    const catalogRoot = resolve(invocationCwd, args.catalog);
    const photoDir = join(runDir, "photos", args.photo);
    const candidateDir = join(photoDir, "candidates");
    const pageBrief = JSON.parse(
      await readFile(join(photoDir, "page-brief.json"), "utf8")
    ) as PageBrief;
    const originalRequest = JSON.parse(
      await readFile(join(photoDir, "generation-request.json"), "utf8")
    ) as GenerationRequest;
    const originalStyleQa = JSON.parse(
      await readFile(
        join(candidateDir, `${args.candidate}.style-qa.json`),
        "utf8"
      )
    ) as {
      drift?: string[];
      recommendation?: string;
    };
    const originalQa = JSON.parse(
      await readFile(join(candidateDir, `${args.candidate}.qa.json`), "utf8")
    ) as { generated_image_uri: string };
    const references = await loadCanonicalReferences(
      catalogRoot,
      pageBrief.style_pack_version,
      originalQa.generated_image_uri
    );
    if (references.length < 3) {
      throw new Error("Style retry requires at least 3 other canonical pages.");
    }

    const existingIds = (await readdir(candidateDir))
      .map(file => /^candidate_(\d+)\.qa\.json$/.exec(file)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number);
    const startIndex = Math.max(0, ...existingIds) + 1;
    const repairInstruction = [
      originalStyleQa.recommendation,
      ...(originalStyleQa.drift ?? []),
    ]
      .filter(Boolean)
      .join(" ");
    const styleReferences = references.slice(0, 3);
    const retryRequest: GenerationRequest = {
      ...originalRequest,
      request_id: `${pageBrief.page_id}_gen_req_002_style_retry`,
      attempt: 2,
      inputs: {
        ...originalRequest.inputs,
        style_reference_uris: styleReferences.map(reference =>
          pathToFileURL(reference.imagePath).toString()
        ),
      },
      prompt: {
        ...originalRequest.prompt,
        positive: `${originalRequest.prompt.positive}\n\nTARGETED REPAIR:\n${repairInstruction}`,
      },
      model: {
        ...originalRequest.model,
        params: {
          ...originalRequest.model.params,
          candidate_count: args.count,
          provider_specific: {
            ...originalRequest.model.params?.provider_specific,
            style_reference_count: styleReferences.length,
            retry_source_candidate: args.candidate,
          },
        },
      },
      retry_context: {
        previous_failure_codes: [],
        repair_instruction: repairInstruction,
      },
    };
    await writeJson(
      join(photoDir, "generation-request.attempt-002.json"),
      retryRequest
    );

    const providers = createProviderBundle("gemini");
    logger.step("Generating targeted style retry", {
      photo_id: args.photo,
      source_candidate: args.candidate,
      candidate_count: args.count,
      candidate_start_index: startIndex,
      style_references: styleReferences.map(reference => reference.reviewId),
    });
    const generated = await providers.imageProvider.generatePage({
      request: retryRequest,
      candidateDir,
      candidateStartIndex: startIndex,
    });
    const styleBible = await readFile(
      resolve(invocationCwd, "docs/pictobook-preschool-style-bible.md"),
      "utf8"
    );

    for (const candidate of generated) {
      const cleaned = await cleanupImage(candidate, candidateDir);
      const printFitness = await measurePrintFitness(cleaned.uri);
      const qa = qaPage(pageBrief, retryRequest, cleaned, printFitness);
      await writeJson(
        join(candidateDir, `${candidate.candidate_id}.qa.json`),
        qa
      );
      const styleQa = await judgeCandidateStyle({
        model: providers.config.visionModel,
        photoId: pageBrief.photo_id,
        candidateId: candidate.candidate_id,
        candidatePath: cleaned.uri,
        pageBrief: pageBrief.final_brief,
        styleBible,
        stylePackVersion: pageBrief.style_pack_version,
        references,
      });
      await writeJson(
        join(candidateDir, `${candidate.candidate_id}.style-qa.json`),
        styleQa
      );
      logger.info("Retry candidate ready", {
        candidate_id: candidate.candidate_id,
        print_score: printFitness.score,
        style_score: styleQa.overall_score,
        style_status: styleQa.status,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] ${message}`);
    process.exitCode = 1;
  }
};

await main();
