import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProviderBundle } from "../config/providers.js";
import type {
  GenerationRequest,
  PageBrief,
  PageQaResult,
} from "../contracts/types.js";
import { writeJson } from "../io/files.js";
import { measurePrintFitness } from "../io/imageMetrics.js";
import type { Logger } from "../io/logger.js";
import { cleanupImage } from "../stages/cleanupImage.js";
import { qaPage } from "../stages/qaPage.js";
import {
  judgeCandidateStyle,
  loadCanonicalReferences,
  type StyleQaResult,
} from "./styleJudge.js";

type RegenerationHistory = {
  schema_version: "2026-10-27";
  entries: RegenerationEntry[];
};

type RegenerationEntry = {
  regeneration_id: string;
  source_candidate_id: string;
  reviewer_instruction: string;
  judge_findings: {
    recommendation: string;
    preserve: string[];
    change: string[];
    context_allowances: string[];
  };
  generated_candidate_ids: string[];
  best_generated_candidate_id: string | null;
  best_generated_style_score: number | null;
  completed_at: string;
};

export const regenerateCandidateFromSource = async ({
  invocationCwd,
  runDir,
  catalogRoot,
  photoId,
  candidateId,
  reviewerInstruction,
  logger,
}: {
  invocationCwd: string;
  runDir: string;
  catalogRoot: string;
  photoId: string;
  candidateId: string;
  reviewerInstruction: string;
  logger: Logger;
}) => {
  assertArtifactId(photoId, "photo");
  assertArtifactId(candidateId, "candidate");
  const photoDir = resolve(runDir, "photos", photoId);
  const candidateDir = join(photoDir, "candidates");
  const pageBrief = await readJson<PageBrief>(
    join(photoDir, "page-brief.json")
  );
  const originalRequest = await readJson<GenerationRequest>(
    join(photoDir, "generation-request.json")
  );
  const sourceQa = await readJson<PageQaResult>(
    join(candidateDir, `${candidateId}.qa.json`)
  );
  const sourceStyleQa = await readJson<StyleQaResult>(
    join(candidateDir, `${candidateId}.style-qa.json`)
  );
  const references = (
    await loadCanonicalReferences(
      catalogRoot,
      pageBrief.style_pack_version,
      sourceQa.generated_image_uri
    )
  ).slice(0, 3);
  const historyPath = join(photoDir, "source-regenerations.json");
  const history = await readHistory(historyPath);
  const sequence = history.entries.length + 1;
  const regenerationId = `source_regeneration_${String(sequence).padStart(3, "0")}`;
  const startIndex = await nextCandidateIndex(candidateDir);
  const repairPlan = sourceStyleQa.repair_plan ?? {
    repairable: true,
    preserve: sourceStyleQa.strengths ?? [],
    change: sourceStyleQa.drift ?? [],
    context_allowances: [],
  };
  const instruction = buildInstruction(
    sourceStyleQa,
    repairPlan,
    reviewerInstruction
  );
  const request: GenerationRequest = {
    ...originalRequest,
    request_id: `${pageBrief.page_id}_${regenerationId}`,
    attempt: originalRequest.attempt + sequence,
    inputs: {
      ...originalRequest.inputs,
      repair_reference_uri: undefined,
      style_reference_uris: references.map(reference =>
        pathToFileURL(reference.imagePath).toString()
      ),
    },
    prompt: {
      ...originalRequest.prompt,
      positive: `${originalRequest.prompt.positive}\n\nREGENERATE FROM SOURCE:\n${instruction}`,
    },
    model: {
      ...originalRequest.model,
      params: {
        ...originalRequest.model.params,
        candidate_count: 3,
        provider_specific: {
          ...originalRequest.model.params?.provider_specific,
          regeneration_mode: "from_source",
          diagnostic_candidate: candidateId,
          regeneration_id: regenerationId,
        },
      },
    },
    retry_context: {
      previous_failure_codes: [],
      repair_instruction: instruction,
    },
  };
  await writeJson(join(photoDir, `${regenerationId}.request.json`), request);

  const providers = createProviderBundle("gemini");
  logger.step("Regenerating from original source", {
    photo_id: photoId,
    diagnostic_candidate: candidateId,
    candidate_start_index: startIndex,
    judge_change_count: repairPlan.change.length,
    reviewer_instruction: Boolean(reviewerInstruction.trim()),
  });
  const generated = await providers.imageProvider.generatePage({
    request,
    candidateDir,
    candidateStartIndex: startIndex,
  });
  const styleBible = await readFile(
    resolve(invocationCwd, "docs/pictobook-preschool-style-bible.md"),
    "utf8"
  );
  const results = [];
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
    results.push({ candidateId: candidate.candidate_id, printQa, styleQa });
  }
  const best = [...results].sort(
    (left, right) => right.styleQa.overall_score - left.styleQa.overall_score
  )[0];
  const entry: RegenerationEntry = {
    regeneration_id: regenerationId,
    source_candidate_id: candidateId,
    reviewer_instruction: reviewerInstruction.trim(),
    judge_findings: {
      recommendation: sourceStyleQa.recommendation,
      preserve: repairPlan.preserve,
      change: repairPlan.change,
      context_allowances: repairPlan.context_allowances,
    },
    generated_candidate_ids: results.map(result => result.candidateId),
    best_generated_candidate_id: best?.candidateId ?? null,
    best_generated_style_score: best?.styleQa.overall_score ?? null,
    completed_at: new Date().toISOString(),
  };
  history.entries.push(entry);
  await writeJson(historyPath, history);
  return entry;
};

const buildInstruction = (
  styleQa: StyleQaResult,
  plan: StyleQaResult["repair_plan"],
  reviewerInstruction: string
) =>
  [
    "Start over from the original source photo. Do not reproduce the diagnostic candidate's composition, anatomy, or defects.",
    `Judge recommendation: ${styleQa.recommendation}`,
    `Preserve from the source/brief: ${plan.preserve.join("; ") || "recognizable identity, pose, and essential scene meaning"}.`,
    `Avoid the prior failure: ${plan.change.join("; ") || styleQa.drift.join("; ")}.`,
    plan.context_allowances.length
      ? `Acceptable context: ${plan.context_allowances.join("; ")}.`
      : "Keep contextual detail minimal unless required by the page brief.",
    reviewerInstruction.trim()
      ? `Human reviewer instruction: ${reviewerInstruction.trim()}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

const nextCandidateIndex = async (candidateDir: string) => {
  const indexes = (await readdir(candidateDir))
    .map(file => /^candidate_(\d+)\.qa\.json$/.exec(file)?.[1])
    .filter((value): value is string => Boolean(value))
    .map(Number);
  return Math.max(0, ...indexes) + 1;
};

const readHistory = async (path: string): Promise<RegenerationHistory> => {
  try {
    return await readJson<RegenerationHistory>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { schema_version: "2026-10-27", entries: [] };
  }
};

const readJson = async <T>(path: string): Promise<T> =>
  JSON.parse(await readFile(path, "utf8")) as T;

const assertArtifactId = (value: string, label: string) => {
  if (!/^[a-z0-9_-]+$/i.test(value)) {
    throw new Error(`Invalid ${label} identifier.`);
  }
};
