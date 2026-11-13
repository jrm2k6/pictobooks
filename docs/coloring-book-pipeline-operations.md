# Coloring Book Pipeline Operations

Last updated: 2026-11-07

This is the current operational description of the implemented Pictobook coloring-page pipeline. The brief, phase, contract, and style-bible documents provide deeper product and artifact context.

## Current End-to-End Flow

```text
Book Run
  -> intake and normalization
  -> photo analysis
     -> rejected / needs_review: terminal intake disposition
     -> accepted: Page Brief
  -> initial generation: 3 candidates
  -> cleanup and Print QA per candidate
  -> Style QA per candidate
  -> select the highest Style QA candidate
     -> same candidate passes Print QA + Style QA: approve automatically
     -> repairable: bounded Repair Round
     -> budget/no-progress stop: Human Review
  -> Human Review only for exceptions or explicit overrides
  -> optional promotion to Canonical Reference
```

Every stage writes inspectable artifacts. A completed photo has a `photo-result.json`; a Book Run has a `run.json`. Resume mode skips any photo with a terminal photo result and rebuilds only incomplete work.

## Generation Inputs

Initial generation uses:

- the normalized Source Photo as the authority for identity, pose, clothing, objects, and scene meaning;
- the Page Brief as the authority for simplification and composition;
- the style bible for written visual constraints;
- three style-only Canonical References.

Generation references are selected deterministically across the ordered canonical catalogue: baseline, middle, and newest. This prevents the oldest pages from monopolizing generation while keeping a stable anchor. The selected review IDs are recorded in `run.json` as `style_reference_ids`.

Style references define visual grammar only. The provider is instructed not to copy their subjects, poses, objects, or backgrounds.

## QA Gates

### Print QA

Print QA evaluates deterministic properties such as page dimensions, black/white output, gray pixels, ink coverage, and printable coloring regions. It does not determine whether a candidate matches the house style.

### Style QA

Style QA compares each candidate against:

- the current style bible;
- the candidate's Page Brief;
- every active Canonical Reference.

It scores line weight and cleanliness, facial vocabulary where applicable, detail density, proportions where applicable, background restraint, coloring-area size, canonical similarity, and Page Brief fidelity.

Current decision bands:

- `>= 0.68`: automatically approved when that same Candidate passes Print QA and no applicable dimension is below `0.55`;
- `0.60` to `< 0.68`: repair or Human Review depending on improvement history;
- `< 0.60`: prefer Source Regeneration;
- critical print, text, anatomy, watermark, or grayscale defects block automatic readiness.

An automatic approval records the exact Candidate and its automatic source. Human Review remains authoritative for exceptions sent to `needs_human_review`; Canonical Reference promotion always requires an explicit approved Review.

## Bounded Automatic Repair

Current repair policy per photo:

- maximum Repair Rounds: `2`;
- candidates per round: `2`;
- maximum candidates from the normal automatic path: `7` (`3` initial plus `2 x 2` repaired);
- acceptance score: `0.68`;
- Source Regeneration preference below: `0.55`;
- minimum useful improvement: `0.04`.

Each round preserves successful traits and converts Style QA drift into concrete corrections. A round writes its generated candidate IDs, source score, resulting best score, improvement, strategy, and completion time to `auto-style-repair.json`.

Automation stops when any of these is true:

- the acceptance policy is met;
- improvement falls below the minimum;
- the maximum round count is reached;
- the page or Book Run budget is exhausted;
- a non-retryable provider or safety failure occurs.

Stopping without acceptance produces `needs_human_review`; it never schedules another Repair Round automatically.

In the local prototype, repair status `ready` means only that the Style QA threshold is met and Print QA is not a hard failure. Production does not use that intermediate state: it transitions directly to `approved` only when the same Candidate has `Print QA = passed` and `Style QA = passed`.

## Production Execution Model

A production Book Run should be a durable job, not one long process and not filesystem state under operating-system temporary storage.

Persist:

- job and page state in the application database;
- photos, candidates, QA results, and snapshots in durable object storage;
- provider request identifiers, attempt counts, costs, and timestamps for auditability;
- the style-bible revision and Canonical Reference IDs used by the run.

Execute each page as an idempotent state machine. A stage claim should use a stable key such as `book_run_id + photo_id + stage + attempt`. Re-delivery may repeat a state-transition check, but it must not silently append a new creative attempt.

The selected production deployment uses Cloudflare Workers, R2, D1, Workflows, and a Container for the existing Node/`sharp` workload. See [ADR 0002](./adr/0002-cloudflare-production-platform.md) and the [Cloudflare Pipeline Implementation Plan](./cloudflare-pipeline-implementation-plan.md). This deployment choice does not change the pipeline states or budgets in this document.

### Separate Retry Budgets

Infrastructure Retries and Repair Rounds are different budgets:

- Infrastructure Retry: maximum `3` attempts per provider operation, exponential backoff with jitter, only for transient network, timeout, `429`, and retryable `5xx` failures.
- Repair Round: maximum `2` rounds per page, only after a completed QA judgment changes the creative instructions.
- Source Regeneration: part of the Repair Round budget unless a reviewer explicitly starts a new manual attempt.

Provider authentication, depleted credits, invalid requests, safety rejection, and other non-retryable `4xx` responses stop immediately. An ambiguous timeout after submission must be reconciled with a provider request or idempotency key before resubmission when the provider supports it.

### Terminal Page States

- `intake_rejected`
- `intake_needs_review`
- `needs_human_review`
- `provider_failed`
- `budget_exhausted`
- `approved`
- `rejected`

Terminal states do not enqueue themselves. Pages passing both gates are automatically `approved`; an explicit reviewer action can approve or reject a `needs_human_review` exception. Restarting other terminal states requires a new versioned Book Run.

## Book-Level Safeguards

- Set a maximum number of generated candidates per page and per Book Run.
- Set a provider-cost ceiling per Book Run before processing starts.
- Cap concurrent provider operations to avoid rate-limit cascades.
- Stop scheduling new pages when billing or provider-health checks fail.
- Allow completed pages to remain available when another page fails.
- Surface partial completion and terminal reasons in the dashboard.
- Never treat an unchanged score or repeated recommendation as permission for another round.

## Known Prototype Gaps Before Production

- WP5 now connects the production Workflow, D1, R2, and image Container with bounded infrastructure retries, semantic repair rounds, and Book Run cost ceilings.
- Production approval requires both QA gates to pass on the same Candidate. The local prototype remains a separate compatibility tool and may use older display vocabulary.
- Generation and Style QA use deterministic mocks in the hosted WP5 proof. The Nano Banana adapter still needs credentials and an ambiguous-timeout reconciliation test before customer use.
- WP6 must add authenticated customer APIs and authorization. WP8 must add provider concurrency controls, operational alerts, and a global kill switch.

## Local Commands

```bash
# Generate and run Print QA, resuming completed photos
pnpm --filter pipeline prototype -- \
  --input-dir samples/book-005 \
  --out ./tmp/book-005 \
  --provider gemini \
  --catalog ./catalog \
  --resume

# Judge visual style
pnpm --filter pipeline style-qa -- \
  --run ./tmp/book-005 \
  --catalog ./catalog

# Run bounded self-correction
pnpm --filter pipeline style-auto-repair -- \
  --run ./tmp/book-005 \
  --catalog ./catalog

# Review results
pnpm --filter pipeline dashboard -- \
  --run ./tmp/book-005 \
  --catalog ./catalog \
  --port 4178
```

Local run artifacts belong under the repository's ignored `tmp/` directory rather than `/tmp`, which macOS may purge between sessions.
