# Digital book alpha and paid beta

Pictobook's first release should let families turn approved coloring pages into
a PDF they can print at home. A free, invite-only alpha tests whether families
like and use the result. A small paid beta tests whether families will buy it
and whether that price supports the cost of generating previews.

## Free alpha

Invite five to ten families and offer one free book per family. Track how many
start, finish review, download, and print. Ask whether the art looks like their
family, whether the printed lines are easy to color, and where they needed help.
Record first-pass page acceptance, repair frequency, and the time from upload
to download.

The first product slice adds a private PDF download to the approved preview.
The server checks book ownership and resolves the current page in each
original slot. It follows regeneration and replacement lineage and skips
expired replacement uploads. Each sheet uses the clean artifact for the exact
candidate the customer approved, in preview order. The first layout is US
Letter portrait with white margins and one image per sheet, scaled to fit.

Customers can remove a page from the book after generation, including a page
they already approved. Removal is reversible and follows the original page
slot across future versions. Removed pages remain available in review with
a Keep this page action in the same position as Remove from book. Keeping
a page confirms its candidate and includes it. Only included pages appear in
preview and the PDF or require approval to continue. At least one page must
remain included.
The review image displays its Approved tag at the top right. After approval,
the Keep button becomes Remove from book in the same position.

Generate the alpha PDF on demand from the current approvals. A download after
an edit reflects the new approvals once review is complete. Paid orders will
instead use an immutable snapshot so a customer can always retrieve the
edition they bought. Local Wrangler development enables the download.
Enable `PRINTABLE_PDF_ENABLED` in a hosted environment only after access is
limited to the alpha cohort.

Before inviting families, validate photo intake with the real provider,
exercise the complete download flow with synthetic fixtures, and print a
representative PDF. In the Worker, photo intake uses the configured vision
model (`GEMINI_VISION_MODEL`, defaulting to `gemini-3.8-flash` via
`style_judge_model`) with structured JSON output rather than Nano Banana 2.1,
which Google lists as unsupported for structured outputs. Verify accepted,
rejected, and borderline photos against the live vision model before launch.
[Worker intake](../../../apps/pipeline-cloudflare/src/book-run/bookRun.ts) ·
[Nano Banana 2.1 model card](https://aistudio.google.com/docs/models/gemini-nano-banana-2.1)

## Paid beta

Start with a single 10-page PDF offer. Show the price before generation and
collect payment after preview approval. Create one order and hosted checkout
session per purchase intent. Freeze the approved candidate IDs and their
order, use the verified payment webhook to confirm payment, and make the paid
PDF available to its owner from My Books. Keep physical print fulfillment for
a later milestone.

As of November 23, 2026, the checked-in preview and production configurations
select Nano Banana 2.1 for 2K portrait generation and repair, and Gemini 3.8
Flash for style QA. Google lists Nano Banana 2.1 as its current high-efficiency
image model. [Production configuration](../../../apps/pipeline-cloudflare/wrangler.production.jsonc) ·
[Google release notes](https://aistudio.google.com/docs/changelog#10-06-2026) ·
[Gemini pricing](https://aistudio.google.com/docs/pricing#gemini-nano-banana-2.1)

| Cost basis                                            | Per page | 10-page book |
| ----------------------------------------------------- | -------: | -----------: |
| Google standard image output for two 2K candidates    |  $0.1008 |        $1.01 |
| Configured estimate for two candidates plus style QA  |    $0.15 |        $1.50 |
| Configured estimate with both automatic repair rounds |    $0.45 |        $4.50 |

Google's image-output rate excludes input and thinking tokens. The configured
estimates exclude intake and later customer-triggered generation and photo
replacement. The pipeline currently records configured estimates in its
actual-cost field. Measure spend for completed and abandoned previews, then
reconcile the totals against provider billing. [Generation policy](../../../apps/pipeline-cloudflare/src/domain/generationPolicy.ts) ·
[Worker accounting](../../../apps/pipeline-cloudflare/src/book-run/bookRun.ts)

Calculate generation cost per sale as total cohort generation spend divided by
paid books. At an illustrative $1.50 per started book and 40% conversion, that
is $3.75 per sale before payment fees, storage, or support. Use $7.99 USD for
10 pages as a provisional test price. Revisit it with measured spend and beta
conversion. Match the photo picker's limits to the server when introducing the
paid offer so customers know how many pages they are buying.

## Model evaluation and cost tracking

- Keep a versioned rate card with model IDs, request settings, resolutions,
  effective dates, and source links. Review Google's releases, pricing, and
  deprecations monthly and before changing a production model. Recalculate
  vision costs when Gemini 3.8 Flash's standard token prices change on
  January 1, 2027. [Gemini release notes](https://aistudio.google.com/docs/changelog) ·
  [Gemini deprecations](https://aistudio.google.com/docs/deprecations) ·
  [Gemini 3.8 Flash pricing](https://aistudio.google.com/docs/pricing#gemini-3.8-flash)
- Capture requested and returned model versions, usage, resolution, operation,
  outcome, and latency for generation, repairs, intake, and style QA. Keep the
  budget estimate available alongside usage-derived cost and reconcile billed
  retries or failures at the cohort level. [Gemini response metadata](https://aistudio.google.com/api-reference/generate-content#response-body)
- Use a fixed set of synthetic or explicitly consented photos. Compare Nano
  Banana 2.1 at 1K and 2K first, then compare one candidate with a fallback
  against two upfront. Score likeness and printed line quality blind. Compare
  cost per accepted page, first-pass acceptance, repair rate, and latency
  against the pinned baseline before promoting a change.
- Evaluate Nano Banana 2 Lite at 1K if single-reference generation is suitable,
  and Nano Banana Pro on hard cases. Evaluate vision separately with Gemini
  3.8 Flash as the baseline, Gemini 4 Hydrogen as a newer option, and Gemini
  3.5 Flash-Lite as a lower-cost option. [Image model guide](https://aistudio.google.com/docs/image-generation#model-selection) ·
  [Gemini 4 Hydrogen](https://aistudio.google.com/docs/models/gemini-4-hydrogen) ·
  [Gemini 3.5 Flash-Lite](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite)
