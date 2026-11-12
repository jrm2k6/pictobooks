# WP5: Book Run Workflow

WP5 implements the durable production control plane for a Book Run. A single
Cloudflare Workflow owns the Book Run and advances each Page through generation,
Print QA, Style QA, bounded repair, and a terminal state. D1 is authoritative
for state and cost; R2 is authoritative for immutable artifacts. The Node image
Container remains stateless and handles cleanup and Print QA.

## Runtime shape

```text
ProductionBookRunWorkflow
  -> D1: claim operation and enforce state/cost invariants
  -> Gemini image provider: create immutable raw Candidate in R2
  -> page-scoped Container: cleanup Candidate and run Print QA
  -> Gemini Style QA: write immutable assessment to R2
  -> D1: automatically approve the exact Candidate if both gates passed
  -> otherwise: schedule at most two semantic repair rounds
```

Before provider generation, the workflow records the Page's `normalize`
Operation in D1. The Container writes a bounded JPEG derivative (target at most
8 MiB) to R2, then the workflow registers its Artifact against that Operation.
The source derivative is sized for Gemini inline-image requests; the original
Source Photo remains unchanged in R2. Keeping the Operation row ahead of the
Artifact insert satisfies the D1 foreign key and makes normalization replayable.

The Workflow uses one step per Candidate for Container-backed QA. This keeps
retries granular: an already completed Candidate is not processed again when a
later Candidate times out. Container calls have a 90-second client timeout and
their Workflow steps have a three-minute timeout with at most three
infrastructure retries.

The page Container uses Cloudflare's `basic` instance (1/4 vCPU and 1 GiB of
memory). Hosted testing showed that `lite` (1/16 vCPU and 256 MiB) could become
unhealthy after consecutive full-resolution Sharp operations. Sharp's process
cache is disabled and concurrency is one so memory remains bounded within the
page-scoped Container. See Cloudflare's
[current instance-type reference](https://developers.cloudflare.com/containers/platform/limits/).

## Replay and cost safety

- Operation IDs are deterministic from the Page, semantic attempt, and
  Candidate.
- Candidate and Artifact IDs and R2 keys are deterministic and immutable.
- Re-entering a completed operation returns its stored outcome.
- Provider attempts are unique by operation and infrastructure attempt.
- Provider cost is charged only when `actual_cost_micros` changes from `NULL`;
  the D1 trigger adds that cost to the Book Run once.
- The Workflow checks the Book Run ceiling before starting a provider attempt.
- Infrastructure retries do not consume semantic repair rounds.
- Repair is capped at two rounds, and a repair improvement below `0.04` ends in
  `needs_human_review`.

The local runtime tests replay a completed Book Run and assert that Candidate
count, provider-attempt count, and charged cost do not change. They also cover
budget exhaustion and the maximum-repair terminal path.

## Automatic approval

Style QA alone cannot approve a Page. After Style QA, the Workflow selects only
a Candidate having both a passed Print QA result and a passed Style QA result.
It writes that Candidate's exact ID to `pages.approved_candidate_id` with
`approval_source = 'automatic'`. D1 constraints reject an invalid approval.

## Synthetic preview run

The preview-only authenticated endpoint creates a synthetic Book with one to
three Pages and starts the production Workflow binding:

```bash
pnpm --filter pipeline-cloudflare smoke:book-run:preview -- \
  --pages 1 \
  --profile mock_pass_after_repair
```

Available profiles are `mock_pass_initial`, `mock_pass_after_repair`, and
`mock_never_pass`. The default profile proves that the first Style QA fails,
one automatic repair round is generated, and a repaired Candidate is
automatically approved. The command polls for up to twelve minutes because a
cold Container start and full-resolution image processing can be slow.

The endpoints and `SMOKE_TESTS_ENABLED` switch are preview test fixtures, not a
customer API. They require `PICTOBOOK_PREVIEW_SMOKE_TOKEN`; Cloudflare Access
service-token headers are also supported when configured.

### Hosted validation

Preview Book Run `run-8d11f6db-2c08-4a89-86dc-5032f973003a` completed with one
Page, five Candidates, two provider attempts, ten QA results, one repair round,
and an automatically approved repaired Candidate. Its charged cost was 5,000
micros. Restarting the completed Workflow finished in zero seconds; the remote
D1 counts remained five Candidates, two provider attempts, and 5,000 micros.
This proves the hosted replay path does not duplicate Candidates or mock
provider charges.

## What remains deferred

The provider port currently uses deterministic mock generation and Style QA so
the orchestration can be tested without paid credentials. Replacing the mock
with Nano Banana requires provider credentials plus an integration test for
request idempotency/reconciliation after an ambiguous timeout. That test must
prove a replay cannot create a second paid provider job or charge before the
adapter is enabled for customer runs.
