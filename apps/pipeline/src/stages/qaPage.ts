import type {
  GeneratedImage,
  GenerationRequest,
  PageBrief,
  PageQaResult,
  PrintFitness,
} from "../contracts/types.js";

export const qaPage = (
  pageBrief: PageBrief,
  request: GenerationRequest,
  candidate: GeneratedImage,
  printFitness: PrintFitness
): PageQaResult => {
  const isFirstCandidate = candidate.candidate_id === "candidate_001";
  const metricsPass =
    printFitness.is_correct_aspect_ratio &&
    printFitness.is_black_and_white_only &&
    (printFitness.black_pixel_ratio ?? 0) >= 0.05 &&
    (printFitness.black_pixel_ratio ?? 0) <= 0.3;
  const status = isFirstCandidate && metricsPass ? "passed" : "needs_review";
  const overallScore = isFirstCandidate && metricsPass ? 0.94 : 0.82;

  return {
    schema_version: "2026-09-16",
    page_id: pageBrief.page_id,
    photo_id: pageBrief.photo_id,
    request_id: request.request_id,
    candidate_id: candidate.candidate_id,
    page_brief_id: `${pageBrief.page_id}_brief`,
    generated_image_uri: candidate.uri,
    style_pack_version: pageBrief.style_pack_version,
    status,
    overall_score: overallScore,
    scores: [
      {
        dimension: "print_cleanliness",
        score: printFitness.score ?? 0,
        threshold: 0.98,
        status: metricsPass ? "passed" : "needs_review",
        severity: metricsPass ? "info" : "warning",
        notes: "Measured from cleaned candidate pixels.",
      },
      {
        dimension: "style_consistency",
        score: overallScore,
        threshold: 0.8,
        status: "passed",
        severity: "info",
        notes: "Mock candidate follows the preschool line-art style.",
      },
      {
        dimension: "page_brief_alignment",
        score: isFirstCandidate ? 0.9 : 0.78,
        threshold: 0.8,
        status: isFirstCandidate ? "passed" : "needs_review",
        severity: isFirstCandidate ? "info" : "warning",
        notes: isFirstCandidate
          ? "Mock candidate aligns with the page brief."
          : "Mock candidate should be reviewed for page-brief alignment.",
      },
    ],
    blocking_reasons: [],
    automatic_rejections: [],
    print_fitness: printFitness,
    page_brief_alignment: {
      score: isFirstCandidate ? 0.9 : 0.78,
      missing_required_elements: [],
      unexpected_elements: [],
      notes: "Mock alignment check compares against PageBrief text.",
    },
    human_review: {
      required: true,
      status: isFirstCandidate ? "approved" : "pending",
      notes: isFirstCandidate
        ? "Mock human QA approves the first candidate."
        : "Mock human QA leaves this candidate pending.",
    },
    notes: [
      "Mock QA result; replace with deterministic metrics and review UI.",
    ],
    created_at: new Date().toISOString(),
  };
};
