# Candidate review and preview steps — design

- **Status:** Revising per feedback
- **Scope:** `apps/web`, plus three backend changes in
  `apps/pipeline-cloudflare`: the per-book regeneration cap, the
  intake-rejection fix (landed via a parallel investigation, not yet
  merged — see Constraint 7), and now a real photo-replacement endpoint
  (see "Photo replacement" below) — the user chose to build real
  recovery from intake rejection rather than ship a dead-end
  contact-support state for it. This is no longer a small backend
  footnote; it's a real piece of new API surface, on the same footing
  as the rest of this doc.
- **Author's note:** written after two throwaway UI spikes
  (`PageReviewSequentialScreen.jsx`, `PageReviewGridScreen.jsx`) that the user
  compared and picked a direction from. Those spikes stay dev-only prototype
  code; nothing from them is reused by reference, only by visual pattern.

## Intent and why

Today `processing-page.jsx` redirects straight to `/books` once a run
completes. There is no step where the customer looks at the generated
candidate for each page and decides whether to keep it, ask for another
version, or discard it. `docs/customer-api-local-implementation-handoff.md`
flagged this as the main gap between the wired book/run flow and a
sellable product: nothing stops a customer from reaching checkout with a
page they never actually approved.

This design adds both of those steps: a real, API-wired review screen
between `/books/new/creating` and a real preview screen, ending at the
(separately gapped, still out of scope) edition/checkout flow.

## Goals

- Every page in a run gets an explicit customer decision before the
  customer can continue past review.
- A customer can ask for a new version of any page and see it update in
  place once ready, without losing their place.
- The screen reflects true backend state (`reviewCandidate`,
  `regeneratePage`), not local-only mock state.
- A customer who's reviewed every page can see the finished book as a
  real spread — not just a checklist — before moving on to choosing a
  format.
- Regeneration is capped per book per customer; past the cap, the
  customer is pointed at support instead of a dead-end retry button.
- A customer whose photo itself couldn't be used (intake rejection) can
  upload a different one and keep going, instead of hitting a dead end
  — capped the same way, but on its own separate budget.

## Non-goals

- Edition selection and checkout screens — tracked separately, already
  gapped in the handoff doc. Preview's forward action ("Choose an
  edition") is a placeholder navigate target, same way review's
  "Continue" used to be before preview was pulled into this scope.
- Collecting free-text reviewer notes in the UI (the API supports
  `notes`; wiring a text field is a small follow-up, not blocking this).
- Any backend/API change beyond the ones named in this doc (the
  regeneration cap, the intake-rejection fix, the photo-replacement
  endpoint and lineage field). If something else is missing API-side,
  this doc says so and treats it as a known limitation, not something
  to patch here.

## Anti-goals

- A screen that _looks_ done but silently drops a customer's decision on
  reload (see "Surviving a reload" below — this is the part most likely
  to be gotten wrong).
- Blocking "Continue" on a page the customer has no way to resolve.
- A "Try again" button that's still clickable after the cap is reached
  and just produces a server error instead of pointing the customer at
  support.

## Constraints found during recon

These come directly from `apps/pipeline-cloudflare/src/api/pipelineApi.ts`
and shape most of the "how" below:

1. **`regeneratePage` doesn't patch a page — it creates a new run and a
   new page** (`pipelineApi.ts:778-900`). The response is
   `{ bookId, sourcePageId, runId, pageId }` for the _new_ run/page, and
   `this.launcher.start(runId)` kicks off async generation exactly like
   the original book run. The client must poll this new run the same way
   `processing-page.jsx` polls the original one.
2. **`getBookRun` is scoped to one `runId`** (`pipelineApi.ts:557-651`).
   There is no endpoint that resolves "the current page for photo N
   across all its regenerations." The response does include each photo's
   `sourceArtifactId`, which _is_ stable across regenerations (the new
   photo row is a fresh `photoId` pointing at the same
   `sourceArtifactId`). That's the only cross-run join key available.
