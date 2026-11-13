# Coloring Book Pipeline Brief

Last updated: 2026-11-03

This brief describes the planned image generation pipeline for Pictobook: turning uploaded family photos into consistent, printable coloring-book pages.

## Goal

Generate a hardcopy-ready A4 coloring book from uploaded family photos. Each page should look like part of one classic kids coloring book, while preserving the key idea and recognizable subject cues from the source photos.

## Non-Goals For MVP

- Exact photo tracing.
- Photorealistic identity preservation.
- Full recurring-character identity resolution.
- Multiple selectable art styles.
- Captions or titles printed on final artwork.
- Borders, page numbers, nameplates, or decorative layouts.
- Full privacy/compliance implementation beyond reasonable architectural hygiene.

## Required Artifacts

### House Style Bible

A versioned style definition for the Pictobook preschool look.

Current artifact:

- [Pictobook Preschool Style Bible](./pictobook-preschool-style-bible.md)

It should include:

- target age: preschool/simple
- line weight guidance: medium-bold
- detail-density rules
- margin and composition rules for A4
- subject simplification rules
- background simplification rules
- prompt template
- negative prompt
- QA rubric
- canonical examples

Initial version name:

```text
pictobook-preschool-v0.1
```

### Canonical Style Reference Set

Approved reference pages that represent the house style across common scenarios:

- child portrait
- full-body child
- two children
- family group
- dog or cat
- indoor birthday/home scene
- vacation/outdoor scene
- cover image

### Data Contracts

Current artifact:

- [Coloring Book Data Contracts](./coloring-book-data-contracts.md)

### Pipeline Phases

Current artifact:

- [Coloring Book Pipeline Phases](./coloring-book-pipeline-phases.md)

### Current Operations And Production Model

- [Coloring Book Pipeline Operations](./coloring-book-pipeline-operations.md)
- [ADR 0001: Run production generation as bounded durable jobs](./adr/0001-bounded-durable-pipeline-jobs.md)

### Prototype Plan

Current artifact:

- [Coloring Book Prototype Plan](./coloring-book-prototype-plan.md)

### Character Sheets

Post-MVP consistency upgrade.

Character sheets are not required for the first MVP. The first MVP should transform each photo independently while preserving visible identity cues from that photo.

Family group photos are allowed, but the photo analysis must keep subject descriptions scoped to individual people or pets. Incidental subjects may be removed, simplified, or treated as generic background figures.

Future character sheet, if needed:

- head-and-shoulders portrait
- full-body standing pose
- two expression variants
- structured identity metadata

Example metadata:

```json
{
  "subject_id": "child_01",
  "type": "person",
  "identity_cues": ["round glasses", "short curly hair", "striped shirt"],
  "source_reference_ids": ["photo_001", "photo_004"],
  "style_pack_version": "pictobook-preschool-v0.1",
  "status": "approved"
}
```

## Proposed Pipeline

```text
photo uploads
-> intake and validation
-> rejection tagging
-> EXIF stripping and normalization
-> subject-scoped scene extraction per accepted photo
-> simplified page brief generation
-> coloring-page generation
-> black-and-white cleanup
-> page QA
-> retry/repair loop
-> A4 PNG output
-> optional SVG/vectorization
-> cover generation
-> print PDF assembly
```

## Page Generation Inputs

Each generated page should use:

- the house style bible
- one or more canonical style references
- a simplified semantic scene description
- the original photo as a weak reference only when useful
- subject-scoped visible cues for people and pets in that photo
- structured metadata about colors, objects, and context

## Scene Extraction

The scene extractor should turn a source photo into compact structured metadata.

The key rule: subject details must be scoped to a specific subject. Avoid flat cue lists that make multi-person photos ambiguous.

```json
{
  "photo_id": "photo_123",
  "scene_summary": "two children building a sandcastle on the beach",
  "subjects": [
    {
      "local_id": "person_1",
      "centrality": "primary",
      "description": "older child with short curly hair, round glasses, and a striped shirt",
      "action": "kneeling beside the sandcastle"
    },
    {
      "local_id": "person_2",
      "centrality": "primary",
      "description": "younger child with long straight hair and a simple dress",
      "action": "holding a bucket"
    }
  ],
  "keep": ["sandcastle", "bucket", "small waves"],
  "remove": ["crowd", "beach chairs", "busy background"],
  "composition_freedom": "reinterpret_cleanly",
  "page_brief": "Two children building a sandcastle on a beach. The older child kneels beside the sandcastle and has short curly hair, round glasses, and a striped shirt. The younger child holds a bucket and has long straight hair and a simple dress. Keep the beach very simple: sandcastle, bucket, and two small wave lines. Remove crowds and background clutter."
}
```

## Output Targets

Initial target:

- A4 portrait PNG
- 300 DPI equivalent
- 2480 x 3508 px
- pure black on white
- no transparent background required initially

Future target:

- SVG generated from cleaned line art or vector-native generation
- print PDF assembled from approved pages

## QA Gates

Page QA should check:

- black-and-white only
- no grayscale or shading
- clean thick outlines
- large closed coloring regions
- simple preschool detail level
- sparse background
- recognizable key subject cues
- consistency with house style
- clear subject-scoped cues in multi-person scenes
- no distorted faces or hands
- no text or unwanted marks
- A4 print safety and margins

The implemented Style QA judge critiques generated candidates against the style bible, `PageBrief`, and every active Canonical Reference. It ranks candidates and supplies structured repair guidance. A Candidate is approved automatically only when that same Candidate passes deterministic Print QA and Style QA; Human Review handles exceptions and Canonical Reference promotion.

Rejected or weak pages should enter a structured repair loop with explicit failure reasons.

Example repair reasons:

- `too_detailed`
- `gray_shading_detected`
- `background_too_busy`
- `subject_cues_missing`
- `subject_cues_ambiguous`
- `line_weight_inconsistent`
- `uncolorable_small_regions`
- `face_distorted`
- `hands_distorted`
- `style_drift`

## Candidate Technical Approaches

### Hosted Quality Path

Use a hosted image generation/editing API for rapid quality validation.

Likely flow:

```text
image understanding model
→ prompt/style planning
→ image generation with style references and subject-scoped page brief
→ postprocessing
→ QA
```

Pros:

- fastest to prototype
- less infrastructure
- strong prompt following

Cons:

- less low-level control
- model updates may affect consistency
- identity and style can still drift

### Open-Source Control Path

Use a custom ComfyUI or equivalent workflow.

Potential components:

- segmentation for subject isolation
- depth or edge controls for composition
- reference conditioning for character/style
- FLUX/SDXL-family generation
- optional LoRA once enough approved examples exist

Pros:

- strongest control
- easier to pin model versions
- better path toward owned house style

Cons:

- more infrastructure
- more tuning
- more operational complexity

## Open Questions

- How many pages should the initial book contain?
- Does user testing show identity drift across pages is a real problem?
- Should character sheets become required after MVP?
- Should the user explicitly label subjects, for example child names or pet names, in a later version?
- Should the cover be generated from all accepted photos, from selected subjects, or from a separate prompt?
- What is the acceptable generation time per book?
- What is the acceptable cost per book before print/fulfillment?
