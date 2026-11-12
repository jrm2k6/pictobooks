export const PAGE_STATES = [
  "created",
  "analyzing",
  "generating",
  "print_qa",
  "style_qa",
  "repairing",
  "intake_rejected",
  "intake_needs_review",
  "needs_human_review",
  "provider_failed",
  "budget_exhausted",
  "approved",
  "rejected",
] as const;

export type PageState = (typeof PAGE_STATES)[number];

export const TERMINAL_PAGE_STATES = [
  "intake_rejected",
  "intake_needs_review",
  "needs_human_review",
  "provider_failed",
  "budget_exhausted",
  "approved",
  "rejected",
] as const satisfies readonly PageState[];

export type BookRecord = {
  book_id: string;
  owner_id: string;
  status: "draft" | "processing" | "review" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
};

export type BookRunRecord = {
  run_id: string;
  book_id: string;
  status:
    | "created"
    | "running"
    | "partially_completed"
    | "completed"
    | "failed"
    | "cancelled";
  style_pack_version: string;
  cost_ceiling_micros: number;
  cost_spent_micros: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type BookRunExecutionConfigRecord = {
  run_id: string;
  provider: string;
  model: string;
  style_judge_model: string;
  execution_profile:
    | "mock_pass_initial"
    | "mock_pass_after_repair"
    | "mock_never_pass";
  candidate_cost_micros: number;
  style_judge_cost_micros: number;
  initial_candidate_count: number;
  created_at: string;
};

export type PageRecord = {
  page_id: string;
  run_id: string;
  photo_id: string;
  state: PageState;
  initial_candidate_count: number;
  repair_round_count: number;
  approved_candidate_id: string | null;
  approval_source: "automatic" | "human" | null;
  terminal_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type OperationRecord = {
  operation_id: string;
  run_id: string;
  page_id: string | null;
  operation_kind:
    | "analyze_photo"
    | "generate_initial"
    | "print_qa"
    | "style_qa"
    | "generate_repair"
    | "normalize"
    | "export"
    | "review"
    | "canonical_promotion";
  status: "claimed" | "running" | "completed" | "failed" | "outcome_ambiguous";
  semantic_attempt: number;
  infrastructure_retry_count: number;
  outcome_json: string | null;
  failure_class: "transient" | "permanent" | "ambiguous" | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type CandidateRecord = {
  candidate_id: string;
  page_id: string;
  operation_id: string;
  repair_round_id: string | null;
  generation_kind: "initial" | "repair";
  ordinal: number;
  raw_artifact_id: string | null;
  clean_artifact_id: string | null;
  created_at: string;
};

export type QaResultRecord = {
  qa_result_id: string;
  candidate_id: string;
  qa_kind: "print" | "style";
  status: "passed" | "failed" | "needs_review";
  overall_score: number | null;
  artifact_id: string | null;
  created_at: string;
};

export type RepairRoundRecord = {
  repair_round_id: string;
  page_id: string;
  round_number: 1 | 2;
  requested_candidate_count: 1 | 2;
  source_candidate_id: string | null;
  status: "claimed" | "running" | "completed" | "failed" | "needs_human_review";
  strategy: "repair_candidate" | "regenerate_from_source";
  created_at: string;
  completed_at: string | null;
};

export type ProviderAttemptRecord = {
  provider_attempt_id: string;
  operation_id: string;
  run_id: string;
  provider: string;
  model: string;
  provider_request_id: string | null;
  infrastructure_attempt: 1 | 2 | 3;
  semantic_attempt: 0 | 1 | 2;
  status:
    | "claimed"
    | "submitted"
    | "succeeded"
    | "transient_failure"
    | "permanent_failure"
    | "outcome_ambiguous";
  estimated_cost_micros: number;
  actual_cost_micros: number | null;
  started_at: string;
  completed_at: string | null;
};

export type ReviewRecord = {
  review_id: string;
  page_id: string;
  candidate_id: string;
  reviewer_id: string;
  decision: "approved" | "rejected" | "changes_requested";
  notes: string | null;
  created_at: string;
};

export type CanonicalReferenceRecord = {
  canonical_reference_id: string;
  review_id: string;
  candidate_id: string;
  style_pack_version: string;
  style_pack_revision: number;
  artifact_id: string;
  promoted_by: string;
  promoted_at: string;
  retired_at: string | null;
};

export type ArtifactRecord = {
  artifact_id: string;
  run_id: string;
  page_id: string | null;
  producing_operation_id: string | null;
  object_key: string;
  artifact_kind:
    | "source_photo"
    | "normalized_photo"
    | "page_brief"
    | "candidate_raw"
    | "candidate_clean"
    | "print_qa"
    | "style_qa"
    | "style_bible"
    | "canonical_reference"
    | "book_export";
  schema_version: string;
  sha256: string;
  byte_size: number;
  mime_type: string;
  provider: string | null;
  model: string | null;
  retention_class: "source" | "derived" | "canonical" | "export" | "audit";
  deleted_at: string | null;
  created_at: string;
};
