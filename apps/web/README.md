# Customer product prototype and storybook

The deployed app opens on a branded `/login` placeholder. Authentication is not
connected yet; submitting an email displays an honest setup message and does
not send a link. Production builds contain only this login screen; the
interactive prototype is dynamically loaded only by the local Vite dev server.

Start the app locally from the repo root:

```sh
pnpm --filter web dev
```

Open `http://127.0.0.1:4176` for the login page. Open
`http://127.0.0.1:4176/storybook` for the local-only screen and state gallery.
The React app's left rail links to each screen and
state. Switch from **Screens** to **Flow map** to see the customer state groups,
transition events, and guards. In screen view, Story notes lists valid next
states and explains the transition from the previous state. The toolbar
switches among three visual directions. Direct links use
`/books/new/pages/review?direction=studio`; the flow map is available at
`/books?direction=studio&view=flow`.

The state machine is defined in `stateMachine.js`; the parent in `prototype.jsx`
owns screen navigation and shared customer state. TanStack Router owns the
addressable page routes and browser history; `?direction=studio` and
`?view=flow` are storybook-only search parameters. TanStack Query is installed
at the app root with a shared `QueryClient`. The prototype is not connected to
the API yet, so books and orders remain explicit sample data rather than fake
network queries. See the target
[screen-to-API contract](../../docs/customer-api-contract.md) and its
[OpenAPI document](../../docs/customer-api.openapi.yaml). The per-screen React
component and planned Query hook mapping is in
[customer-screen-api-map.yaml](../../docs/customer-screen-api-map.yaml).

To browse API paths, payloads, and responses in Swagger UI, run:

```sh
pnpm --filter web api-docs
```

Then open `http://127.0.0.1:4177/customer-api.html`. The page loads the OpenAPI
YAML directly from `docs/` and groups endpoints by customer journey. Browse
the planned contract; request execution is disabled because several operations
are not implemented yet. Swagger UI assets load from unpkg, so the docs page
needs an internet connection.

All 17 screen states are individual React components in `screens/`. See
[`screens/README.md`](screens/README.md) for their responsibilities and the
parallel implementation contract.

Screen URLs are collected in `screenPaths` in `prototype.jsx`; examples include
`/books/new/details`, `/books/new/photos`, and `/books/new/pages/review`.
Legacy `/?screen=...` links redirect to the matching route.

This is an interactive React prototype. It is loaded only by Vite's local
development server and is excluded from production builds. File selection,
navigation, page approval, edition choice, and order confirmation are simulated
in the browser.
It does not upload photos, start the generation pipeline, collect payment, or
create a real order. Screenshots are stored in
`docs/customer-product-storybook/screenshots/`.
