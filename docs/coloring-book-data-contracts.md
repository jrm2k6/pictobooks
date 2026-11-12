# Coloring Book Data Contracts

Last updated: 2026-11-03

This document defines the first MVP data contracts for the Pictobook image-to-coloring-page pipeline.

The MVP does not require recurring-character identity resolution, facial recognition, or character sheets. Each photo is analyzed independently. Multi-person photos must keep subject details scoped to individual subjects so prompts do not confuse who has which visible traits.

## Pipeline Shape

```text
input photo
-> PhotoAnalysis
-> PageBrief
-> GenerationRequest
-> generated A4 PNG
-> PageQaResult
-> RepairInstruction, if needed
```

## Shared Enums

### PhotoStatus

```ts
type PhotoStatus = "accepted" | "rejected" | "needs_review";
```

### RejectionReason

```ts
type RejectionReason =
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
```

### SubjectType

```ts
type SubjectType = "person" | "pet" | "object" | "other" | "unknown";
```

### SubjectCentrality

```ts
type SubjectCentrality = "primary" | "secondary" | "incidental";
```

Centrality controls draw priority:

- `primary`: must be considered for the final page; usually appears in the `PageBrief`.
- `secondary`: relevant to the scene, but can be simplified or omitted if the page gets crowded.
- `incidental`: background or low-importance subject; usually removed, generalized, or listed in `remove`.

### CompositionFreedom

```ts
type CompositionFreedom = "reinterpret_cleanly";
```

The MVP always uses `reinterpret_cleanly`. The source photo is evidence for a cleaner coloring-page interpretation, not a canvas to trace.

### CueImportance

```ts
type CueImportance = "low" | "medium" | "high";
```

Cue importance controls how strongly the page planner should preserve a semantic cue:

- `high`: important for subject or object recognition.
- `medium`: useful but can be simplified.
- `low`: contextual only; can be dropped if the page gets crowded.

## Score Conventions

- Generated-page QA rubric scores use `0` to `1`.
- Deterministic image metrics use ratios from `0` to `1`.
- Confidence values use `0` to `1`.

## PhotoAnalysis

`PhotoAnalysis` is the first structured interpretation of an uploaded photo.

It should answer:

- Is the photo usable?
- What is the key scene?
- Who or what are the primary subjects?
- Which visible cues should be preserved?
- What should be kept, simplified, or removed?

`needs_review` is important for MVP. It lets the pipeline collect borderline examples for tuning the intake and QA rules instead of forcing every photo into a premature accepted/rejected binary.

`photo_id` is a stable pipeline identifier for the uploaded photo. In the local prototype, it can be derived from the run and filename, such as `photo_001`. In production, it can map to a database record or object-storage key. It should not be treated as a cross-run identity for a person, pet, or object.

```ts
type PhotoAnalysis = {
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
```

```ts
type ImageProperties = {
  width_px: number;
  height_px: number;
  mime_type: "image/jpeg" | "image/png" | "image/heic" | "image/webp";
  aspect_ratio: number;
};
```

Rules:

- `status`, `image_properties`, and `created_at` are required.
- `rejection` is required when `status` is `rejected` or `needs_review`.
- `source_uri` is always included so artifacts can be traced back to their source photo.
- `composition_freedom` is always `reinterpret_cleanly` for MVP.
- `scene_summary`, `subjects`, `keep`, and `remove` are required when `status` is `accepted`.
- `keep` and `remove` stay in `PhotoAnalysis` so the analysis stage can record visible scene intent before `PageBrief` decides what to draw.
- `analysis_confidence` is first-class because it helps tune intake thresholds and identify photos that should move into `needs_review`.
- Subject descriptions must not rely on global cue lists.
- Primary subjects should be limited where possible. Busy group photos can be simplified.

## PhotoRejection

```ts
type PhotoRejection = {
  reasons: RejectionReason[];
  severity: "soft" | "hard";
  retryable_with_new_photo: boolean;
  message: string;
  details?: string[];
};
```

Example:

```json
{
  "schema_version": "2026-09-16",
  "photo_id": "photo_007",
  "source_uri": "file://samples/photo_007.jpg",
  "status": "rejected",
  "image_properties": {
    "width_px": 900,
    "height_px": 1200,
    "mime_type": "image/jpeg",
    "aspect_ratio": 0.75
  },
  "rejection": {
    "reasons": ["too_blurry", "face_occluded"],
    "severity": "hard",
    "retryable_with_new_photo": true,
    "message": "The main subject is too blurry and the face is mostly hidden.",
    "details": [
      "Primary face is not clear enough for visible cue extraction.",
      "Try a brighter photo where the subject faces the camera."
    ]
  },
  "composition_freedom": "reinterpret_cleanly",
  "created_at": "2026-09-27T14:30:00Z"
}
```

