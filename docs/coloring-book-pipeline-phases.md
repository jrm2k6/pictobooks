# Coloring Book Pipeline Phases

Last updated: 2026-11-03

This document shows the MVP pipeline phases for turning uploaded family photos into printable Pictobook coloring-book pages.

The MVP prioritizes style consistency and print quality. It does not require recurring-character identity resolution, facial recognition, or character sheets. The implemented pipeline now has separate Print QA and Style QA gates plus bounded automatic repair. See [Coloring Book Pipeline Operations](./coloring-book-pipeline-operations.md) for current production semantics and limits.

## End-To-End Flow

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                              Pictobook MVP Pipeline                          │
└──────────────────────────────────────────────────────────────────────────────┘

  Parent uploads photos
          │
          ▼
┌──────────────────────┐
│ 1. Intake            │
│ - validate file      │
│ - assign photo_id    │
│ - keep source_uri    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│ 2. Normalize         │
│ - strip EXIF         │
│ - read dimensions    │
│ - normalize format   │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 3. Photo Analysis                │
│ Artifact: PhotoAnalysis          │
│ - accepted/rejected/needs_review │
│ - scene_summary                  │
│ - DetectedSubject[]              │
│ - bounding boxes                 │
│ - keep/remove                    │
│ - analysis_confidence            │
└──────────┬───────────────────────┘
           │
           ├──────────── rejected ────────────► Tagged rejected photo
           │
           ├──────────── needs_review ────────► Human intake review
           │
           │                                      │
           │                                      ├── accept
           │                                      └── reject
           ▼
┌──────────────────────────────────┐
│ 4. Page Planning                 │
│ Artifact: PageBrief              │
│ - decide what should be drawn    │
│ - subject-scoped prompt text     │
│ - source bounding boxes copied   │
│ - metadata_caption               │
│ - model-neutral final_brief      │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 5. Generation Request            │
│ Artifact: GenerationRequest      │
│ - final_brief                    │
│ - style_pack_version             │
│ - positive prompt                │
│ - negative prompt                │
│ - candidate_count                │
│ - provider params                │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 6. Generate Candidates           │
│ Artifact: candidate PNGs         │
│ - one or more generated images   │
│ - A4 portrait target             │
│ - source + brief + style refs    │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 7. Cleanup                       │
│ Artifact: cleaned candidate PNGs │
│ - black/white thresholding       │
│ - remove gray where possible     │
│ - normalize print output         │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 8. Print QA                      │
│ Artifact: PageQaResult           │
│ - one result per candidate       │
│ - dimensions and print metrics   │
│ - black/white fitness            │
│ - objective blocking defects     │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 9. Style QA                      │
│ Artifact: StyleQaResult          │
│ - style bible and PageBrief      │
│ - all Canonical References       │
│ - ranking and repair plan        │
└──────────┬───────────────────────┘
           │
           ├──────── dual QA pass ────────────► Candidate approved
           │
           └──────── below threshold ─────────► Bounded Repair Round
                                                  │
                                                  ├── accepted ─► approved
                                                  └── stopped ──► Human Review

  If bounded automation stops without an acceptable candidate:

          ▼
┌──────────────────────────────────┐
│ 10. Final Failure Disposition    │
│ - mark generation_unsuitable     │
│ - ask for replacement photo      │
└──────────────────────────────────┘

  If one candidate is selected:

          ▼
┌──────────────────────────────────┐
│ 11. Page Output                  │
│ Artifact: selected A4 PNG        │
│ - printable black/white page     │
│ - SVG/vectorization later        │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 12. Book Assembly                │
│ - cover later                    │
│ - print PDF later                │
│ - hardcopy fulfillment later     │
└──────────────────────────────────┘
```

## Phase Summary

| Phase               | Main Artifact            | Human Gate             | Notes                                                                       |
| ------------------- | ------------------------ | ---------------------- | --------------------------------------------------------------------------- |
| Intake              | raw upload record        | no                     | Assign `photo_id`; preserve `source_uri`.                                   |
| Normalize           | normalized image         | no                     | Strip metadata and inspect dimensions.                                      |
| Photo Analysis      | `PhotoAnalysis`          | yes for `needs_review` | Rejected and borderline photos stop before generation.                      |
| Page Planning       | `PageBrief`              | optional               | Converts visible photo facts into draw intent.                              |
| Generation Request  | `GenerationRequest`      | no                     | Records source, canonical references, provider, and attempt.                |
| Generate Candidates | candidate PNGs           | no                     | Initial generation produces three candidates.                               |
| Cleanup             | cleaned candidate PNGs   | no                     | Deterministic print cleanup.                                                |
| Print QA            | `PageQaResult`           | no                     | Objective print-fitness checks per candidate.                               |
| Style QA            | `StyleQaResult`          | advisory               | Compares against the Page Brief, style bible, and canonical set.            |
| Repair Round        | `auto-style-repair.json` | after bounded stop     | Automatic, maximum two rounds with low-improvement stopping.                |
| Final Disposition   | terminal page state      | for exceptions         | Approved, review, intake rejection, provider failure, or exhausted budget.  |
| Page Output         | approved A4 PNG          | no when both QA pass   | Final printable page for the book.                                          |
| Book Assembly       | PDF/hardcopy             | later                  | Runs only after every required page has an acceptable terminal disposition. |

## Core Loop

```text
PageBrief
   │
   ▼
GenerationRequest
   │
   ▼
Candidate PNG(s)
   │
   ▼
Cleanup
   │
   ▼
Print QA
   │
   ▼
Style QA
   │
   ├── both gates pass ──────► approved
   │
   └── below threshold ──────► Repair Round (maximum 2)
                                  │
                                  ├── both gates pass ─► approved
                                  └── stopped ────────► Human Review
```

## Contract Boundary

```text
PhotoAnalysis      = what is visible in the source photo
PageBrief          = what should be drawn
GenerationRequest  = how to ask a provider to draw it
PageQaResult       = whether a candidate worked
RepairInstruction  = what should change
StyleQaResult      = how a candidate compares with the house style
Repair Round       = one bounded semantic correction attempt
```

## Current QA Layers

```text
Candidate PNG
   │
   ├── deterministic print metrics
   ├── adversarial style review
   └── human QA
```

The adversarial judge is intentionally picky. It looks for style drift, excessive detail, gray shading, clutter, unfriendly faces, and Page Brief mismatch. A Candidate is approved automatically only when it passes both deterministic Print QA and Style QA. Human Review remains available for exceptions, and repair is automatic but bounded to the policy documented in [Coloring Book Pipeline Operations](./coloring-book-pipeline-operations.md).
