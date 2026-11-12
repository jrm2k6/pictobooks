export type RepairDecision =
  | { state: "ready"; reason: "accept_score_met" }
  | {
      state: "needs_human_review";
      reason:
        | "judge_marked_not_repairable"
        | "improvement_below_minimum"
        | "maximum_rounds_reached";
    }
  | { state: "repairing"; reason: null };

export const decideRepair = (input: {
  score: number;
  repairable: boolean;
  completedRounds: number;
  maxRounds: number;
  improvement?: number;
  minImprovement: number;
  acceptScore: number;
}): RepairDecision => {
  if (input.score >= input.acceptScore) {
    return { state: "ready", reason: "accept_score_met" };
  }
  if (!input.repairable) {
    return {
      state: "needs_human_review",
      reason: "judge_marked_not_repairable",
    };
  }
  if (
    input.improvement !== undefined &&
    input.improvement < input.minImprovement
  ) {
    return {
      state: "needs_human_review",
      reason: "improvement_below_minimum",
    };
  }
  if (input.completedRounds >= input.maxRounds) {
    return {
      state: "needs_human_review",
      reason: "maximum_rounds_reached",
    };
  }
  return { state: "repairing", reason: null };
};