3. **`reviewCandidate`'s decision guard is asymmetric**
   (`pipelineApi.ts:671-751`):
   - `approved` is allowed from state `approved` or `needs_human_review`.
   - `rejected` is allowed **only** from `needs_human_review`, and is
     terminal — there is no transition back out of `rejected`.
   - `changes_requested` doesn't change page state at all; it only logs
     feedback (read later by `regeneratePage` via
     `collectRegenerationFeedback`).
   - So a page auto-approved by QA (`state: "approved"`) never reaches
     `rejected` directly — only a page already flagged
     `needs_human_review` can be.
   - **What `needs_human_review` actually means**: it is a _generation
     QA_ outcome, not a judgment about the source photo. `decideStyleQa`
     (`bookRun.ts:1061-1130`) is the only code path that sets it, and it
     fires when, after up to `MAX_REPAIR_ROUNDS` generation attempts, no
     candidate ever came back both print-QA-passed and style-QA-passed.
     "Try again" on a `needs_human_review` page always regenerates from
     the _same_ source photo (`regeneratePage` reuses
     `source.source_artifact_id`) — a reasonable remedy when the problem
     is generation quality, but not when the problem is the photo
     itself. See item 7 below.
4. **`createOrder` is `planned`, not implemented** (confirmed in
   `docs/customer-screen-api-map.yaml`). There is no checkout-side
   validation today that would ever stop a `rejected` page from reaching
   an order. That enforcement has to live in this review step, since
   it's the only place that currently exists to put it.
5. **`listBookRuns` (`pipelineApi.ts:238-252`) is the one endpoint in the
   file that returns raw D1 column names** — `run_id`, `created_at`,
   etc. — unlike every other endpoint here, which maps to camelCase.
   It's also already `ORDER BY created_at DESC`, so no client-side
   sorting is needed. The new `api-client.js` method for it maps fields
   to camelCase itself (the one place in the client that has to know
   about this inconsistency), so every hook above it only ever sees
   camelCase, matching the rest of the app.
6. **No field in `getBookRun`'s candidate payload identifies "the"
   candidate for a `needs_human_review` page**, nor is `ordinal` exposed
   per candidate (`pipelineApi.ts:590-629`). The server's own
   best-candidate selection (`bookRun.ts:1068-1074`, `:1239-1243`) uses
   `ORDER BY overall_score DESC, ordinal ASC`. The client can't see
   `ordinal`, but it can see `styleQa.score`, so the detail view picks
   the candidate with the highest `styleQa.score` (ties broken by array
   order, since exact tie-break parity with the server isn't observable
   from this response). This only matters when two candidates for the
   same page tie exactly on style score, which should be rare.
7. **Intake-level rejection (the photo itself being unusable — too dark,
   blurry, wrong format) is real, distinct from `needs_human_review`/
   `rejected`, and — as of a parallel fix, not yet merged to `main` —
   now actually reaches the customer API.** Resolved by investigation:
   - The states were fully scaffolded in the schema
     (`migrations/0002_pipeline_state.sql`: `pages.state` CHECK,
     `photos.intake_status` CHECK, the `pages_state_transition_guard`
     trigger) but never implemented — `acceptPage` unconditionally
     advanced every page past intake with no analysis ever run.
   - The actual detection logic already existed, just in the wrong
     app: `apps/pipeline` (a separate local Node CLI prototype) already
     has a working Gemini-vision photo-intake classifier
     (`accepted`/`rejected`/`needs_review`, with a `RejectionReason`
     taxonomy like `too_blurry`/`too_dark`). That's almost certainly
     what was seen rejecting photos during testing — "the pipeline" in
     that observation was this sibling app, not the Worker.
   - The fix ports that same logic into `apps/pipeline-cloudflare`
     (`geminiImageProvider.ts`'s new `analyzeGeminiPhotoIntake()`,
     called from `bookRun.ts`'s `acceptPage`), gated on
     `run.provider === "gemini"` so mock/synthetic test runs are
     unaffected. A rejected/needs-review photo now stops at
     `intake_rejected`/`intake_needs_review` with a `terminal_reason`,
     before generation ever starts. `getBookRun` now also returns
     `page.terminalReason` (e.g. `"too_dark"`) and
     `photos[].intakeStatus`, neither of which existed before.
   - **What does not exist, backend or otherwise: any customer-facing
     way to recover from this.** `intake_rejected`/`intake_needs_review`
     are terminal — the run just stops progressing that page
     (`books.status` becomes `review`, same as any partial completion).
     There's no equivalent of `regeneratePage` for "here's a different
     photo for this same slot, try again." Building that is a new
     feature, not something assumed to exist here.
   - Also not handled: intake analysis isn't cost-tracked (no
     `intake_cost_micros` in `book_run_execution_configs`), so it
     doesn't count against a run's `cost_ceiling_micros`. Out of scope
     for this doc; noted for whoever picks up billing/budget work.
   - **This is committed locally only, on its own branch, not yet
     merged** — the review screen's design below assumes it lands, but
     that's a separate decision (does the user want it reviewed/merged
     as-is, as its own PR, before or alongside this work).

   This leaves one real open question for this design: given there is
   no self-service remedy today, what should the review screen actually
   do when a page lands in `intake_rejected`/`intake_needs_review`? See
   the new table row and the question below.

