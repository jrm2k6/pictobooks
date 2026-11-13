import { access, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPipelineEnv } from "./config/env.js";
import { createProviderBundle } from "./config/providers.js";
import { decideRepair } from "./core/repairPolicy.js";
import type {
  GenerationRequest,
  PageBrief,
  PageQaResult,
} from "./contracts/types.js";
import { writeJson } from "./io/files.js";
import { measurePrintFitness } from "./io/imageMetrics.js";
import { createLogger } from "./io/logger.js";
import { cleanupImage } from "./stages/cleanupImage.js";
import { qaPage } from "./stages/qaPage.js";
import { selectGenerationStyleReferences } from "./style/generationReferences.js";
import {
  judgeCandidateStyle,
  loadCanonicalReferences,
  type StyleQaResult,
} from "./style/styleJudge.js";

type Args = {
  run?: string;
  catalog: string;
  photo?: string;
  count: number;
  maxRounds: number;
  acceptScore: number;
  regenerateBelow: number;
  minImprovement: number;
  envFile?: string;
};

type CandidateRecord = {
  id: string;
  imageUri: string;
  printQa: PageQaResult;
  styleQa: StyleQaResult;
};

type RepairRound = {
  round: number;
  source_candidate_id: string;
  source_score: number;
  strategy: "repair_candidate" | "regenerate_from_source";
  generated_candidate_ids: string[];
  resulting_best_candidate_id: string;
  resulting_best_score: number;
  improvement: number;
  completed_at: string;
};

type RepairState = {
  schema_version: "2026-10-27";
  photo_id: string;
  status: "ready" | "needs_human_review" | "repairing";
  stopping_reason: string | null;
  best_candidate_id: string;
  best_score: number;
  policy: {
    accept_score: number;
    regenerate_below: number;
    min_improvement: number;
    max_rounds: number;
    candidates_per_round: number;
  };
  rounds: RepairRound[];
  updated_at: string;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = {
    catalog: "catalog",
    count: 2,
    maxRounds: 2,
    acceptScore: 0.68,
    regenerateBelow: 0.55,
    minImprovement: 0.04,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--") continue;
    if (arg === "--run") args.run = value;
    else if (arg === "--catalog") args.catalog = value;
    else if (arg === "--photo") args.photo = value;
    else if (arg === "--count") args.count = Number(value);
    else if (arg === "--max-rounds") args.maxRounds = Number(value);
    else if (arg === "--accept-score") args.acceptScore = Number(value);
    else if (arg === "--regenerate-below") args.regenerateBelow = Number(value);
    else if (arg === "--min-improvement") args.minImprovement = Number(value);
    else if (arg === "--env-file") args.envFile = value;
    else throw new Error(`Unknown argument: ${arg}`);
    index += 1;
  }
  return args;
};

