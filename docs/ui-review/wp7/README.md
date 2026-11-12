# WP7 visual review

Open [index.html](./index.html) directly in a browser to review the desktop
screens without starting the dashboard or providing credentials.

## Captures

- Viewport: 1440 × 1250 pixels
- Fixture set: `wp7-synthetic-v1`
- Capture browser: Google Chrome headless
- Data: invented book, run, candidate, QA, review, and Canonical Reference
  records with synthetic SVG illustrations
- Date: 2026-11-10

The gallery includes normal and empty Books and Book Runs lists; a mixed-outcome
run; page review with the source photo, repair lineage, and page brief; approval
confirmation and human-approved result; regeneration confirmation; Canonical
Reference confirmation and resulting catalogue state; and loading and API error
states.

The error and loading captures are deliberate state fixtures. The screenshots
do not include actual customer books or photos. The browser fixtures live in
`apps/pipeline/cloudflare-dashboard-fixtures.js` and render through the same
dashboard components used by the live local API mode.
