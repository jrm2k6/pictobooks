# UI review artifacts

Every work package that adds or changes a reviewer-facing screen includes a
visual review artifact. The artifact is a small, browsable gallery of the
screens and important states, with captured PNG screenshots beside it. This
gives a reviewer a quick way to understand the full interaction without running
the application or reconstructing navigation.

## Required contents

For each screen added or changed, include:

- one screenshot of its normal, populated state;
- screenshots for materially different states introduced on that screen, such
  as empty, loading, error, selected, approval, or regeneration-in-progress;
- a short caption that states the user task and what to inspect;
- the viewport size and fixture or synthetic data used for the capture.

Do not capture customer photos, credentials, signed URLs, or other private data.
Use deterministic fixtures or synthetic preview records. Screenshots should be
captured at the supported desktop review size; the dashboard is desktop-only.

## Gallery layout

Keep artifacts under:

```text
docs/ui-review/{work-package}/
  index.html
  README.md
  screenshots/
    {screen-id}--{state}.png
```

`index.html` is a static storybook-style gallery. It lists the screens in the
order a reviewer encounters them and shows each screenshot with its caption,
state, viewport, and fixture identifier. The page should open directly from the
repository without a server or app credentials. `README.md` records how the
captures were generated and any known visual gaps. Keep the files small enough
to review comfortably in a pull request.

## WP7 screen checklist

WP7's initial gallery should cover each implemented screen and important state
from this flow:

1. Book and Book Run list, including an empty state if that screen is included.
2. Book Run overview, with mixed Page outcomes and terminal reasons.
3. Page review, showing the source, brief, approved Candidate first, remaining
   Candidates, separate Print QA and Style QA outcomes, and repair lineage.
4. Human review confirmation and the resulting approved or rejected state.
5. Regeneration progress and the newly generated Candidate state.
6. Canonical promotion confirmation and the resulting catalogue state.
7. Loading and error states for any screen that introduces asynchronous API
   reads or mutations.

Only include screens that WP7 actually implements; annotate deferred items in
the gallery README rather than presenting a static concept as working UI.
