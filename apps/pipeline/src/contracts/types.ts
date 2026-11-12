export type PhotoStatus = "accepted" | "rejected" | "needs_review";

export type RejectionReason =
  | "too_blurry"
  | "too_dark"
  | "too_cluttered"
  | "face_occluded"
  | "too_many_subjects"
  | "unsafe_content"
  | "unsupported_format"
  | "duplicate"
  | "low_resolution"
  | "no_clear_subject"
  | "generation_unsuitable";

export type SubjectType = "person" | "pet" | "object" | "other" | "unknown";

export type SubjectCentrality = "primary" | "secondary" | "incidental";

export type CompositionFreedom = "reinterpret_cleanly";

export type CueImportance = "low" | "medium" | "high";

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageProperties = {
  width_px: number;
  height_px: number;
  mime_type: "image/jpeg" | "image/png" | "image/heic" | "image/webp";
  aspect_ratio: number;
};

export type PhotoRejection = {
  reasons: RejectionReason[];
  severity: "soft" | "hard";
  retryable_with_new_photo: boolean;
  message: string;
  details?: string[];
};

export type SemanticColorCue = {
  target: string;
  color: string;
  importance: CueImportance;
};

export type DetectedSubject = {
  local_id: string;
  type: SubjectType;
  centrality: SubjectCentrality;
  description: string;
  action?: string;
  visible_cues?: {
    hair?: string;
    face?: string;
    eyes?: string;
    accessories?: string[];
    clothing?: string;
    body_or_silhouette?: string;
    pet_markings?: string;
    other?: string[];
  };
  semantic_color_cues?: SemanticColorCue[];
  bounding_box: BoundingBox;
  confidence: number;
};

export type PhotoAnalysis = {
  schema_version: "2026-09-16";
  photo_id: string;
  source_uri: string;
  status: PhotoStatus;
  rejection?: PhotoRejection;
  image_properties: ImageProperties;
  scene_summary?: string;
  subjects?: DetectedSubject[];
  keep?: string[];
  remove?: string[];
  composition_freedom: CompositionFreedom;
  analysis_confidence?: number;
  quality_notes?: string[];
  notes?: string[];
  created_at: string;
};

export type FinalArtConstraints = {
  format: "png";
  page_size: "A4";
  orientation: "portrait";
  width_px: 2480;
  height_px: 3508;
  color_mode: "black_and_white";
  background: "white";
  allow_grayscale: false;
  allow_text: false;
  complexity: "simple";
};

export type SubjectBrief = {
  local_id: string;
  type: SubjectType;
  role?: string;
  centrality: SubjectCentrality;
  source_bounding_box: BoundingBox;
  prompt_text: string;
};

export type PageBrief = {
  schema_version: "2026-09-16";
  page_id: string;
  photo_id: string;
  source_uri: string;
  style_pack_version: "pictobook-preschool-v0.1";
  scene_summary: string;
  subject_briefs: SubjectBrief[];
  keep: string[];
  remove: string[];
  composition_freedom: CompositionFreedom;
  final_art_constraints: FinalArtConstraints;
  final_brief: string;
  metadata_caption: string;
};

export type GenerationParams = {
  candidate_count?: number;
  seed?: number;
  quality?: "draft" | "standard" | "high";
  guidance_scale?: number;
  provider_specific?: Record<string, unknown>;
};

export type GenerationRequest = {
  schema_version: "2026-09-16";
  request_id: string;
  page_id: string;
  photo_id: string;
  attempt: number;
  style_pack_version: "pictobook-preschool-v0.1";
  output: {
    format: "png";
    width_px: 2480;
    height_px: 3508;
    background: "white";
    color_mode: "black_and_white";
  };
  inputs: {
    page_brief: string;
    source_image_uri?: string;
    style_reference_uris?: string[];
    repair_reference_uri?: string;
  };
  prompt: {
    positive: string;
    negative: string;
  };
  model: {
    provider:
      | "mock"
      | "openai"
      | "gemini"
      | "bfl"
      | "recraft"
      | "stability"
      | "adobe_firefly";
    name: string;
    params?: GenerationParams;
  };
  retry_context?: {
    previous_failure_codes: RepairReason[];
    repair_instruction?: string;
  };
};

export type QaDimension =
  | "style_consistency"
  | "print_cleanliness"
  | "black_white_purity"
  | "preschool_simplicity"
  | "subject_cue_preservation"
  | "page_brief_alignment"
  | "scene_clarity"
  | "background_restraint"
  | "anatomy_friendliness"
  | "safety"
  | "technical_validity";

