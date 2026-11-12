# Coloring Book Prototype Plan

Last updated: 2026-11-03

> Status: implemented and validated locally with Gemini photo analysis, Nano Banana generation, deterministic Print QA, canonical-reference Style QA, bounded automatic repair, resumable photo checkpoints, and a manual review catalogue. See [Coloring Book Pipeline Operations](./coloring-book-pipeline-operations.md) for current behavior.

This document describes the first runnable local prototype for the Pictobook coloring-page pipeline.

## Goal

Build a local CLI that can run the MVP pipeline end to end while saving every intermediate artifact.

The first version may use mock providers. The important outcome is a debuggable loop:

```text
input photo
-> PhotoAnalysis
-> PageBrief
-> GenerationRequest
-> generated or mock A4 PNG
-> cleanup
-> PageQaResult
-> RepairInstruction, if needed
```

## Proposed App

Create a new workspace app:

```text
apps/pipeline/
  package.json
  tsconfig.json
  src/
    cli.ts
    runPrototype.ts
    contracts/
    stages/
    providers/
    style/
    io/
```

Keep it separate from `apps/functions`. The functions app is Cloudflare/Wrangler-oriented, while the pipeline needs local files, image processing, model providers, and heavier dependencies.

## CLI Shape

Single image:

```bash
pnpm --filter pipeline prototype \
  --input ./samples/beach-child.jpg \
  --out ./runs/beach-child-001 \
  --style pictobook-preschool-v0.1 \
  --provider mock
```

Future hosted provider run:

```bash
pnpm --filter pipeline prototype \
  --input ./samples/beach-child.jpg \
  --out ./runs/beach-child-001 \
  --style pictobook-preschool-v0.1 \
  --provider openai \
  --env-file apps/pipeline/.env.development
```

## Provider Harness

The pipeline loads environment files before provider setup. By default it reads:

- `.env`
- `.env.development`
- `apps/pipeline/.env`
- `apps/pipeline/.env.development`

For local provider testing, copy `apps/pipeline/.env.example` to
`apps/pipeline/.env.development` and fill only the provider being tested.

`mock` and `gemini` are implemented providers. The harness accepts hosted
provider names for `openai`, `gemini`, `bfl`, `recraft`, `stability`, and
`adobe_firefly`. Gemini is implemented with Gemini Flash for photo analysis and
Nano Banana for reference-image generation. The other hosted names validate
their required env keys, then stop with a clear adapter-not-implemented error.

Local/open-source models are intentionally out of scope for the MVP provider
experiment. The first real comparisons should use third-party APIs so the team
can learn quality, consistency, cost, latency, and provider constraints without
also owning GPU operations.

## Artifact Layout

Each run should be inspectable without a database:

```text
runs/book-001/
  run.json
  style-bible.snapshot.md
  photos/
    photo-001/
      input.jpg
      normalized.png
      photo-analysis.json
      page-brief.json
      generation-request.json
      candidates/
        candidate-001.png
        candidate-001.cleaned.png
        candidate-001.qa.json
        candidate-001.repair.json
      selected.png
      selected.qa.json
```

## Stage Interfaces

Keep model calls behind small interfaces:

```ts
type VisionProvider = {
  analyzePhoto(input: AnalyzePhotoInput): Promise<PhotoAnalysis>;
};

type ImageProvider = {
  generatePage(input: GenerationRequest): Promise<GeneratedImage>;
};
```

Initial providers:

- `mockVisionProvider`
- `mockImageProvider`

Future providers:

- `openAiVisionProvider`
- `openAiImageProvider`
- `geminiVisionProvider`
- `geminiImageProvider`
- `bflImageProvider`
- `recraftImageProvider`
- `stabilityImageProvider`
- `adobeFireflyImageProvider`

## First Loop

```text
normalize input
-> analyzePhoto
-> createPageBrief
-> createGenerationRequest
-> generate candidate
-> cleanupImage
-> qaPage
-> if failed, createRepairInstruction and retry
-> select best passing candidate or mark failed
```

Defaults:

- candidate count: `3`
- max repair attempts: `2`
- output: A4 PNG, 2480 x 3508
- style: `pictobook-preschool-v0.1`

## QA v0

Start deterministic:

- dimensions are 2480 x 3508
- image is black-and-white after cleanup
- gray pixel ratio is near zero
- black pixel ratio is within expected band
- white pixel ratio is not too low
- small component count is not excessive

Add model-based QA after the artifact loop exists. The first model-based QA layer should be an adversarial style judge that compares each candidate against the `PageBrief`, style bible, and eventually approved reference pages.

## Manual Review Catalogue

The local dashboard supports persistent human review:

```bash
pnpm --filter pipeline dashboard -- \
  --run /tmp/pictobook-style-consistency \
  --catalog ./catalog
```

A reviewer may approve or reject each candidate, add notes, and optionally make
an approved page a canonical style reference. Only one candidate per source
photo remains approved; approving another candidate supersedes the previous
decision without deleting its history.

Reviews are written beside their candidate artifacts as
`candidate_NNN.review.json`. Approved assets are also copied into the versioned
catalogue:

```text
catalog/
  pictobook-preschool-v0.1/
    approved.json
    canonical.json
    pages/
      photo-001-candidate-001-<stable-id>/
        image.png
        source-thumbnail.png
        review.json
```

`approved.json` contains every current approval. `canonical.json` is the
smaller reference set used to define the style for future visual QA. Catalogue
indexes are replaced atomically, and superseded or rejected catalogue records
remain on disk for auditability while disappearing from the active indexes.

## Visual Style QA

Backfill advisory style judgments after canonical references exist:

```bash
pnpm --filter pipeline style-qa -- \
  --run /tmp/pictobook-style-consistency \
  --catalog ./catalog
```

The judge compares every candidate with the style bible, page brief, and
canonical images. A canonical candidate is evaluated leave-one-out so it cannot
compare against itself. Results are stored beside each candidate as
`candidate_NNN.style-qa.json` and shown in the dashboard with their within-photo
rank. Existing results are skipped unless `--force` is provided.

Style QA remains advisory for final human selection, but its calibrated policy
now triggers bounded automatic repair. The current threshold is `0.68`, with a
maximum of two Repair Rounds and two candidates per round. Low improvement or
round exhaustion ends in Human Review rather than another attempt.

Generation uses three Canonical References distributed across the ordered
catalogue (baseline, middle, newest). Style QA compares against the complete
active canonical set.

Generate targeted alternatives without replacing an approved page:

```bash
pnpm --filter pipeline style-retry -- \
  --run /tmp/pictobook-style-consistency \
  --photo photo-005 \
  --candidate candidate_001 \
  --catalog ./catalog \
  --count 2
```

The retry appends new candidate numbers, includes three other canonical pages as
style-only references, and incorporates the source candidate's style-QA drift
and repair recommendation. It writes print and visual style QA for each new
candidate while preserving the current human approval.

## Implementation Notes

- Use `sharp` first for image normalization, thresholding, and simple metrics.
- Keep experimental contracts in `apps/pipeline` until stable.
- Move shared contracts to `packages/shared` only after the shapes stop changing.
- Write every stage input and output as JSON.
- Fail clearly when no candidate passes, while preserving all artifacts.
