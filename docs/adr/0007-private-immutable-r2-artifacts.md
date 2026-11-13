---
status: accepted
---

# Store pipeline artifacts as private immutable R2 objects

## Decision

Pipeline images and other large artifacts need durable storage, integrity checks, and safe replay. We decided to store artifact bytes in private R2, keep metadata and provenance in D1, and reject writes that conflict with an existing immutable artifact identity. This refines the storage boundary in [ADR 0002](./0002-cloudflare-production-platform.md).

## Result

`R2ArtifactStore` is the production Worker-runtime Adapter for immutable
pipeline Artifacts. It uses the `PIPELINE_ARTIFACTS` R2 binding for bytes and
the `PIPELINE_DB` D1 binding for metadata, provenance, retention selection, and
recovery.

No HTTP route exposes the bucket or the Adapter. The Wrangler configuration
contains only a private R2 binding; it does not configure `r2.dev` or a public
custom domain.

## Write protocol

1. Accept the immutable Artifact identity, object key, bytes, content type,
   schema version, retention class, producer, and provenance.
2. Compute SHA-256 with Web Crypto.
3. Look up the Artifact ID or object key in D1. An exact existing record is a
   replay; conflicting immutable metadata or bytes are rejected.
4. Create the R2 object conditionally with `If-None-Match: *`, the SHA-256
   checksum, HTTP content type, and compact custom metadata.
5. If R2 reports that the key already exists, accept it only when its recorded
   SHA-256 matches. This reconciles an identical object left by a previously
   interrupted D1 write.
6. Insert the Artifact and provenance relations through one D1 batch.
7. If D1 fails and no concurrent matching record won the race, delete the newly
   written R2 object as compensation.

An immutable key is never overwritten by this Adapter. Identical replays return
the existing Artifact; different bytes or metadata raise
`ArtifactConflictError`.

## Read and recovery protocol

Reads begin with the Artifact ID in D1, then fetch the exact `object_key` from
R2. Size, MIME type, Artifact ID, schema version, and SHA-256 metadata are
verified before the object is returned. Missing bytes or mismatched metadata
raise `ArtifactIntegrityError`.

Book Run recovery uses `listRunRecords(runId)`, which queries D1 and never lists
an R2 prefix. Provenance comes from `artifact_relations`.

## Deletion and retention hooks

`listRetentionCandidates(retentionClass, createdBefore, limit)` selects bounded
deletion work from D1. `delete(artifactId, deletedAt)` deletes the exact R2 key
and tombstones its D1 record. Repeating deletion is safe.

Bucket-level expiration rules are intentionally not configured yet: product
retention periods and account-deletion policy have not been chosen. When they
are, a deletion job must use these hooks so D1 does not retain active metadata
for an object silently expired by R2.

## Payload boundary

This Worker Adapter accepts an `ArrayBuffer` or view because Web Crypto digest
calculation and single-part R2 checksum validation require known bytes. It is
appropriate for bounded Worker-produced JSON and files. WP4 will give the Node
Container direct R2/S3 access for large image processing so large images are
not buffered through the Worker merely to use this Adapter.

## Verification

`pnpm --filter pipeline-cloudflare test` runs the Adapter inside Cloudflare's
local Workers runtime with isolated R2 and D1 bindings. Tests prove:

- upload, exact-key read, checksum and metadata verification;
- identical replay without another Artifact record;
- rejection of different bytes at an immutable key;
- provenance relations and Book Run recovery through D1;
- detection of R2 metadata drift;
- physical deletion plus a D1 tombstone, including replay;
- retention-candidate selection without R2 listing.

The existing WP2 suite separately proves that the complete migrations apply
from empty and upgrade the WP0 schema.

## Current references

Implementation follows the Cloudflare R2 Workers binding documentation checked
on 2026-11-08, including conditional `put()`, SHA-256 checksums, custom metadata,
and the `null` result for a failed write precondition:

- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Workers Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/)
