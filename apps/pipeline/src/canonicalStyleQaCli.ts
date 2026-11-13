import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadPipelineEnv } from "./config/env.js";
import { writeJson } from "./io/files.js";
import { createLogger } from "./io/logger.js";
import {
  judgeCandidateStyle,
  loadCanonicalReferences,
} from "./style/styleJudge.js";

type CanonicalReview = {
  review_id: string;
  source_run: string;
  source_run_label?: string;
  photo_id: string;
  candidate_id: string;
  style_pack_version: string;
};

const args = process.argv.slice(2).filter(value => value !== "--");
const invocationCwd = process.env.INIT_CWD ?? process.cwd();
const catalogRoot = resolve(invocationCwd, args[0] ?? "catalog");
const stylePackVersion = args[1] ?? "pictobook-preschool-v0.1";
loadPipelineEnv({ invocationCwd });
const logger = createLogger();
const styleRoot = join(catalogRoot, stylePackVersion);
const canonical = JSON.parse(
  await readFile(join(styleRoot, "canonical.json"), "utf8")
) as { pages?: CanonicalReview[] };
const styleBible = await readFile(
  resolve(invocationCwd, "docs/pictobook-preschool-style-bible.md"),
  "utf8"
);
const model = process.env.GEMINI_VISION_MODEL ?? "gemini-3.8-flash";
const results = [];

for (const review of canonical.pages ?? []) {
  const pageBrief = JSON.parse(
    await readFile(
      join(review.source_run, "photos", review.photo_id, "page-brief.json"),
      "utf8"
    )
  ) as { final_brief?: string };
  if (!pageBrief.final_brief) {
    throw new Error(`Missing page brief for ${review.review_id}.`);
  }
  const references = (
    await loadCanonicalReferences(catalogRoot, stylePackVersion)
  ).filter(reference => reference.reviewId !== review.review_id);
  const candidatePath = join(styleRoot, "pages", review.review_id, "image.png");
  logger.step("Rescoring canonical page", {
    run: review.source_run_label ?? review.source_run,
    photo_id: review.photo_id,
    candidate_id: review.candidate_id,
    references: references.length,
  });
  const result = await judgeCandidateStyle({
    model,
    photoId: review.photo_id,
    candidateId: review.candidate_id,
    candidatePath,
    pageBrief: pageBrief.final_brief,
    styleBible,
    stylePackVersion,
    references,
  });
  await writeJson(
    join(styleRoot, "pages", review.review_id, "style-qa.rubric-v0.2.json"),
    result
  );
  results.push({
    review_id: review.review_id,
    source_run_label: review.source_run_label ?? null,
    photo_id: review.photo_id,
    candidate_id: review.candidate_id,
    status: result.status,
    overall_score: result.overall_score,
    applicable_dimensions: result.applicable_dimensions,
    not_applicable_dimensions: result.not_applicable_dimensions,
  });
}

const summary = {
  schema_version: "2026-10-28",
  rubric_version: "pictobook-style-rubric-v0.2",
  style_pack_version: stylePackVersion,
  created_at: new Date().toISOString(),
  canonical_count: results.length,
  passed_count: results.filter(result => result.status === "passed").length,
  needs_review_count: results.filter(result => result.status === "needs_review")
    .length,
  failed_count: results.filter(result => result.status === "failed").length,
  pages: results,
};
await writeJson(join(styleRoot, "canonical-style-qa-v0.2.json"), summary);
logger.step("Canonical rescore complete", {
  canonical: summary.canonical_count,
  passed: summary.passed_count,
  needs_review: summary.needs_review_count,
  failed: summary.failed_count,
});