const main = async () => {
  const logger = createLogger();
  try {
    const args = parseArgs(process.argv.slice(2));
    validateArgs(args);
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    loadPipelineEnv({ invocationCwd, envFile: args.envFile });
    const runDir = resolve(invocationCwd, required(args.run, "--run"));
    const catalogRoot = resolve(invocationCwd, args.catalog);
    const styleBible = await readFile(
      resolve(invocationCwd, "docs/pictobook-preschool-style-bible.md"),
      "utf8"
    );
    const providers = createProviderBundle("gemini");
    const entries = (
      await readdir(join(runDir, "photos"), {
        withFileTypes: true,
      })
    )
      .filter(entry => entry.isDirectory())
      .filter(entry => !args.photo || entry.name === args.photo)
      .sort((left, right) => left.name.localeCompare(right.name));
    if (args.photo && entries.length === 0) {
      throw new Error(`Photo not found: ${args.photo}`);
    }

    const results = [];
    for (const entry of entries) {
      const photoDir = join(runDir, "photos", entry.name);
      const candidateDir = join(photoDir, "candidates");
      const pageBriefPath = join(photoDir, "page-brief.json");
      const generationRequestPath = join(photoDir, "generation-request.json");
      if (
        !(await exists(pageBriefPath)) ||
        !(await exists(generationRequestPath)) ||
        !(await exists(candidateDir))
      ) {
        logger.info("Skipping photo without generated candidates", {
          photo_id: entry.name,
        });
        continue;
      }
      const pageBrief = await readJson<PageBrief>(pageBriefPath);
      const originalRequest = await readJson<GenerationRequest>(
        generationRequestPath
      );
      const statePath = join(photoDir, "auto-style-repair.json");
      const existingState = (await exists(statePath))
        ? await readJson<RepairState>(statePath)
        : undefined;
      const state = await repairPhoto({
        args,
        photoId: entry.name,
        photoDir,
        candidateDir,
        pageBrief,
        originalRequest,
        catalogRoot,
        styleBible,
        providers,
        statePath,
        existingRounds: existingState?.rounds ?? [],
        logger,
      });
      results.push(state);
    }

    const summary = {
      schema_version: "2026-10-27",
      created_at: new Date().toISOString(),
      policy: policyFrom(args),
      ready_count: results.filter(result => result.status === "ready").length,
      needs_human_review_count: results.filter(
        result => result.status === "needs_human_review"
      ).length,
      photos: results,
    };
    await writeJson(join(runDir, "auto-style-repair-summary.json"), summary);
    logger.step("Automatic style repair complete", {
      photos: results.length,
      ready: summary.ready_count,
      needs_human_review: summary.needs_human_review_count,
    });
  } catch (error) {
    console.error(
      `[error] ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  }
};

const repairPhoto = async ({
  args,
  photoId,
  photoDir,
  candidateDir,
  pageBrief,
  originalRequest,
  catalogRoot,
  styleBible,
  providers,
  statePath,
  existingRounds,
  logger,
}: {
  args: Args;
  photoId: string;
  photoDir: string;
  candidateDir: string;
  pageBrief: PageBrief;
  originalRequest: GenerationRequest;
  catalogRoot: string;
  styleBible: string;
  providers: ReturnType<typeof createProviderBundle>;
  statePath: string;
  existingRounds: RepairRound[];
  logger: ReturnType<typeof createLogger>;
}): Promise<RepairState> => {
  const rounds = [...existingRounds];
  let candidates = await loadCandidates(candidateDir);
  let best = bestCandidate(candidates);

  if (best.styleQa.overall_score >= args.acceptScore) {
    return saveState(
      statePath,
      buildState(args, photoId, best, rounds, "ready", "accept_score_met")
    );
  }

  while (rounds.length < args.maxRounds) {
    if (!best.styleQa.repair_plan.repairable) {
      return saveState(
        statePath,
        buildState(
          args,
          photoId,
          best,
          rounds,
          "needs_human_review",
          "judge_marked_not_repairable"
        )
      );
    }
    const roundNumber = rounds.length + 1;
    const strategy =
      best.styleQa.overall_score < args.regenerateBelow
        ? "regenerate_from_source"
        : "repair_candidate";
    await saveState(
      statePath,
      buildState(args, photoId, best, rounds, "repairing", null)
    );

    const references = selectGenerationStyleReferences(
      await loadCanonicalReferences(
        catalogRoot,
        pageBrief.style_pack_version,
        best.imageUri
      )
    );
    const startIndex = nextCandidateIndex(candidates);
    const repairInstruction = buildRepairInstruction(best.styleQa, strategy);
    const request: GenerationRequest = {
      ...originalRequest,
      request_id: `${pageBrief.page_id}_gen_req_auto_${String(roundNumber).padStart(3, "0")}`,
      attempt: roundNumber + 1,
      inputs: {
        ...originalRequest.inputs,
        style_reference_uris: references.map(reference =>
          pathToFileURL(reference.imagePath).toString()
        ),
        repair_reference_uri:
          strategy === "repair_candidate"
            ? pathToFileURL(localPath(best.imageUri)).toString()
            : undefined,
      },
      prompt: {
        ...originalRequest.prompt,
        positive: `${originalRequest.prompt.positive}\n\nAUTOMATIC STYLE REPAIR:\n${repairInstruction}`,
      },
      model: {
        ...originalRequest.model,
        params: {
          ...originalRequest.model.params,
          candidate_count: args.count,
          provider_specific: {
            ...originalRequest.model.params?.provider_specific,
            auto_style_repair_round: roundNumber,
            repair_strategy: strategy,
            source_candidate: best.id,
          },
        },
      },
      retry_context: {
        previous_failure_codes: [],
        repair_instruction: repairInstruction,
      },
    };
    await writeJson(
      join(
        photoDir,
        `generation-request.auto-${String(roundNumber).padStart(3, "0")}.json`
      ),
      request
    );
    logger.step("Running automatic style repair", {
      photo_id: photoId,
      round: roundNumber,
      strategy,
      source_candidate: best.id,
      source_score: best.styleQa.overall_score,
      candidate_start_index: startIndex,
    });
    const generated = await providers.imageProvider.generatePage({
      request,
      candidateDir,
      candidateStartIndex: startIndex,
    });
    const generatedIds = [];
    for (const candidate of generated) {
      const cleaned = await cleanupImage(candidate, candidateDir);
      const printFitness = await measurePrintFitness(cleaned.uri);
      const printQa = qaPage(pageBrief, request, cleaned, printFitness);
      await writeJson(
        join(candidateDir, `${candidate.candidate_id}.qa.json`),
        printQa
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
      generatedIds.push(candidate.candidate_id);
    }

    const previousBest = best;
    candidates = await loadCandidates(candidateDir);
    best = bestCandidate(candidates);
    const improvement = round(
      best.styleQa.overall_score - previousBest.styleQa.overall_score
    );
    rounds.push({
      round: roundNumber,
      source_candidate_id: previousBest.id,
      source_score: previousBest.styleQa.overall_score,
      strategy,
      generated_candidate_ids: generatedIds,
      resulting_best_candidate_id: best.id,
      resulting_best_score: best.styleQa.overall_score,
      improvement,
      completed_at: new Date().toISOString(),
    });

    const decision = decideRepair({
      score: best.styleQa.overall_score,
      repairable: best.styleQa.repair_plan.repairable,
      completedRounds: rounds.length,
      maxRounds: args.maxRounds,
      improvement,
      minImprovement: args.minImprovement,
      acceptScore: args.acceptScore,
    });
    if (decision.state !== "repairing") {
      return saveState(
        statePath,
        buildState(args, photoId, best, rounds, decision.state, decision.reason)
      );
    }
  }

  return saveState(
    statePath,
    buildState(
      args,
      photoId,
      best,
      rounds,
      "needs_human_review",
      "maximum_rounds_reached"
    )
  );
};

const loadCandidates = async (
  candidateDir: string
): Promise<CandidateRecord[]> => {
  const files = (await readdir(candidateDir))
    .filter(file => /^candidate_\d+\.qa\.json$/.test(file))
    .sort();
  const candidates = [];
  for (const file of files) {
    const id = file.replace(".qa.json", "");
    const stylePath = join(candidateDir, `${id}.style-qa.json`);
    if (!(await exists(stylePath))) continue;
    const printQa = await readJson<PageQaResult>(join(candidateDir, file));
    if (printQa.status === "failed") continue;
    const styleQa = await readJson<StyleQaResult>(stylePath);
    if (!styleQa.repair_plan) {
      styleQa.repair_plan = {
        repairable: true,
        preserve: styleQa.strengths ?? [],
        change: styleQa.drift ?? [],
        context_allowances: [],
      };
    }
    candidates.push({
      id,
      imageUri: printQa.generated_image_uri,
      printQa,
      styleQa,
    });
  }
  if (candidates.length === 0) {
    throw new Error(
      `No style-scored, print-eligible candidates in ${candidateDir}`
    );
  }
  return candidates;
};

const bestCandidate = (candidates: CandidateRecord[]) =>
  [...candidates].sort(
    (left, right) => right.styleQa.overall_score - left.styleQa.overall_score
  )[0];

const nextCandidateIndex = (candidates: CandidateRecord[]) =>
  Math.max(...candidates.map(candidate => Number(candidate.id.slice(-3)))) + 1;

const buildRepairInstruction = (
  styleQa: StyleQaResult,
  strategy: RepairRound["strategy"]
) => {
  const plan = styleQa.repair_plan;
  return [
    strategy === "regenerate_from_source"
      ? "Regenerate cleanly from the source photo; do not imitate the failed candidate."
      : "Repair the previous best candidate without changing unrelated successful traits.",
    `Preserve: ${plan.preserve.join("; ") || "subject identity, pose, and successful clean shapes"}.`,
    `Change: ${plan.change.join("; ") || styleQa.drift.join("; ") || styleQa.recommendation}.`,
    plan.context_allowances.length
      ? `Context allowances: ${plan.context_allowances.join("; ")}.`
      : "Do not add contextual detail unless required by the page brief.",
  ].join("\n");
};

const buildState = (
  args: Args,
  photoId: string,
  best: CandidateRecord,
  rounds: RepairRound[],
  status: RepairState["status"],
  stoppingReason: string | null
): RepairState => ({
  schema_version: "2026-10-27",
  photo_id: photoId,
  status,
  stopping_reason: stoppingReason,
  best_candidate_id: best.id,
  best_score: best.styleQa.overall_score,
  policy: policyFrom(args),
  rounds,
  updated_at: new Date().toISOString(),
});

const policyFrom = (args: Args) => ({
  accept_score: args.acceptScore,
  regenerate_below: args.regenerateBelow,
  min_improvement: args.minImprovement,
  max_rounds: args.maxRounds,
  candidates_per_round: args.count,
});

const saveState = async (path: string, state: RepairState) => {
  await writeJson(path, state);
  return state;
};

const validateArgs = (args: Args) => {
  if (!args.run) {
    throw new Error(
      "Usage: pnpm --filter pipeline style-auto-repair -- --run <run-dir> [--catalog ./catalog] [--photo photo-001] [--count 2] [--max-rounds 2]"
    );
  }
  if (!Number.isInteger(args.count) || args.count < 1 || args.count > 3) {
    throw new Error("--count must be an integer from 1 to 3.");
  }
  if (
    !Number.isInteger(args.maxRounds) ||
    args.maxRounds < 1 ||
    args.maxRounds > 5
  ) {
    throw new Error("--max-rounds must be an integer from 1 to 5.");
  }
  for (const [name, value] of [
    ["--accept-score", args.acceptScore],
    ["--regenerate-below", args.regenerateBelow],
    ["--min-improvement", args.minImprovement],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be between 0 and 1.`);
    }
  }
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const required = (value: string | undefined, name: string) => {
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
};

const localPath = (value: string) =>
  value.startsWith("file://") ? new URL(value).pathname : value;

const round = (value: number) => Math.round(value * 1000) / 1000;

await main();
