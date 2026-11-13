import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import type { GeminiPart } from "../providers/gemini/geminiClient.js";
import {
  geminiResponseParts,
  generateGeminiContent,
} from "../providers/gemini/geminiClient.js";

export const styleDimensions = [
  "line_weight_cleanliness",
  "facial_vocabulary",
  "detail_density",
  "character_proportions",
  "background_restraint",
  "coloring_area_size",
  "canonical_similarity",
  "page_brief_fidelity",
] as const;

export type StyleDimension = (typeof styleDimensions)[number];

export type StyleQaResult = {
  schema_version: "2026-10-28";
  rubric_version: "pictobook-style-rubric-v0.2";
  status: "passed" | "needs_review" | "failed";
  overall_score: number;
  scores: Record<
    StyleDimension,
    { score: number; notes: string; applicable: boolean }
  >;
  applicable_dimensions: StyleDimension[];
  not_applicable_dimensions: StyleDimension[];
  strengths: string[];
  drift: string[];
  recommendation: string;
  repair_plan: {
    repairable: boolean;
    preserve: string[];
    change: string[];
    context_allowances: string[];
  };
  candidate_id: string;
  photo_id: string;
  style_pack_version: string;
  reference_ids: string[];
  model: string;
  advisory_only: true;
  created_at: string;
};

export type CanonicalReference = {
  reviewId: string;
  imagePath: string;
  notes: string;
};

type ModelJudgment = {
  scores?: Record<
    string,
    { score?: number; notes?: string; applicable?: boolean }
  >;
  strengths?: unknown[];
  drift?: unknown[];
  recommendation?: string;
  repair_plan?: {
    repairable?: boolean;
    preserve?: unknown[];
    change?: unknown[];
    context_allowances?: unknown[];
  };
};

export const judgeCandidateStyle = async ({
  model,
  photoId,
  candidateId,
  candidatePath,
  pageBrief,
  styleBible,
  stylePackVersion,
  references,
}: {
  model: string;
  photoId: string;
  candidateId: string;
  candidatePath: string;
  pageBrief: string;
  styleBible: string;
  stylePackVersion: string;
  references: CanonicalReference[];
}): Promise<StyleQaResult> => {
  if (references.length < 2) {
    throw new Error(
      `Style QA requires at least 2 canonical references; received ${references.length}.`
    );
  }

  const parts: GeminiPart[] = [
    {
      text: buildJudgePrompt({
        pageBrief,
        styleBible,
        references,
      }),
    },
  ];

  for (const [index, reference] of references.entries()) {
    parts.push({
      text: `Canonical reference ${index + 1}: ${reference.reviewId}. Reviewer notes: ${reference.notes || "No notes provided."}`,
    });
    parts.push(await optimizedImagePart(reference.imagePath));
  }

  parts.push({ text: "Candidate to judge:" });
  parts.push(await optimizedImagePart(candidatePath));

  const response = await generateGeminiContent({
    model,
    parts,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });
  const text = geminiResponseParts(response).find(part => part.text)?.text;
  if (!text) {
    throw new Error("Gemini style judge returned no JSON text.");
  }

  const judgment = parseJudgment(text);
  const scores = normalizeScores(judgment);
  const applicableDimensions = styleDimensions.filter(
    dimension => scores[dimension].applicable
  );
  const notApplicableDimensions = styleDimensions.filter(
    dimension => !scores[dimension].applicable
  );
  const values = applicableDimensions.map(dimension => scores[dimension].score);
  if (values.length === 0) {
    throw new Error(
      "Gemini style judge marked every dimension not applicable."
    );
  }
  const overallScore = round(
    values.reduce((total, score) => total + score, 0) / values.length
  );
  const minimumScore = Math.min(...values);
  const status =
    overallScore >= 0.68 && minimumScore >= 0.55
      ? "passed"
      : overallScore < 0.6 || minimumScore < 0.4
        ? "failed"
        : "needs_review";

  return {
    schema_version: "2026-10-28",
    rubric_version: "pictobook-style-rubric-v0.2",
    status,
    overall_score: overallScore,
    scores,
    applicable_dimensions: applicableDimensions,
    not_applicable_dimensions: notApplicableDimensions,
    strengths: stringArray(judgment.strengths),
    drift: stringArray(judgment.drift),
    recommendation:
      typeof judgment.recommendation === "string"
        ? judgment.recommendation
        : "Review this candidate against the canonical set.",
    repair_plan: {
      repairable: judgment.repair_plan?.repairable !== false,
      preserve: stringArray(judgment.repair_plan?.preserve, 4),
      change: stringArray(judgment.repair_plan?.change ?? judgment.drift, 4),
      context_allowances: stringArray(
        judgment.repair_plan?.context_allowances,
        3
      ),
    },
    candidate_id: candidateId,
    photo_id: photoId,
    style_pack_version: stylePackVersion,
    reference_ids: references.map(reference => reference.reviewId),
    model,
    advisory_only: true,
    created_at: new Date().toISOString(),
  };
};