export type QaScore = {
  dimension: QaDimension;
  score: number;
  threshold: number;
  status: "passed" | "failed" | "needs_review";
  severity: "info" | "warning" | "blocking";
  notes?: string;
};

export type AutomaticRejectionCode =
  | "unsafe_content"
  | "wrong_aspect_ratio"
  | "not_black_and_white"
  | "too_much_gray_shading"
  | "background_too_busy"
  | "too_detailed_for_preschool"
  | "too_many_tiny_regions"
  | "line_art_too_faint"
  | "line_art_too_dense"
  | "subject_missing"
  | "scene_mismatch"
  | "malformed_face_or_body"
  | "contains_text_or_caption"
  | "low_resolution"
  | "generation_artifact"
  | "source_photo_unsuitable";

export type AutomaticRejection = {
  code: AutomaticRejectionCode;
  severity: "warning" | "blocking";
  source: "image_metric" | "vision_model" | "moderation" | "operator";
  message: string;
  evidence?: Record<string, unknown>;
};

export type PrintFitness = {
  score?: number;
  width_px: number;
  height_px: number;
  target_format: "A4_portrait_300dpi";
  is_correct_aspect_ratio: boolean;
  is_black_and_white_only: boolean;
  black_pixel_ratio?: number;
  gray_pixel_ratio?: number;
  white_pixel_ratio?: number;
  estimated_line_thickness_px?: number;
  small_component_count?: number;
  tiny_region_count?: number;
  largest_blank_region_ratio?: number;
  margin_safe?: boolean;
  notes?: string[];
};

export type PageBriefAlignment = {
  score: number;
  missing_required_elements: string[];
  unexpected_elements: string[];
  notes?: string;
};

export type HumanReview = {
  required: boolean;
  status: "pending" | "approved" | "rejected" | "changes_requested";
  reviewer_id?: string;
  reviewed_at?: string;
  notes?: string;
};

export type RepairAction =
  | "regenerate"
  | "regenerate_with_simpler_prompt"
  | "postprocess_only"
  | "crop_or_simplify_source"
  | "reject_source_photo"
  | "manual_review";

export type RepairReason =
  | "too_detailed"
  | "gray_shading_detected"
  | "background_too_busy"
  | "subject_cues_missing"
  | "subject_cues_ambiguous"
  | "line_weight_inconsistent"
  | "uncolorable_small_regions"
  | "face_distorted"
  | "hands_distorted"
  | "style_drift"
  | "text_or_marks_detected"
  | "wrong_aspect_ratio"
  | "unsafe_or_inappropriate";

export type RepairInstruction = {
  schema_version: "2026-09-16";
  repair_id: string;
  page_id: string;
  failed_request_id: string;
  next_attempt: number;
  action: RepairAction;
  reasons: RepairReason[];
  requires_human_approval: boolean;
  prompt_patch: {
    add: string[];
    remove_or_avoid: string[];
  };
  postprocess_patch?: {
    force_binary_threshold?: boolean;
    remove_small_components?: boolean;
    min_component_area_px?: number;
    normalize_line_width?: boolean;
  };
  notes?: string;
  max_attempts: number;
};

export type RetryStopReason =
  | "passed"
  | "max_attempts_reached"
  | "blocking_safety_issue"
  | "source_photo_unsuitable"
  | "manual_review_required"
  | "budget_exceeded";

export type RetryDecision = {
  should_retry: boolean;
  next_attempt: number | null;
  max_attempts: number;
  recommended_action: RepairAction;
  human_approval_status: "not_required" | "pending" | "approved" | "rejected";
  stop_reason?: RetryStopReason | null;
  escalate_to_manual_review: boolean;
  final_failure_disposition?: "generation_unsuitable";
  explanation?: string;
  estimated_quality_gain?: "low" | "medium" | "high";
};

export type PageQaResult = {
  schema_version: "2026-09-16";
  page_id: string;
  photo_id: string;
  request_id: string;
  candidate_id: string;
  page_brief_id: string;
  generated_image_uri: string;
  style_pack_version: "pictobook-preschool-v0.1";
  status: "passed" | "failed" | "needs_review";
  overall_score?: number;
  scores: QaScore[];
  blocking_reasons: RepairReason[];
  automatic_rejections: AutomaticRejection[];
  print_fitness?: PrintFitness;
  page_brief_alignment: PageBriefAlignment;
  human_review?: HumanReview;
  repair_instruction?: RepairInstruction;
  retry_decision?: RetryDecision;
  notes?: string[];
  created_at: string;
};

export type GeneratedImage = {
  candidate_id: string;
  uri: string;
  width_px: 2480;
  height_px: 3508;
};