## The one open design question, resolved

Asked the user whether a page can be dropped from the book entirely.
Answer: if a page is ever marked `rejected`, the customer must end up
with a real replacement for it — a `rejected` page can't just sit there
and let the customer proceed anyway.

Given constraint 3 (`rejected` is one-way, and the backend has no
"delete this page" operation), the only path forward for a rejected page
_is_ a regeneration — a new page for the same photo. So the design
never leaves `rejected` as a resting state on screen: the UI always
pairs a reject-style decision with an immediate `regeneratePage` call,
and "Continue" is gated on **no page being `rejected` without a newer
replacement already in flight or kept**. There's no separate "remove
this page from the book" feature to build — rejecting _is_ requesting a
replacement.

That pairing can itself fail halfway (the reject goes through, the
follow-up `regeneratePage` doesn't). Since `reviewCandidate` can't be
called again on an already-`rejected` page, the design can't just
"retry the whole pair" — see the dedicated `rejected, no replacement in
flight` row in the action table below, which is what actually keeps
this invariant true rather than just asserting it.

## Two separate caps: 3 regenerations and 3 photo replacements, per book per customer

Both `regeneratePage` and the photo-replacement endpoint below are real
generation cost, not a free retry — but they're deliberately **separate
budgets**: a run of bad luck on photo quality (intake rejections)
shouldn't eat into a customer's budget for asking for a better-looking
_generated_ page, and vice versa. Each caps at 3, independently.

Enforced in both places for each, so they're real limits and not just a
UI nudge:

- **Backend** (`apps/pipeline-cloudflare`): both `regeneratePage` and
  the new photo-replacement endpoint write one row to
  `book_run_regenerations` per call (`pipelineApi.ts:874-887` for the
  former), distinguished by the `kind` column added in "Photo
  replacement" below (`'candidate_regeneration'` vs
  `'photo_replacement'`). Each endpoint counts only its **own** `kind`
  for `(bookId, requested_by: principal.userId)` before doing any insert
  work; at 3, it throws its own distinct error —
  `ApiProblem(403, "regeneration_limit_reached")` for `regeneratePage`,
  `ApiProblem(403, "photo_replacement_limit_reached")` for the
  replacement endpoint — instead of creating a new run. Additive: no
  existing behavior changes for the first 3 calls of either kind.
- **Client**: counting by kind means `listBookRuns` alone isn't enough
  (it has no `kind` column — that only exists on
  `book_run_regenerations`, a different table). Rather than add a
  second endpoint just to expose it, `getBookRun` gains one more
  run-level field, `regenerationKind` (nullable), read the same way
  `replacesPageId` is (a join on `new_run_id = run.run_id`) — and since
  the reconciliation in "Key mechanism" below already fetches
  `getBookRun` for every non-primary run, tallying
  `regenerationsUsed`/`replacementsUsed` by this field is free, no
  extra requests. The grid disables "Try again" once
  `regenerationsUsed` reaches 3, and "Upload a different photo" once
  `replacementsUsed` reaches 3 — independently — showing the matching
  contact-support treatment _before_ the customer can even trigger the 403. The backend check is the real guard; the client check just keeps
  the buttons honest.

Both are per-book, all-pages-combined caps (3 total of each kind across
the whole book), not 3 per individual page.

