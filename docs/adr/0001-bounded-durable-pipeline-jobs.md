---
status: accepted
---

# Run production generation as bounded durable jobs

Production Book Runs will execute as durable, idempotent page state machines. Style repair is automatic, but each page is limited to two Repair Rounds with two candidates per round; transient Infrastructure Retries have a separate maximum of three attempts, and exhausting either budget moves the page to a terminal review or failure state. As amended by [ADR 0003](./0003-automatically-approve-dual-qa-candidates.md), a page becomes `approved` automatically only when the same candidate passes both Print QA and Style QA. This prevents creative drift, duplicate provider charges, infinite retry loops, and style-only acceptance while allowing completed pages to survive individual page or provider failures.

## Considered Options

- An unbounded “repair until passing” loop was rejected because judge scores are non-monotonic and provider calls have real cost.
- A human gate before every repair was rejected because testing showed that bounded repair usually resolves marginal style drift automatically.
- One synchronous process per book was rejected because a single network, billing, or process failure would couple otherwise independent pages.

## Consequences

The production system needs durable page states, idempotent stage keys, separate infrastructure and semantic-attempt counters, per-page and per-book budgets, and explicit terminal reasons visible to reviewers.