## DetectedSubject

`DetectedSubject` describes a subject inside one photo. It is not a cross-photo identity.

```ts
type DetectedSubject = {
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
```

```ts
type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

```ts
type SemanticColorCue = {
  target: string;
  color: string;
  importance: CueImportance;
};
```

Rules:

- `local_id` only needs to be stable within the photo, for example `person_1` or `pet_1`.
- `bounding_box` is required for every detected subject because it gives downstream stages a concrete region for cropping, masking, visual review, and later control-signal generation.
- Bounding boxes use source-image pixel coordinates with origin at the top-left.
- `confidence` is required per subject and uses `0` to `1`.
- `description` should be generation-ready prose.
- `visible_cues` should only include traits visible or strongly inferable from the photo.
- `semantic_color_cues` captures color as meaning, not as final output color. It helps preserve cues such as dark glasses, a red striped shirt, a black dog with white paws, or a blue bucket even though the final artwork is black-and-white.
- High-importance color cues should affect the page brief. Low-importance color cues can be dropped when simplifying the scene.
- Clothing and color cues are allowed, but they should not imply cross-photo identity.
- Objects are valid subjects when they matter to the scene, for example a bucket, birthday cake, bicycle, stuffed animal, stroller, suitcase, or sandcastle.
- Incidental subjects can be described briefly or omitted from the final page brief.

## PageBrief

`PageBrief` turns accepted photo analysis into a generation-ready plan.

```ts
type PageBrief = {
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
```

```ts
type SubjectBrief = {
  local_id: string;
  type: SubjectType;
  role?: string;
  centrality: SubjectCentrality;
  source_bounding_box: BoundingBox;
  prompt_text: string;
};
```

```ts
type FinalArtConstraints = {
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
```

Rules:

- `final_brief` is the prose payload most useful to image generation.
- `final_brief` should be model-neutral. `GenerationRequest` is responsible for turning it into a provider-specific prompt.
- `final_brief` should mention only the subjects and setting cues that should appear in the final page.
- `metadata_caption` is required for QA, debugging, dataset review, and future training, but it must not be printed on the final artwork.
- `source_uri` is copied forward for traceability.
- `subject_briefs` should carry source bounding boxes forward from `DetectedSubject`.
- `keep` and `remove` are copied from `PhotoAnalysis` for MVP. They can diverge later if the page planner becomes more opinionated.
- Incidental subjects should usually be omitted or explicitly removed.
- If a multi-person photo is accepted, `final_brief` must keep each subject's cues attached to that subject.

## GenerationRequest

`GenerationRequest` describes one attempt to generate a coloring page.

A candidate is one generated image option for a page. A request can ask for multiple candidates, but each generated candidate should be saved and QA'd separately.

A negative prompt is the list of things the image model should avoid, such as gray shading, hatching, text, clutter, distorted hands, or scary faces.

```ts
type GenerationRequest = {
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
```

```ts
type GenerationParams = {
  candidate_count?: number;
  seed?: number;
  quality?: "draft" | "standard" | "high";
  guidance_scale?: number;
  provider_specific?: Record<string, unknown>;
};
```

Rules:

- `attempt` starts at `1`.
- Initial generation is source-authoritative: the Source Photo supplies visible identity and scene evidence while the Page Brief controls simplification and composition.
- `style_reference_uris` contains style-only Canonical References; their subjects and scenes must not be copied.
- `repair_reference_uri` is present only when repairing a prior candidate. Source Regeneration deliberately omits it.
- `candidate_count` controls how many generated picture options the provider should return for this page attempt.
- `prompt.negative` is required and should start from the style bible's negative prompt.
- Provider-specific settings are allowed under `model.params.provider_specific`.
- Mock providers should use `provider: "mock"` so the prototype can run before real model integration.

## PageQaResult

`PageQaResult` records automated or human evaluation of one generated candidate image.

Generated pages can be `needs_review`. Print QA catches objective print issues; Style QA evaluates visual treatment and Page Brief alignment. The same Candidate passing both gates is approved automatically; Human Review remains authoritative for exceptions.

```ts
type PageQaResult = {
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
  adversarial_style_review?: AdversarialStyleReview;
  human_review?: HumanReview;
  repair_instruction?: RepairInstruction;
  retry_decision?: RetryDecision;
  notes?: string[];
  created_at: string;
};
```

```ts
type QaDimension =
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

type QaScore = {
  dimension: QaDimension;
  score: number;
  threshold: number;
  status: "passed" | "failed" | "needs_review";
  severity: "info" | "warning" | "blocking";
  notes?: string;
};
```

```ts
type PageBriefAlignment = {
  score: number;
  missing_required_elements: string[];
  unexpected_elements: string[];
  notes?: string;
};
```

```ts
type HumanReview = {
  required: boolean;
  status: "pending" | "approved" | "rejected" | "changes_requested";
  reviewer_id?: string;
  reviewed_at?: string;
  notes?: string;
};
```

```ts
type AdversarialStyleReview = {
  status: "passed" | "failed" | "needs_review";
  style_consistency_score: number;
  page_brief_alignment_score: number;
  preschool_simplicity_score: number;
  book_cohesion_score?: number;
  violations: AdversarialStyleViolation[];
  summary: string;
};
```

```ts
type AdversarialStyleViolation = {
  code:
    | "line_weight_drift"
    | "too_detailed"
    | "gray_shading"
    | "background_clutter"
    | "not_house_style"
    | "unfriendly_face"
    | "page_brief_mismatch"
    | "cohort_style_outlier";
  severity: "warning" | "blocking";
  explanation: string;
  repair_instruction: string;
};
```

Score range is `0` to `1`.

Pass thresholds:

- `print_cleanliness` and `black_white_purity` should be at least `0.98`.
- Style QA uses an automatic-readiness threshold of `0.68`, provided no applicable dimension is below `0.55` and Print QA passes.
- `needs_review` should be used for borderline generated candidates, especially when automatic metrics pass but human style or page-brief alignment is uncertain.
- Each generated candidate gets its own `PageQaResult`.
- Any automatic rejection should fail the page.
- MVP QA includes deterministic Print QA, adversarial Style QA, automatic dual-gate approval, bounded automatic repair, and Human Review for exceptions.

## Implemented Style QA

An adversarial visual judge enforces consistent styling after Print QA and supplies structured findings to bounded automatic repair.

Inputs:

- generated candidate image
- `PageBrief`
- style bible
- every active Canonical Reference

Judge prompt direction:

```text
Find every way this image violates the Pictobook preschool style.
Check line weight, detail density, gray shading, background clutter,
face friendliness, page-brief alignment, and whether it looks like it
belongs with the approved examples.
```

Use cases:

- flag style drift across pages
- catch excessive detail or clutter
- compare the candidate against the `PageBrief`
- produce targeted repair instructions
- rank outlier pages in a multi-page book

Limits:

- Do not use this layer for pixel-level print fitness.
- Do not treat scores as deterministic across model/provider updates.
- Do not use it as the only approval gate for final pages.
- Approve automatically only when the same Candidate passes both QA gates; keep Human Review for exceptions and Canonical Reference promotion.
- Bound automatic repair by round, candidate, improvement, and cost budgets; see [Coloring Book Pipeline Operations](./coloring-book-pipeline-operations.md).

## AutomaticRejection

```ts
type AutomaticRejection = {
  code: AutomaticRejectionCode;
  severity: "warning" | "blocking";
  source: "image_metric" | "vision_model" | "moderation" | "operator";
  message: string;
  evidence?: Record<string, unknown>;
};
```

```ts
type AutomaticRejectionCode =
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
```

## PrintFitness

`PrintFitness` stores deterministic image checks when available.

```ts
type PrintFitness = {
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
```

Suggested deterministic metric bands:

- `gray_pixel_ratio`: pass at `<= 0.01`, repair at `<= 0.05`, fail above `0.05`.
- `black_pixel_ratio`: target `0.08` to `0.24`; too sparse below `0.05`; too dense above `0.30`.
- `small_component_count`: pass at `<= 150`, repair from `151` to `300`, fail above `300`.

## RepairInstruction

`RepairInstruction` tells the generator what to change on the next attempt.

```ts
type RepairInstruction = {
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
```

```ts
type RepairAction =
  | "regenerate"
  | "regenerate_with_simpler_prompt"
  | "postprocess_only"
  | "crop_or_simplify_source"
  | "reject_source_photo"
  | "manual_review";
```

```ts
type RepairReason =
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
```

## RetryDecision

```ts
type RetryDecision = {
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
```

```ts
type RetryStopReason =
  | "passed"
  | "max_attempts_reached"
  | "blocking_safety_issue"
  | "source_photo_unsuitable"
  | "manual_review_required"
  | "budget_exceeded";
```

Rules:

- Human QA decides whether to retry a failed generated candidate.
- Run at most two bounded Repair Rounds automatically; a reviewer may explicitly approve an exception after automation stops.
- Prompt repair and regeneration are the default repair path. Postprocessing can be applied to the regenerated image, but MVP repair should not rely on postprocessing alone.
- Do not automatically retry safety failures. Safety failures stop immediately with a clear explanation.
- If all candidates/attempts for a page fail, mark the source as `generation_unsuitable`.
- Use specific repair instructions, not generic "make it better" prompts.

## Example: Single-Subject Photo

```json
{
  "schema_version": "2026-09-16",
  "photo_id": "photo_001",
  "source_uri": "file://samples/photo_001.jpg",
  "status": "accepted",
  "image_properties": {
    "width_px": 3024,
    "height_px": 4032,
    "mime_type": "image/jpeg",
    "aspect_ratio": 0.75
  },
  "scene_summary": "a child sitting on a beach holding a bucket",
  "subjects": [
    {
      "local_id": "person_1",
      "type": "person",
      "centrality": "primary",
      "description": "child with short curly hair, round glasses, and a striped shirt",
      "action": "sitting on the sand and holding a bucket",
      "bounding_box": {
        "x": 420,
        "y": 380,
        "width": 1180,
        "height": 2100
      },
      "confidence": 0.91,
      "visible_cues": {
        "hair": "short curly hair",
        "face": "small round face",
        "accessories": ["round glasses"],
        "clothing": "striped shirt"
      },
      "semantic_color_cues": [
        {
          "target": "hair",
          "color": "brown",
          "importance": "medium"
        },
        {
          "target": "glasses",
          "color": "dark frames",
          "importance": "high"
        },
        {
          "target": "shirt",
          "color": "red and white striped",
          "importance": "medium"
        },
        {
          "target": "bucket",
          "color": "blue",
          "importance": "high"
        }
      ]
    }
  ],
  "keep": ["bucket", "simple sand shape", "two small wave lines"],
  "remove": ["beach crowd", "chairs", "busy towel pattern"],
  "composition_freedom": "reinterpret_cleanly",
  "analysis_confidence": 0.88,
  "quality_notes": ["good lighting", "main subject visible"],
  "created_at": "2026-09-16T14:30:00Z"
}
```

## Example: Multi-Person PageBrief

```json
{
  "schema_version": "2026-09-16",
  "page_id": "page_004",
  "photo_id": "photo_004",
  "source_uri": "file://samples/photo_004.jpg",
  "style_pack_version": "pictobook-preschool-v0.1",
  "scene_summary": "two children building a sandcastle on the beach",
  "subject_briefs": [
    {
      "local_id": "person_1",
      "type": "person",
      "centrality": "primary",
      "source_bounding_box": {
        "x": 320,
        "y": 410,
        "width": 900,
        "height": 1900
      },
      "prompt_text": "older child kneeling beside the sandcastle with short curly hair, round glasses, and a striped shirt"
    },
    {
      "local_id": "person_2",
      "type": "person",
      "centrality": "primary",
      "source_bounding_box": {
        "x": 1250,
        "y": 520,
        "width": 820,
        "height": 1700
      },
      "prompt_text": "younger child holding a small bucket with long straight hair and a simple dress"
    }
  ],
  "keep": ["sandcastle", "bucket", "small wave lines"],
  "remove": ["crowd", "beach chairs", "busy background"],
  "composition_freedom": "reinterpret_cleanly",
  "final_art_constraints": {
    "format": "png",
    "page_size": "A4",
    "orientation": "portrait",
    "width_px": 2480,
    "height_px": 3508,
    "color_mode": "black_and_white",
    "background": "white",
    "allow_grayscale": false,
    "allow_text": false,
    "complexity": "simple"
  },
  "final_brief": "Two children building a sandcastle on a beach. Draw the older child kneeling beside the sandcastle with short curly hair, round glasses, and a striped shirt. Draw the younger child holding a small bucket with long straight hair and a simple dress. Keep the beach very simple: a sandcastle, a bucket, and two small wave lines. Remove crowds, chairs, and background clutter.",
  "metadata_caption": "Two children building a sandcastle on the beach"
}
```

## Example: Failed QA Result

```json
{
  "schema_version": "2026-09-16",
  "page_id": "page_001",
  "photo_id": "photo_123",
  "request_id": "gen_req_456",
  "candidate_id": "candidate_001",
  "page_brief_id": "page_001_brief",
  "generated_image_uri": "file://runs/book-001/photos/photo-001/candidates/candidate-001.cleaned.png",
  "style_pack_version": "pictobook-preschool-v0.1",
  "status": "failed",
  "overall_score": 0.62,
  "blocking_reasons": ["gray_shading_detected", "too_detailed"],
  "scores": [
    {
      "dimension": "black_white_purity",
      "score": 0.71,
      "threshold": 0.98,
      "status": "failed",
      "severity": "blocking",
      "notes": "Gray shading appears on clothing and background."
    },
    {
      "dimension": "preschool_simplicity",
      "score": 0.58,
      "threshold": 0.8,
      "status": "failed",
      "severity": "blocking",
      "notes": "Background contains too many small objects."
    },
    {
      "dimension": "page_brief_alignment",
      "score": 0.76,
      "threshold": 0.8,
      "status": "needs_review",
      "severity": "warning",
      "notes": "The child and bucket are present, but the sandcastle is missing."
    }
  ],
  "automatic_rejections": [
    {
      "code": "too_much_gray_shading",
      "severity": "blocking",
      "source": "image_metric",
      "message": "Generated page contains gray shading.",
      "evidence": {
        "gray_pixel_ratio": 0.07,
        "threshold": 0.05
      }
    }
  ],
  "print_fitness": {
    "score": 0.72,
    "width_px": 2480,
    "height_px": 3508,
    "target_format": "A4_portrait_300dpi",
    "is_correct_aspect_ratio": true,
    "is_black_and_white_only": false,
    "gray_pixel_ratio": 0.07,
    "black_pixel_ratio": 0.27,
    "white_pixel_ratio": 0.66,
    "estimated_line_thickness_px": 5,
    "small_component_count": 412,
    "tiny_region_count": 133,
    "margin_safe": true
  },
  "page_brief_alignment": {
    "score": 0.76,
    "missing_required_elements": ["sandcastle"],
    "unexpected_elements": ["extra beach toys"],
    "notes": "Candidate mostly follows the page brief, but it omitted the sandcastle and added clutter."
  },
  "human_review": {
    "required": true,
    "status": "pending",
    "notes": "Automatic metrics failed; human review should confirm whether the source photo or prompt should be simplified."
  },
  "repair_instruction": {
    "schema_version": "2026-09-16",
    "repair_id": "repair_001",
    "page_id": "page_001",
    "failed_request_id": "gen_req_456",
    "next_attempt": 2,
    "action": "regenerate_with_simpler_prompt",
    "reasons": ["gray_shading_detected", "too_detailed"],
    "requires_human_approval": true,
    "prompt_patch": {
      "add": [
        "Use pure black outlines only.",
        "Remove all shading and texture.",
        "Use fewer background elements.",
        "Make large simple enclosed shapes."
      ],
      "remove_or_avoid": [
        "gray shadows",
        "hair texture",
        "crowd details",
        "fabric texture"
      ]
    },
    "postprocess_patch": {
      "force_binary_threshold": true,
      "remove_small_components": true,
      "min_component_area_px": 40,
      "normalize_line_width": true
    },
    "notes": "Prioritize Pictobook style consistency over photo faithfulness.",
    "max_attempts": 3
  },
  "retry_decision": {
    "should_retry": false,
    "next_attempt": 2,
    "max_attempts": 3,
    "recommended_action": "regenerate_with_simpler_prompt",
    "human_approval_status": "pending",
    "stop_reason": "manual_review_required",
    "escalate_to_manual_review": true,
    "explanation": "Automatic QA found repairable visual failures, but the bounded automatic Repair Round budget is exhausted.",
    "estimated_quality_gain": "high"
  },
  "created_at": "2026-09-16T14:40:00Z"
}
```

## Example: Final Failure Disposition

If all bounded automatic and explicitly reviewer-directed attempts fail, the page should stop and the source photo should be treated as unsuitable for generation.

```json
{
  "should_retry": false,
  "next_attempt": null,
  "max_attempts": 3,
  "recommended_action": "reject_source_photo",
  "human_approval_status": "not_required",
  "stop_reason": "max_attempts_reached",
  "escalate_to_manual_review": false,
  "final_failure_disposition": "generation_unsuitable",
  "explanation": "All approved generation attempts failed print/style QA. Mark the source photo as generation_unsuitable and ask for a replacement photo."
}
```
