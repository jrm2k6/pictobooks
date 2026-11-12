import type {
  PageQaResult,
  RepairInstruction,
  RetryDecision,
} from "../contracts/types.js";

export const createRepairInstruction = (
  qaResult: PageQaResult
): {
  repairInstruction: RepairInstruction;
  retryDecision: RetryDecision;
} => {
  const repairInstruction: RepairInstruction = {
    schema_version: "2026-09-16",
    repair_id: `repair_${qaResult.candidate_id}`,
    page_id: qaResult.page_id,
    failed_request_id: qaResult.request_id,
    next_attempt: 2,
    action: "regenerate_with_simpler_prompt",
    reasons:
      qaResult.blocking_reasons.length > 0
        ? qaResult.blocking_reasons
        : ["style_drift"],
    requires_human_approval: true,
    prompt_patch: {
      add: [
        "Use pure black outlines only.",
        "Simplify the background.",
        "Keep large closed coloring shapes.",
      ],
      remove_or_avoid: ["gray shading", "texture", "background clutter"],
    },
    postprocess_patch: {
      force_binary_threshold: true,
      remove_small_components: true,
      min_component_area_px: 40,
      normalize_line_width: true,
    },
    notes: "Mock repair proposal; human approval is required before retry.",
    max_attempts: 3,
  };

  const retryDecision: RetryDecision = {
    should_retry: false,
    next_attempt: 2,
    max_attempts: 3,
    recommended_action: "regenerate_with_simpler_prompt",
    human_approval_status: "pending",
    stop_reason: "manual_review_required",
    escalate_to_manual_review: true,
    explanation:
      "Automatic QA proposed a repair, but MVP retries require human approval.",
    estimated_quality_gain: "medium",
  };

  return { repairInstruction, retryDecision };
};
