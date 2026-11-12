import { access, readFile, readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join, resolve } from "node:path";
import { loadPipelineEnv } from "./config/env.js";
import { writeJson } from "./io/files.js";
import { createLogger } from "./io/logger.js";
import {
  judgeCandidateStyle,
  loadCanonicalReferences,
} from "./style/styleJudge.js";

type Args = {
  run?: string;
  catalog: string;
  envFile?: string;
  force: boolean;
};

const parseArgs = (argv: string[]): Args => {
  const args: Args = { catalog: "catalog", force: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    if (arg === "--") {
      continue;
    }
    if (arg === "--run") {
      args.run = value;
      index += 1;
    } else if (arg === "--catalog") {
      args.catalog = value;
      index += 1;
    } else if (arg === "--env-file") {
      args.envFile = value;
      index += 1;
    } else if (arg === "--force") {
      args.force = true;
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
    if (!args.run) {
      throw new Error(
        "Usage: pnpm --filter pipeline style-qa -- --run <run-dir> [--catalog ./catalog] [--force]"
      );
    }
    const invocationCwd = process.env.INIT_CWD ?? process.cwd();
    loadPipelineEnv({ invocationCwd, envFile: args.envFile });
    const runDir = resolve(invocationCwd, args.run);
    const catalogRoot = resolve(invocationCwd, args.catalog);
    const model = process.env.GEMINI_VISION_MODEL ?? "gemini-3.8-flash";
    const styleBible = await readFile(
      resolve(invocationCwd, "docs/pictobook-preschool-style-bible.md"),
      "utf8"
    );
    const photoEntries = await readdir(join(runDir, "photos"), {
      withFileTypes: true,
    });
    let judged = 0;
    let skipped = 0;
    let skippedPhotos = 0;

    for (const photoEntry of photoEntries
      .filter(entry => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const photoDir = join(runDir, "photos", photoEntry.name);
      const pageBriefPath = join(photoDir, "page-brief.json");
      const candidatesDir = join(photoDir, "candidates");
      if (!(await exists(pageBriefPath)) || !(await exists(candidatesDir))) {
        logger.info("Skipping photo without generated candidates", {
          photo_id: photoEntry.name,
        });
        skippedPhotos += 1;
        continue;
      }
      const pageBrief = JSON.parse(
        await readFile(pageBriefPath, "utf8")
      ) as Record<string, unknown>;
      const stylePackVersion = requiredString(pageBrief, "style_pack_version");
      const candidateFiles = (await readdir(candidatesDir))
        .filter(file => /^candidate_\d+\.qa\.json$/.test(file))
        .sort();

      for (const qaFile of candidateFiles) {
        const candidateId = qaFile.replace(".qa.json", "");
        const outputPath = join(candidatesDir, `${candidateId}.style-qa.json`);
        if (!args.force && (await exists(outputPath))) {
          skipped += 1;
          continue;
        }
        const qa = JSON.parse(
          await readFile(join(candidatesDir, qaFile), "utf8")
        ) as Record<string, unknown>;
        const candidatePath = requiredString(qa, "generated_image_uri");
        const references = await loadCanonicalReferences(
          catalogRoot,
          stylePackVersion,
          candidatePath
        );

        logger.step("Judging candidate style", {
          photo_id: photoEntry.name,
          candidate_id: candidateId,
          references: references.length,
          model,
        });
        const result = await judgeCandidateStyle({
          model,
          photoId: photoEntry.name.replace("-", "_"),
          candidateId,
          candidatePath,
          pageBrief: requiredString(pageBrief, "final_brief"),
          styleBible,
          stylePackVersion,
          references,
        });
        await writeJson(outputPath, result);
        logger.info("Style QA written", {
          status: result.status,
          score: result.overall_score,
          output: outputPath,
        });
        judged += 1;
      }
    }

    const summary = await buildCalibrationSummary(runDir, photoEntries);
    await writeJson(join(runDir, "style-qa-summary.json"), summary);
    logger.step("Style QA complete", {
      judged,
      skipped,
      skipped_photos: skippedPhotos,
      human_top_match_count: summary.human_top_match_count,
      reviewed_photo_count: summary.reviewed_photo_count,
      run: runDir,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[error] ${message}`);
    process.exitCode = 1;
  }
};

const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const requiredString = (value: Record<string, unknown>, key: string) => {
  const result = value[key];
  if (typeof result !== "string" || !result) {
    throw new Error(`Missing ${key}.`);
  }
  return result;
};

const buildCalibrationSummary = async (
  runDir: string,
  photoEntries: Dirent[]
) => {
  const photos = [];
  for (const entry of photoEntries
    .filter(item => item.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const candidatesDir = join(runDir, "photos", entry.name, "candidates");
    if (!(await exists(candidatesDir))) {
      continue;
    }
    const files = await readdir(candidatesDir);
    const ranked = [];
    for (const file of files.filter(name => name.endsWith(".style-qa.json"))) {
      const candidateId = file.replace(".style-qa.json", "");
      const result = JSON.parse(
        await readFile(join(candidatesDir, file), "utf8")
      ) as Record<string, unknown>;
      const reviewPath = join(candidatesDir, `${candidateId}.review.json`);
      let humanApproved = false;
      if (await exists(reviewPath)) {
        const review = JSON.parse(await readFile(reviewPath, "utf8")) as Record<
          string,
          unknown
        >;
        humanApproved = review["status"] === "approved";
      }
      ranked.push({
        candidate_id: candidateId,
        style_score:
          typeof result["overall_score"] === "number"
            ? result["overall_score"]
            : 0,
        style_status: result["status"],
        human_approved: humanApproved,
      });
    }
    ranked.sort((left, right) => right.style_score - left.style_score);
    const selectedIndex = ranked.findIndex(
      candidate => candidate.human_approved
    );
    photos.push({
      photo_id: entry.name,
      human_selection_rank: selectedIndex >= 0 ? selectedIndex + 1 : null,
      candidates: ranked,
    });
  }
  const reviewed = photos.filter(photo => photo.human_selection_rank !== null);
  return {
    schema_version: "2026-10-27",
    advisory_only: true,
    created_at: new Date().toISOString(),
    reviewed_photo_count: reviewed.length,
    human_top_match_count: reviewed.filter(
      photo => photo.human_selection_rank === 1
    ).length,
    photos,
  };
};

await main();
