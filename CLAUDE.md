# Pictobook

Landing page for Pictobook — a service that turns family photos into personalized coloring books for kids (ages 3–12).

## Tech Stack

- **React 19** + **TypeScript**
- **Vite 7** (dev server + static bundler)
- **Tailwind CSS v4** (via `@tailwindcss/vite` plugin)
- **shadcn/ui** components (in `apps/landing/src/components/ui/`)
- **wouter** for routing
- **sonner** for toast notifications
- **framer-motion** for animations
- **pnpm workspaces** as package manager

## Project Structure

```
pictobook/
├── apps/
│   ├── landing/          # Vite + React landing page
│   │   ├── index.html
│   │   ├── src/
│   │   │   ├── main.tsx        # React root mount
│   │   │   ├── App.tsx         # Router + providers
│   │   │   ├── pages/Home.tsx  # Landing page (main file to edit)
│   │   │   ├── index.css       # Design system / Tailwind config
│   │   │   └── components/ui/  # shadcn/ui components
│   │   ├── vite.config.ts
│   │   └── package.json
│   ├── web/              # Placeholder (future React app)
│   └── api/              # Placeholder (Rails API)
├── packages/
│   └── shared/           # Shared constants (@pictobook/shared)
│       └── src/const.ts
├── patches/              # pnpm patches (wouter)
├── pnpm-workspace.yaml
├── package.json          # Workspace root
└── tsconfig.json         # Base TypeScript config
```

## Commands

```bash
# Landing page
pnpm --filter landing dev      # Start dev server at http://localhost:3000
pnpm --filter landing build    # Build static output to apps/landing/dist/
pnpm --filter landing preview  # Preview the production build locally
pnpm --filter landing check    # TypeScript type check

# Root
pnpm format                    # Prettier format across all packages

# Rails API (future)
cd apps/api && bin/rails server
cd apps/api && bundle exec rails console
```

## Design System

- **Palette**: Coral `oklch(0.65 0.18 30)` · Navy `oklch(0.22 0.04 255)` · Gold `oklch(0.88 0.15 85)` · Off-white `oklch(0.99 0.005 80)`
- **Fonts**: Fraunces (display/headings) · Plus Jakarta Sans (body) — loaded from Google Fonts in `apps/landing/index.html`
- Custom CSS classes: `.btn-coral`, `.btn-navy`, `.blob-morph`, `.float-anim`, `.step-number` — defined in `apps/landing/src/index.css`

## Key Notes

- The waitlist form in `Home.tsx` (`WaitlistForm` component) currently uses a fake handler. A real email collection integration is TBD.
- Static deployment: deploy the `apps/landing/dist/` folder after `pnpm --filter landing build`. Platform TBD.
- `apps/web/` and `apps/api/` are placeholders for future packages.
- Path alias `@shared/*` maps to `packages/shared/src/*` in the landing app.