Each cap can collide with its own "must always get resolved" rule: if
the regeneration cap is reached while a page is `rejected` with no
replacement in flight, or the replacement cap is reached while a page
is `intake_rejected`/`intake_needs_review` with no photo re-upload in
flight, the customer has no self-service way to resolve that specific
page, so `canContinue` correctly stays `false`. That's the intended
outcome for each, not a bug to design around — it's exactly the case
each contact-support banner exists for; resolving it from there is a
support action (outside this book's customer-facing caps), not
something this screen needs to solve.

## Photo replacement (intake rejection recovery)

The user chose to build a real recovery path rather than ship
`intake_rejected`/`intake_needs_review` as a dead end. There is no
existing endpoint for "swap this page's photo," so this is new backend
surface, designed by mirroring the upload flow `createBookRun` /
`startBookRun` already use (`pipelineApi.ts:343-494`, `:496-555`) —
not invented from scratch.

### Backend: a new endpoint, reusing `startBookRun` for the second half

- **`POST /v1/books/:bookId/pages/:pageId/photo-replacements`** — input
  `{ contentType, byteSize, sha256 }` (the same shape as one entry of
  `createBookRun`'s `photos` array). Only valid when the target page is
  `intake_rejected` or `intake_needs_review`.
  - Creates a new one-photo run (`run_id`, `book_run_execution_configs`
    row), a new `photos` row with `source_artifact_id = NULL` and
    `intake_status = 'pending'` (this is a genuinely new upload, so it
    follows `createBookRun`'s pattern here, not `regeneratePage`'s
    reuse-the-existing-artifact pattern), a new `upload_intents` row,
    and signs it (`signIntent`) exactly like `createBookRun` does per
    photo.
  - Records lineage back to the rejected page — see below.
  - Returns `{ bookId, runId, pageId, sourcePageId, upload }`: the
    `upload` shape matches one entry of `createBookRun`'s `uploads`
    array, and `sourcePageId` mirrors `regeneratePage`'s response shape
    so the client's existing "a mutation response tells you what this
    new run/page replaces" pattern needs no special case.
  - **Does not start the run itself** — unlike `regeneratePage`, the
    photo hasn't been uploaded yet at this point.
- **Client then does what `photo-selection-page.jsx` already does**:
  `api.uploadPhoto(upload.uploadUrl, upload.requiredHeaders, file)`
  (direct PUT, existing method, `api-client.js:140-149`), then calls
  the **already-existing** `startBookRun(bookId, runId)` — reused
  as-is, no changes needed there. It already does exactly what's
  needed next: verifies the upload landed in R2, registers the
  artifact, sets `photos.source_artifact_id`, and calls
  `this.launcher.start(runId)`, which runs intake analysis (now real,
  per Constraint 7) and then generation, same as any other run.
- A replaced photo can itself fail intake again. That's not a new case
  to design for — it's the same `intake_rejected`/`intake_needs_review`
  state, on the new page, handled the same way (including the cap
  below).

### Lineage: one mechanism for both regeneration and photo replacement

Recording "new run X replaces page Y" already happens for regenerations
(`book_run_regenerations`, `pipelineApi.ts:874-887`) but was never
queryable via the API — the design's original reconciliation (see
"Key mechanism" below) worked around that by matching `sourceArtifactId`
across runs. **Photo replacement breaks that workaround**: a replacement
photo is a deliberately _different_ artifact for the same page slot, so
there is no shared `sourceArtifactId` to match on.

Rather than build two reconciliation mechanisms (the `sourceArtifactId`
guess for regenerations, something else entirely for replacements),
this adds one small, unifying backend change while already touching
this code:

- A migration adds a `kind` column to `book_run_regenerations`
  (`'candidate_regeneration' | 'photo_replacement'`, defaulting to
  `'candidate_regeneration'` for existing rows), and the new endpoint
  above inserts a `'photo_replacement'` row the same way
  `regeneratePage` inserts a `'candidate_regeneration'` one.
- `getBookRun` gains one new field per page: `replacesPageId` (nullable),
  populated by joining `book_run_regenerations` on
  `new_run_id = run.run_id`. Every page belonging to a regeneration or
  replacement run traces back to exactly one source page this way.
- This **replaces** the `sourceArtifactId`-matching approach in "Key
  mechanism" below for reload recovery — the client now has an explicit,
  server-confirmed pointer instead of an inferred one, for both
  regenerations and replacements alike. `sourceArtifactId` is no longer
  load-bearing for this design.

### Review screen's action-table row for this state

(Replacing the earlier "pending decision" placeholder. Uses its own
`replacementsUsed` cap, separate from the regeneration cap — see "Two
separate caps" above.)

| Page state                                                                 | Actions shown            | API calls                                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `intake_rejected` / `intake_needs_review`, replacement cap not reached     | Upload a different photo | New endpoint above, then the existing `uploadPhoto` + `startBookRun`. Shows `terminalReason` (e.g. "This photo was too dark to use") as the explanation. No "keep anyway" option — there is no candidate to keep, since generation never ran for this photo. |
| `intake_rejected` / `intake_needs_review`, replacement cap already reached | Contact support          | None — its own book-wide banner, independent of the regeneration-cap banner.                                                                                                                                                                                 |

## Approach: grid hub + inline detail (chosen)

Confirmed with the user after comparing both spikes: a grid of all pages
is the landing view (overview, lets the customer see which pages still
need a decision), and opening a page reviews it in a focused detail
panel — functionally the single-page reviewer from Option 1, reached by
drilling in rather than being the default. One route, one component;
the detail view is UI state, not a second page.

- **Grid**: one card per page, thumbnail + status pill (`Ready to keep`,
  `Needs a change`, `Making a new version…`, `Kept`). Click opens detail.
- **Detail**: candidate image, compare-with-source toggle, and the
  decision actions for that page's state (below). "Back to all pages"
  returns to the grid.
- **Continue** button lives on the grid, disabled until every page is
  resolved (see gating rule above).

### Decision actions per page state

| Page state                                                                                                                                                                                                                | Actions shown                                                                                                                                                                                                               | API calls                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `approved` (auto-passed QA)                                                                                                                                                                                               | Keep · Try another version                                                                                                                                                                                                  | Keep → `reviewCandidate(approved)`. Try another → `regeneratePage` (no `rejected`; this page was never flagged, so a straight retry is enough).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `needs_human_review` (QA flagged it)                                                                                                                                                                                      | Use this page anyway · Try again                                                                                                                                                                                            | Use anyway → `reviewCandidate(approved)`. Try again → `reviewCandidate(rejected)` immediately followed by `regeneratePage`, so the reject is never left unresolved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `rejected`, replacement already in flight or kept                                                                                                                                                                         | none — shows "Making a new version…" (or the replacement's own state, once it loads)                                                                                                                                        | — (this page-slot is now tracked by its replacement run; see below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `rejected`, **no replacement in flight** (the paired `regeneratePage` call after a reject never went through — network drop, idempotency conflict, provider unavailable)                                                  | Try again                                                                                                                                                                                                                   | `regeneratePage` **only** — never `reviewCandidate` again. `reviewCandidate(rejected)` is one-way (constraint 3); a page already in `rejected` state will 409 (`page_not_reviewable`) if `reviewCandidate` is called on it a second time. The hook must distinguish "rejected, nothing pending" from "rejected, replacement pending" by checking whether this slot's pointer (below) already moved past the rejected page, not by trying the call and catching the error.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| New page from a regeneration, still generating                                                                                                                                                                            | none — shows "Making a new version…"                                                                                                                                                                                        | Poll via `useBookRun(bookId, newRunId)`. **Do not** reuse `use-book-run.js`'s `ACTIVE_STATUSES` set to decide the card's own state — `processing-page.jsx` already had to work around that set for exactly this reason: it calls `partially_completed` "active" at the run level, but that's the _normal_ terminal outcome for a single-page regeneration run whose page didn't cleanly approve (`processing-page.jsx:7,24` defines its own local `TERMINAL_COMPLETE = {"completed","partially_completed"}` instead, for the same reason). So: stop treating the sub-run as "in flight" once its `status` is `completed` or `partially_completed` (reuse that same two-value set, not `ACTIVE_STATUSES`), and once it's stopped, read the _page's_ own `state` inside that run's response to decide which other row in this table applies (`needs_human_review`, `provider_failed`, `budget_exhausted`, `intake_rejected`, etc.) — the run-level status only tells you whether to keep polling, never what to show. |
| New page from a regeneration lands in a failure terminal state (`provider_failed`, `budget_exhausted` — both real outcomes of `regeneratePage`/`assertGenerationProviderAvailable`, per `bookRun.ts`'s `isTerminal` list) | Try again · Contact support                                                                                                                                                                                                 | Try again → `regeneratePage` once more for the same slot, **only if the cap below isn't already reached**. Same visual treatment as the existing `generation-error` prototype screen (`screenCatalog.js`: "A page could not be made," retry scoped to one page, no stack trace) — this state reuses that pattern rather than inventing a new one.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Book-wide regeneration cap reached (3 `regeneratePage` calls already used on this book)                                                                                                                                   | Contact support only — every "Try again" across every QA-flagged/failed page becomes this, regardless of that page's own state                                                                                              | None. The grid shows a persistent banner ("You've used all 3 free revisions for this book — our team can help with anything that still needs a change") rather than per-card messaging — book-wide, not per-page. Does **not** affect the separate photo-replacement cap below.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `intake_rejected` / `intake_needs_review` (the source photo itself couldn't be used — too dark, too blurry, etc.; no candidate was ever generated for this slot)                                                          | See the dedicated "Photo replacement" section above — this is new API surface, not a reuse of `reviewCandidate`/`regeneratePage`, and it has its own separate 3-replacement cap, independent of the regeneration cap above. |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Key mechanism: resolving "the current page" across runs

Because a regeneration or photo replacement lives in its own run, the
review screen can't just render `getBookRun(bookId, runId).pages` for a
single `runId` once either has happened. The screen tracks, per **page
slot**, keyed by `replacesPageId`'s chain back to an original page id
(the explicit, server-confirmed lineage field added in "Photo
replacement" above — this is what made `sourceArtifactId` matching
unnecessary; a photo replacement has no shared `sourceArtifactId` with
what it replaces, so the explicit field is the only mechanism that
actually works for both cases):

1. Start from the run the customer arrived from (the `runId` passed in
   from `/books/new/creating`) — call it the primary run. Its pages
   have `replacesPageId: null`; they _are_ the original slots.
2. Whenever `regeneratePage` or the photo-replacement endpoint returns
   `{ runId: newRunId, pageId: newPageId, sourcePageId }`, that slot's
   "current" pointer moves to `(newRunId, newPageId)`. The hook holds a
   `{ originalPageId → { runId, pageId } }` map and begins polling
   `newRunId` via `useBookRun` alongside the primary run.
3. The grid renders one card per slot, always from whichever run is
   currently pointed at for that slot.

### Surviving a reload

If the customer reloads mid-review, the in-memory pointer map above is
gone. Rebuilding it no longer requires guessing: fetch
`listBookRuns(bookId)` (already implemented server-side per
`docs/customer-screen-api-map.yaml`, just not yet wired to a hook),
fetch `getBookRun` for each run newer than the primary one, and follow
each page's `replacesPageId` back to its original slot — if a chain is
more than one hop long (replaced, then regenerated again), follow it to
the end. Book-level regeneration/replacement count is expected to be
small (the 3-per-book cap bounds it), so fetching a few extra run
details is cheap.

This reconciliation is real logic even with an explicit field to follow
(it still has to walk a graph and fetch several runs) — it's the one
piece of this design that most warrants being written once as a
well-tested pure function (`{ primaryRun, otherRuns } → pageSlot[]`)
rather than inlined in the hook, so it can be unit tested without
mocking the network.

## Routes and components

- **Route**: `/books/new/pages`, added to `app.jsx` right after
  `/books/new/creating`'s `ProcessingPage`. `ProcessingPage`'s redirect
  (`processing-page.jsx:25`) changes from `navigate({ to: "/books" })` to
  `navigate({ to: "/books/new/pages", search: { runId } })` on terminal
  complete status.
- **Component**: `apps/web/pages/page-review-page.jsx` (+
  `page-review-page.module.css`), following the existing
  `*-page.jsx` / `.module.css` pair convention used by
  `processing-page.jsx` and siblings. **Not** wrapped in
  `wizard-shell.jsx`: that shell hardcodes `TOTAL_STEPS = 4` and labels
  itself "Step N of 4 · Create your book" (`wizard-shell.jsx:5-34`), and
  review happens after the book is created, not as a fifth step of that
  same intake wizard. Uses the shared `AppShell` directly instead,
  matching how the other non-stepped screens (e.g. `BooksPage`) are
  structured.
- `Continue` navigates to the new `/books/new/preview` route (below)
  once unblocked.
- `docs/customer-screen-api-map.yaml` gets updated to replace the
  `review` / `needs-attention` two-screen split with this single
  grid+detail screen at `/books/new/pages`, since that's now the real
  shape.

### Preview screen (pulled into this scope per feedback)

The existing dev-prototype reference, `apps/web/screens/BookPreviewScreen.jsx`,
shows a two-page spread with prev/next controls, a book-facts sidebar,
"Choose an edition" (forward) and "Back to page review" (back). It also
renders a fake cover using a landing-page hero image — the real book
model has no cover concept (`getBookRun`'s `pages` are exactly the
reviewed content pages, nothing else), so the real screen drops the
fake cover and just spreads the reviewed pages two at a time, starting
from page 1.

- **Route**: `/books/new/preview`, added right after `/books/new/pages`.
- **Component**: `apps/web/pages/book-preview-page.jsx` (+
  `.module.css`), same conventions as the review page — not wrapped in
  `wizard-shell.jsx`, for the same step-count reason given above.
- **Data**: this screen is read-only (no decisions, no mutations) and
  needs exactly the same resolved "current page per slot" list the
  review screen already builds. Rather than recompute it, the page-slot
  reconciliation (below) is factored out of `use-page-review.js` into
  its own hook, `use-book-pages.js`, that both the review and preview
  pages call. By the time a customer reaches preview, `canContinue` was
  already `true` on review, so every slot here should resolve to an
  `approved` page — preview doesn't need its own version of the
  decision-state handling review has.
- **Forward action**: "Choose an edition" — edition/checkout don't
  exist yet, so this is the `TODO`-marked placeholder navigate target
  now (moved here from where it used to sit on review's `Continue`).
- **Back action**: "Back to page review" → `/books/new/pages`.
- `docs/customer-screen-api-map.yaml`'s existing `preview` entry gets
  updated to point at this real component/route and drop the fake-cover
  behavior note.

## Hooks and API client additions

`apps/web/api-client.js` gets five new methods, following the existing
`request(...)` pattern already in that file:

- `listBookRuns(bookId)` → `GET /v1/books/:bookId/runs`
- `reviewCandidate(bookId, pageId, { candidateId, decision, notes })` →
  `POST .../pages/:pageId/reviews` (`withIdempotency: true`)
- `regeneratePage(bookId, pageId)` →
  `POST .../pages/:pageId/regenerations` (`withIdempotency: true`)
- `createPhotoReplacement(bookId, pageId, { contentType, byteSize, sha256 })` →
  `POST .../pages/:pageId/photo-replacements` (`withIdempotency: true`),
  returning `{ runId, pageId, sourcePageId, upload }`. The caller still
  has to do the actual upload (`uploadPhoto`, already exists) and then
  `startBookRun(bookId, runId)` (already exists, no change needed) —
  same two-step shape `photo-selection-page.jsx` already uses for the
  initial upload, just scoped to one photo.
- `getArtifactAccess(artifactId)` → `GET /v1/artifacts/:id/access`
  (needed for candidate/source images; recall from the earlier handoff
  work that this returns a URL that _still_ requires the Bearer token,
  not a plain public URL — the `<img>` tag can't just point at it
  directly, so this needs the same authenticated-fetch-then-blob-URL
  pattern used wherever artifacts are already displayed, if one exists,
  or a new small one if not)

New hooks in `apps/web/hooks/`, mirroring `use-book-run.js`'s style
(plain function, `useApiClient()`, redirect to `/sign-in` on
`UnauthorizedError`):

- `use-book-pages.js` — owns the page-slot reconciliation (above) and
  the regeneration-count-so-far derived from `listBookRuns`. Returns the
  resolved `pages` list plus `regenerationsUsed`/`regenerationsRemaining`
  and `replacementsUsed`/`replacementsRemaining` as two separate pairs.
  Used by both the review and preview pages.
- `use-page-review.js` — review-screen-only: wraps `use-book-pages.js`
  and adds `{ reviewCandidate, regeneratePage, replacePhoto, canContinue }`.
  **`canContinue` is defined as "every slot's current pointer resolves
  to an `approved` page" — not as a list of which states block it.**
  Define it the positive way, not as "anything except `rejected`": an
  un-replaced `intake_rejected`/`intake_needs_review` page is exactly as
  unresolved as an un-replaced `rejected` one (the doc's own goal is
  "every page gets an explicit decision before continuing"), and a
  state-exclusion list is the kind of thing that quietly stops covering
  a new terminal state the next time one gets added. `replacePhoto(pageId, file)` does the full
  three-step sequence (`createPhotoReplacement` → `uploadPhoto` →
  `startBookRun`), reusing the same client-side `sha256Hex(file)` helper
  `photo-selection-page.jsx` already has rather than duplicating it —
  worth pulling that helper into a shared location rather than copying
  it a second time.
- `use-review-candidate-mutation.js` / `use-regenerate-page-mutation.js` —
  thin `useMutation` wrappers, invalidating query keys per
  `docs/customer-screen-api-map.yaml`'s existing `invalidateAfterMutation`
  table (`reviewCandidate` → `[[books], [book-run, bookId, runId]]`;
  `regeneratePage` → `[[books], [book-runs, bookId], [book-run, bookId, runId]]`).
  `regeneratePage`'s wrapper also surfaces the new `regeneration_limit_reached`
  error distinctly, so the UI can show the contact-support banner
  instead of a generic error toast.
- `use-artifact-access.js` — fetch-and-cache the authenticated image URL
  per artifact.

Splitting `use-book-pages.js` out from `use-page-review.js` is what
lets the preview screen reuse the reconciliation logic without either
duplicating it or dragging review's mutation/decision machinery along
for a screen that never needs it.

## What's left to the builder

- Exact shape of the page-slot reconciliation function's unit tests.
- Whether `getArtifactAccess` results need their own cache/hook or can
  reuse something already built elsewhere in `apps/web` for displaying
  artifacts (check before adding a second mechanism).
- CSS for the real screen — the grid spike's `storybook.css` classes
  (`.candidate-grid`, `.candidate-card`, etc.) are a fine visual
  starting point but are dev-prototype styles; the real page gets its
  own `.module.css` per convention.
- Loading/empty states while the primary run's `listBookRuns` /
  reconciliation fetch is in flight.
- Exact copy for the cap-reached banner and the contact-support link
  destination (existing support channel, if `apps/web` already has
  one).
- Spread layout for preview when the page count is odd (last spread has
  one page, not two) — the prototype's fake-cover math doesn't apply
  once the cover is dropped.
- Exact migration numbering/naming for the `book_run_regenerations.kind`
  column.
- Client-side file validation for the replacement-photo upload (size,
  type) — mirror what `photo-selection-page.jsx` already does rather
  than inventing new rules.
- Whether to merge the landed-but-unmerged intake-rejection fix (its own
  branch/commit, per Constraint 7) as a standalone PR before this work
  builds on it, or bring it in as part of the same change — a sequencing
  question for whoever picks this up, not a design question.

## Out of scope / known limitations carried forward

- No edition or checkout route exists yet; preview's "Choose an
  edition" destination is a placeholder.
- Reviewer notes aren't collected in this pass (API supports them).
- If a page is regenerated or replaced more than once in the same
  session, the slot pointer always moves to the newest run — there's no
  UI for reviewing that history.
- Intake-analysis cost isn't tracked against a run's budget (no
  `intake_cost_micros` field exists) — flagged by the investigation,
  not fixed here; billing/budget treatment of intake analysis and photo
  replacement is a separate decision.
- **This design assumes a book has exactly one "primary" run** (the one
  the customer arrives from, with `replacesPageId: null` on every page)
  — the regeneration-cap count (`listBookRuns.length - 1`) and the
  reconciliation's chain-walk both anchor on that. True today (nothing
  in `app.jsx` offers a "redo photos for an existing book" flow, and
  `createBookRun` is only ever called once per book, from
  `photo-selection-page.jsx`), and nothing in the schema enforces it —
  if such a flow is ever added, both the cap math and reconciliation
  need an explicit "is this the primary run" signal instead of
  inferring it from the absence of `replacesPageId`.
- `api-client.js`'s `request()` generates a fresh `Idempotency-Key` per
  call rather than one per user intent (its own `TODO` already flags
  this). That's a pre-existing, codebase-wide limitation, not something
  to fix as part of this screen — but it means a double-click on "Try
  again" is more likely to fire two regenerations than it would if
  idempotency keys were threaded per-intent. Worth keeping in mind, not
  blocking.
