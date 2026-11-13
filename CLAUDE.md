# Agent instructions

Use the root [README](README.md) for the current monorepo map, installation,
environment setup, local commands, and documentation links. App-specific
instructions belong in that app's README.

## Repository guardrails

- Run commands from the repository root and target workspace packages with
  `pnpm --filter <package> ...` unless an app README says otherwise.
- Do not commit family photos, generated canonical-reference images, local run
  data, or secrets. Keep local photo inputs under the ignored root `samples/`
  directory and generated references under the ignored root `catalog/`.
- Keep frontend `VITE_*` values public; never place credentials in frontend
  variables, committed examples, or Wrangler configuration.
- Use the app's local Wrangler configuration for offline/local work. Treat a
  Wrangler environment such as `preview` as remote and use it only when the task
  explicitly calls for remote Cloudflare resources. For Cloudflare tasks, use
  the project-local Wrangler configuration when present; otherwise use `cf`.
- Preserve unrelated working-tree changes and inspect `git status --short`
  before staging files.

## Landing page design system

- Palette: Coral `oklch(0.65 0.18 30)`, Navy `oklch(0.22 0.04 255)`, Gold
  `oklch(0.88 0.15 85)`, Off-white `oklch(0.99 0.005 80)`.
- Fonts: Fraunces for headings and Plus Jakarta Sans for body text.
- Landing-page utility classes are defined in `apps/landing/src/index.css`.