export const loadCanonicalReferences = async (
  catalogRoot: string,
  stylePackVersion: string,
  candidatePath?: string
): Promise<CanonicalReference[]> => {
  const styleRoot = resolve(catalogRoot, stylePackVersion);
  const index = JSON.parse(
    await readFile(resolve(styleRoot, "canonical.json"), "utf8")
  ) as { pages?: unknown[] };
  const normalizedCandidatePath = candidatePath
    ? resolve(candidatePath)
    : undefined;
  const references: CanonicalReference[] = [];

  for (const value of index.pages ?? []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }
    const review = value as Record<string, unknown>;
    const reviewId = stringValue(review["review_id"]);
    if (!reviewId) {
      continue;
    }
    const reviewedCandidate = localPath(
      stringValue(review["candidate_image_uri"])
    );
    if (
      reviewedCandidate &&
      normalizedCandidatePath &&
      resolve(reviewedCandidate) === normalizedCandidatePath
    ) {
      continue;
    }
    references.push({
      reviewId,
      imagePath: resolve(styleRoot, "pages", reviewId, "image.png"),
      notes: stringValue(review["reviewer_notes"]),
    });
  }

  return references;
};

const buildJudgePrompt = ({
  pageBrief,
  styleBible,
  references,
}: {
  pageBrief: string;
  styleBible: string;
  references: CanonicalReference[];
}) => `
You are an adversarial visual QA judge for a children's coloring-book pipeline.
Evaluate the final candidate against the written style rules, page brief, and ${references.length} human-approved canonical images.

Be strict but evidence-based. Judge visual treatment rather than whether the scene matches a reference scene. Translate any reviewer shorthand or named commercial aesthetic into observable traits; do not reward imitation of a brand or artist.

STYLE BIBLE:
${styleBible}

PAGE BRIEF:
${pageBrief}

Return JSON only in this exact shape:
{
  "scores": {
    "line_weight_cleanliness": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"},
    "facial_vocabulary": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"},
    "detail_density": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"},
    "character_proportions": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"},
    "background_restraint": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"},
    "coloring_area_size": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"},
    "canonical_similarity": {"score": 0.0, "applicable": true, "notes": "compare visual grammar, not scene content"},
    "page_brief_fidelity": {"score": 0.0, "applicable": true, "notes": "specific visual evidence"}
  },
  "strengths": ["up to 3 concise strengths"],
  "drift": ["up to 3 concrete deviations"],
  "recommendation": "one concise next action",
  "repair_plan": {
    "repairable": true,
    "preserve": ["up to 4 successful visual or scene traits that must not regress"],
    "change": ["up to 4 concrete, visually actionable corrections"],
    "context_allowances": ["up to 3 details justified by this specific page brief; empty when none"]
  }
}

Scores range from 0 to 1. A score of 0.68 means suitable for automatic readiness under this rubric when no applicable dimension is below 0.55. Reserve scores above 0.9 for especially strong matches.

Set "applicable" to false for facial_vocabulary and character_proportions when the page contains no person or animal character. The numeric score is ignored when applicable is false; use 0 and explain why in notes. All other dimensions normally remain applicable.

Judge overall coloring usability. A few localized small details may be acceptable when they preserve identity or scene meaning; penalize distributed complexity that creates small coloring regions throughout the page. Background restraint means context does not compete with the main subject, not that the background must be empty. Do not infer identities or sensitive traits.`;

const optimizedImagePart = async (path: string): Promise<GeminiPart> => {
  const data = await sharp(path)
    .resize({ height: 1200, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  return {
    inlineData: {
      mimeType: "image/png",
      data: data.toString("base64"),
    },
  };
};

const parseJudgment = (text: string): ModelJudgment => {
  try {
    return JSON.parse(text) as ModelJudgment;
  } catch {
    throw new Error("Gemini style judge response was not valid JSON.");
  }
};

const normalizeScores = (judgment: ModelJudgment): StyleQaResult["scores"] => {
  const entries = styleDimensions.map(dimension => {
    const value = judgment.scores?.[dimension];
    if (!value || typeof value.score !== "number") {
      throw new Error(`Gemini style judge omitted score: ${dimension}.`);
    }
    return [
      dimension,
      {
        score: round(Math.max(0, Math.min(1, value.score))),
        applicable: value.applicable !== false,
        notes:
          typeof value.notes === "string"
            ? value.notes
            : "No evidence note returned.",
      },
    ] as const;
  });
  return Object.fromEntries(entries) as StyleQaResult["scores"];
};

const stringArray = (value: unknown, limit = 3) =>
  Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string")
        .slice(0, limit)
    : [];

const localPath = (value: string) =>
  value.startsWith("file://") ? new URL(value).pathname : value;

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : "";

const round = (value: number) => Math.round(value * 1000) / 1000;
