---
status: accepted
---

# Use Cloudflare for production orchestration and storage

Pictobook will use a Cloudflare-native control plane for the production coloring-book pipeline:

- **Workers** expose authenticated APIs and issue short-lived upload and download access.
- **R2** stores Source Photos, normalized photos, generated Candidates, QA artifacts, Canonical References, and final exports.
- **D1** stores queryable product and workflow metadata, including users, books, pages, attempts, approvals, budgets, and R2 object keys.
- **Workflows** orchestrate each durable Book Run and its bounded page state machines.
- **Containers** are the initial execution target for the existing Node.js image-processing code where `sharp`, native dependencies, or sustained CPU work do not fit the Workers runtime.
- **Queues** are optional. Add them only when measured page fan-out, backpressure, or independent consumer scaling requires them.

The existing Node pipeline is an AI-powered workflow, not an autonomous AI agent. Models generate and evaluate artifacts inside a state machine whose allowed transitions, retry budgets, and terminal states are defined by application code.

## Storage boundary

R2 is the authority for immutable or large binary artifacts. D1 is the authority for mutable workflow and product state. Neither a Container filesystem nor a Worker response body is durable state.

Application records store opaque R2 object keys, checksums, sizes, MIME types, schema versions, and provenance. They do not store public object URLs or image blobs. Buckets remain private; API handlers grant time-limited access after authorization.

Inside Workers, use R2 bindings. Node services outside the Workers runtime use R2's S3-compatible API behind an internal storage adapter. Pipeline domain code must depend on that adapter rather than importing an AWS or Cloudflare SDK directly.

## Execution boundary

One Workflow instance represents one Book Run. Page work is independently resumable and idempotent. Workflow steps pass identifiers and small structured results; images and large JSON artifacts are written to R2 before a step completes.

The first production version keeps the proven Node pipeline behavior and moves its filesystem access behind repositories and object storage. Image processing runs in a Container when required. A Worker or Workflow invokes the Container with an idempotent operation identifier; the Container reads inputs from R2, writes outputs to R2, and returns artifact metadata.

Containers are compute, not persistence. Container-local files are scratch data and may be discarded at any time.

## Retry and delivery rules

The retry policy in [ADR 0001](./0001-bounded-durable-pipeline-jobs.md) remains authoritative:

- a transient Infrastructure Retry does not change creative instructions;
- a Repair Round does change creative instructions and consumes the semantic budget;
- normal automation allows at most two Repair Rounds with two Candidates per round;
- as defined by [ADR 0003](./0003-automatically-approve-dual-qa-candidates.md), the same Candidate must pass Print QA and Style QA before becoming automatically `approved`;
- terminal states never schedule more work automatically.

Workflow step retries, Container request retries, and any future Queue redelivery must all reuse the same operation identifier. At-least-once execution must not create extra Candidates or provider charges. A provider request is submitted only after atomically claiming its attempt record; ambiguous provider outcomes are reconciled before another submission.

## CLI and configuration

This repository contains Wrangler configuration for deployable Workers. Use each app's project-local Wrangler version for local development and deployment. Use the Cloudflare `cf` CLI for supported account resource discovery and management. Agents must inspect the target app before acting and must use `cf cli search` rather than translating unfamiliar Wrangler commands from memory.

Cloudflare limits, pricing, and product availability are deployment inputs, not constants in application code. Confirm them against current official documentation during each infrastructure milestone.

## Consequences

- The local pipeline remains useful as the reference implementation and development harness.
- Production code needs explicit storage, metadata, provider, clock, and operation-claim interfaces.
- D1 records must be sufficient to recover a Book Run without listing R2 prefixes.
- R2 object layouts and database schemas must be versioned and migration-safe.
- Human review can read durable artifacts while generation continues on unrelated pages.
- Queues, AI Gateway, Cloudflare Images, and an autonomous Agents SDK runtime are not required for the initial production path.

## References

- [Cloudflare Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/)
- [R2 S3 API compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
- [Cloudflare Containers limits](https://developers.cloudflare.com/containers/platform/limits/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
