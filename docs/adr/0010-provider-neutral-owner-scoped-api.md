---
status: accepted
---

# Use provider-neutral sessions and owner-scoped API access

## Decision

The customer API needed authorization before a login vendor had been selected. We decided to accept opaque bearer sessions, store only their digests, resolve a principal before resource access, and scope every resource query to its owner. An identity provider can issue and revoke sessions without changing pipeline ownership rules.

WP6 adds the customer-facing Worker interface for creating Books and Book Runs,
uploading private source photos, reading run status, reviewing exact Candidate
revisions, requesting regeneration, promoting canonical references, and
obtaining short-lived artifact access.

## Authentication seam

The repository does not yet have a login/account provider. WP6 therefore uses
provider-neutral opaque bearer sessions:

- the client sends `Authorization: Bearer <token>`;
- D1 stores only the token's SHA-256 digest, user ID, expiry, and revocation
  timestamp in `api_sessions`;
- the Worker resolves a `Principal` before calling the pipeline Module;
- every resource query joins back to `books.owner_id`.

An eventual account provider can create and revoke these sessions without
changing the pipeline Module or its ownership rules. WP6 deliberately does not
add a public login or session-issuance endpoint.

## Customer routes

| Method | Route                                                              | Purpose                                                                              |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `POST` | `/v1/books`                                                        | Create an owned draft Book.                                                          |
| `POST` | `/v1/books/{bookId}/runs`                                          | Create a Book Run and one scoped upload intent per source photo.                     |
| `POST` | `/v1/books/{bookId}/runs/{runId}/start`                            | Verify every R2 upload, register immutable Source Artifacts, and start the Workflow. |
| `GET`  | `/v1/books/{bookId}/runs/{runId}`                                  | Read Book, Page, Candidate, QA, repair, and provider-attempt status through D1.      |
| `POST` | `/v1/books/{bookId}/pages/{pageId}/reviews`                        | Append an approval, rejection, or changes-requested decision for an exact Candidate. |
| `POST` | `/v1/books/{bookId}/pages/{pageId}/regenerations`                  | Create and start a new versioned Book Run from the Page's immutable Source Artifact. |
| `POST` | `/v1/books/{bookId}/candidates/{candidateId}/canonical-promotions` | Promote a Candidate backed by an approved human Review.                              |
| `GET`  | `/v1/artifacts/{artifactId}/access`                                | Return a five-minute signed GET URL after owner authorization.                       |

All `/v1` mutations require an `Idempotency-Key` header. Keys are scoped to a
user and may not be reused for a different operation. Resource identifiers are
derived deterministically from the user, operation, and key, and the completed
JSON response is stored in D1. Replays therefore return the same response and
do not duplicate Books, Runs, Reviews, promotions, or regeneration requests.

## Direct private uploads

Book Run creation accepts each photo's MIME type, byte size, and SHA-256 digest.
It returns a 15-minute R2 presigned PUT URL restricted to one immutable object,
with signed content type, length, checksum, and Artifact metadata headers. The
start command refuses to launch until the R2 object matches the upload intent.
The API never returns R2 credentials or a permanent public URL.

Cloudflare documents presigned URLs as bearer access for a single operation on
a single object and recommends short expirations for sensitive content. The
Worker uses `aws4fetch` because an R2 binding cannot itself create presigned
URLs: [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Human review and regeneration

- Reviews are append-only and include the exact `candidate_id`.
- A human approval moves `needs_human_review` to `approved` only after the
  approved Review exists. An already automatically approved Candidate may also
  receive a human Review so it can be promoted canonically.
- Rejection moves a reviewable Page to terminal `rejected`.
- Canonical promotion requires an approved Review, records the exact clean
  Artifact, and allocates a unique style-pack revision.
- Regeneration does not reopen a terminal Page. It creates a new Book Run linked
  through `book_run_regenerations`, reuses the immutable Source Artifact, and
  starts a fresh bounded Workflow and cost ceiling.

## Validation

Worker-runtime tests cover authentication, session expiry, missing idempotency,
mutation replay, cross-user/cross-book denial, upload verification, exact
Candidate approval and rejection, canonical promotion, signed artifact access,
and versioned regeneration.

The hosted preview smoke completed the entire route sequence using real preview
D1, R2, Workflow, and Container resources:

- Book `book-8730fcb4681dd21b6cf8b8e41d5d9507`;
- Book Run `run-89865785df13beac8e9007cc616667d8`;
- direct presigned upload verified and registered as an immutable Source
  Artifact;
- repaired Candidate automatically approved, then explicitly reviewed;
- canonical reference `canonical-da62525582f9f3cff7eff45b700d2ebb`;
- short-lived private Artifact access issued;
- versioned regeneration Run `run-1fdfe516199089ff350c1f5719d12e3f`
  completed successfully.

Run the preview proof with:

```bash
pnpm --filter pipeline-cloudflare smoke:api:preview
```
