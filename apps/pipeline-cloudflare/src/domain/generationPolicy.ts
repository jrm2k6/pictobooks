export const DEFAULT_INITIAL_CANDIDATE_COUNT = 2;
export const MIN_INITIAL_CANDIDATE_COUNT = 1;
export const MAX_INITIAL_CANDIDATE_COUNT = 3;
export const REPAIR_CANDIDATE_COUNT = 2;
export const MAX_REPAIR_ROUNDS = 2;

export const maximumCandidateCount = (initialCandidateCount: number): number =>
  initialCandidateCount + REPAIR_CANDIDATE_COUNT * MAX_REPAIR_ROUNDS;

export const maximumPageCostMicros = (
  initialCandidateCount: number,
  candidateCostMicros: number,
  styleJudgeCostMicros: number
): number =>
  maximumCandidateCount(initialCandidateCount) *
  (candidateCostMicros + styleJudgeCostMicros);
