# Coloring Book Pipeline Decisions

Last updated: 2026-11-04

This document tracks product and technical decisions for the Pictobook image-to-coloring-book generation pipeline.

## Product Direction

- Output should support individual printable pages first: PNG and eventually SVG.
- The final product is a hardcopy coloring book.
- Print format is A4 portrait.
- MVP style should be classic kids coloring-book pages: cartoonish, preschool-friendly, and simple without feeling babyish.
- Final artwork must be black-and-white line art only.
- No grayscale shading, hatching, texture, captions, titles, borders, page numbers, or decorative recurring layout elements in the final artwork for MVP.
- Captions/descriptions should exist as internal metadata for QA, evaluation, and future training.
- A cover should be generated in the same style as the interior pages.

## Source Photo Handling

- Users may upload multiple photos at once.
- Expected photos include portraits, pets, family group photos, and vacation scenes.
- The system may reinterpret a photo into a cleaner scene instead of preserving exact composition.
- The system should preserve the key idea of the photo, not every detail.
- Colors from the source photo should be preserved as metadata and used as semantic cues, even though final output is black-and-white.
- Bad source photos may be rejected.
- Rejected photos should be tagged clearly and easy to identify.
- Borderline photos may be marked `needs_review` during MVP so the team can tune what counts as a good or bad source photo.
- `source_uri` should be included in pipeline contracts so generated artifacts can be traced back to source photos.
- The MVP should always use `reinterpret_cleanly`; the source photo is evidence for a simplified coloring-page scene, not a composition to preserve exactly.

Suggested rejection tags:

- `too_blurry`
- `too_dark`
- `too_cluttered`
- `face_occluded`
- `too_many_subjects`
- `unsafe_content`
- `unsupported_format`
- `duplicate`
- `low_resolution`

## Consistency Requirements

Style consistency means all of the following:

- same line thickness
- same level of detail
- same face/character rendering
- same page layout and margins
- same artist style

The MVP should use one universal Pictobook house style:

- classic kids coloring-book cartoon
- medium-bold smooth black outlines
- large closed coloring regions
- sparse backgrounds
- friendly rounded shapes
- clean A4 printable composition
- expressive cartoon faces that are slightly likeness-oriented but still simple

## Character Consistency

Character reference sheets are not required for the first MVP.

The first MVP should avoid full recurring-character identity resolution. Instead, each photo should be transformed independently while preserving visible identity cues from that photo.

The product promise should be style consistency first, with soft per-photo identity preservation.

For MVP:

- Do not require facial recognition.
- Do not require automatic subject clustering across photos.
- Do not require character sheets before page generation.
- Preserve visible subject cues within each photo, such as hairstyle, glasses, face shape, clothing silhouette, pet markings, pose, and important objects.
- Use subject-scoped descriptions for multi-person photos so cues do not become ambiguous.
- Treat character sheets as a post-MVP upgrade if user testing shows identity drift is a major problem.

Family group photos are allowed, but the pipeline should identify primary subjects, simplify incidental/background people, and remove clutter when needed.

If character sheets are introduced after MVP, they should anchor identity across pages through simplified cues such as face shape, hairstyle, glasses, clothing silhouette, pet shape, pet markings, and important accessories.

## Quality Priorities

- Best quality is more important than lowest cost, speed, or easiest implementation.
- Ugly or inconsistent output is worse than output that is less faithful to the source photo.
- Automated review and regeneration loops are acceptable, even if slower.
- Proof approval by a parent is acceptable later, but is not core to the generation pipeline right now.

## Model And Infrastructure Posture

- Hosted third-party APIs are the preferred path for exploration and MVP validation.
- Local/open-source model hosting is out of scope for the MVP provider experiments.
- The first provider experiments should compare OpenAI, Gemini, Black Forest Labs, and Recraft.
- Stability may be useful as a control baseline, and Adobe Firefly may be useful later if commercial-safety posture becomes a primary product concern.
- There are no hard privacy requirements for now, but the pipeline should not paint itself into a corner on child/family-photo handling.
- SVG can come later; high-resolution A4 PNG is the first output target.

## Current Strategic Bet

The product should not primarily be a literal photo-to-edge-tracing system.

The current preferred approach is:

1. Understand the uploaded photos.
2. Extract subject-scoped scene descriptions for each accepted photo.
3. Convert each photo into a simplified page brief.
4. Generate new coloring-book pages from the style bible, style references, and page brief.
5. Clean and validate the result for print.

This separates two hard problems:

- Style consistency: solved through a house style bible, canonical references, QA, and later custom model training if needed.
- Character consistency: treated as a later upgrade through optional user labeling, subject clustering, and character sheets if needed.

## Automation And Production Execution

- Automatic Style QA repair is part of the normal production path.
- Semantic Repair Rounds and transient Infrastructure Retries are separate concepts with separate counters.
- A page receives at most two automatic Repair Rounds with two candidates per round.
- A provider operation receives at most three Infrastructure Retries, only for failures classified as transient.
- Low improvement, exhausted budgets, non-retryable failures, and unmet acceptance thresholds end in explicit terminal states; they never enqueue another automatic round.
- Pages execute independently inside a durable Book Run so one failed page does not discard completed work.
- Production artifacts live in durable object storage and state lives in the application database; operating-system temporary directories are not authoritative storage.
- Human Review can explicitly approve an exception even when Style QA ranks another Candidate higher; ordinary dual-gate passes are approved automatically.
- Cloudflare is the production platform: Workers for the API, R2 for artifacts, D1 for metadata and state, Workflows for durable Book Runs, and Containers for the existing Node/`sharp` processing where required.
- R2 is authoritative for binary and large immutable artifacts; D1 is authoritative for mutable workflow and product state.
- The pipeline is an AI-powered workflow rather than an autonomous AI agent. Model outputs cannot expand retry budgets or invent state transitions.
- Queues are deferred until measured fan-out or backpressure requirements justify the additional delivery boundary.

See [Coloring Book Pipeline Operations](./coloring-book-pipeline-operations.md), [ADR 0001](./adr/0001-bounded-durable-pipeline-jobs.md), [ADR 0002](./adr/0002-cloudflare-production-platform.md), and the [Cloudflare Pipeline Implementation Plan](./cloudflare-pipeline-implementation-plan.md).
