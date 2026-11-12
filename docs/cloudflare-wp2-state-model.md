# WP2: D1 pipeline state model

Status: complete (2026-11-07)

For the complete table catalogue, relationship map, Page state machine, and
data-flow diagrams, see the [D1 schema reference](./cloudflare-d1-schema.md).

## Result

Migration `0002_pipeline_state.sql` introduces the production D1 model for
Books, Book Runs, Source Photos, pages, operations, provider attempts,
Candidates, Artifacts, QA results, Repair Rounds, reviews, Canonical
References, and audit events.

The WP0 tables are preserved as `spike_*` tables during upgrade. The spike
Worker now uses those explicit names, while the canonical names belong to the
production model. No WP0 record is discarded.

## Enforced invariants

D1 constraints and triggers enforce:

1. Automatic `approved` requires the same Candidate to pass Print QA and Style QA.
2. Initial generation cannot create more than three Candidates.
3. A page cannot exceed two Repair Rounds or two Candidates per round.
4. A provider operation cannot exceed three Infrastructure Retries.
5. semantic-attempt and Infrastructure Retry counters cannot be conflated.
6. estimated provider spend cannot cross the Book Run cost ceiling.
7. an Operation ID is unique and its completed outcome is retained for replay.
8. invalid page transitions fail and terminal pages cannot start operations.
9. reviews are append-only, identify one exact Candidate, and allow one
   approval per page.
10. Canonical promotion requires an approved review and records the style-pack
    revision.

Initial Candidate, Repair Round, Infrastructure Retry, and actual-cost counters
are updated by triggers rather than trusted to application bookkeeping.

## Object keys and records

`src/domain/records.ts` defines typed D1 records and state vocabularies.
`src/domain/objectKeys.ts` is the only key-construction Module. It produces the
documented immutable R2 layout and rejects unsafe path segments. WP3 will use
these builders from the R2 Adapter.

## Verification

`pnpm --filter pipeline-cloudflare test` performs both migration paths against
local D1:

- apply all migrations to an empty database;
- apply WP2 directly after the previous WP0 schema;
- exercise all ten state-machine invariants through successful and rejected SQL
  mutations;
- verify deterministic object keys and unsafe-segment rejection.

The test uses temporary local D1 state and deletes it afterward. It does not
touch remote resources.
