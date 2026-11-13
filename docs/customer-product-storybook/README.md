# Customer product prototype review

The production app opens on a branded `/login` screen. Its email form is a
placeholder until authentication is connected. The interactive prototype and
storybook are loaded only by the local Vite dev server.

Start the app locally from the repository root:

```sh
pnpm --filter web dev
```

Open [http://127.0.0.1:4176](http://127.0.0.1:4176) for the login screen, then
choose **Open local prototype** in the footer, or go directly to
[/storybook](http://127.0.0.1:4176/storybook). Use the left rail to move
between screens and states. The direction switcher applies three visual
explorations to the same product flow. Each screen can also be linked directly,
for example `/books/new/pages/review?direction=studio`. Open the flow map at
`/books?direction=studio&view=flow`.

## Visual directions

| Direction     | Screenshot                                | Intent                                                                     |
| ------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Studio        | [View](screenshots/direction-studio.png)  | Extends Pictobook's coral, cream, and Fraunces identity. Proposed default. |
| Photo index   | [View](screenshots/direction-index.png)   | A cooler, editorial photo-library approach.                                |
| Picture world | [View](screenshots/direction-picture.png) | A warmer, more playful teal direction.                                     |

## Customer state machine

Open **Flow map** in the running prototype to navigate the state diagram and
transition table. The transition rules are maintained in
[`apps/web/stateMachine.js`](../../apps/web/stateMachine.js), including customer
events and guards such as photo count and QA status. The diagram screenshot is
[available here](screenshots/flow-map.png).

The main book path is: **My books / First visit → Book details → Choose photos
→ Order the pages → Pages are being made → Review a page → Preview the book →
Choose an edition → Delivery details → Order received.** Upload and page
generation errors branch to a focused retry and return to the book. Sign-in is
shown as its own branch; whether account creation is required before starting a
book remains a product decision. The order step is simulated until payment and
fulfillment are connected.

## Screen and state screenshots

| Flow     | Screen                       | Screenshot                               |
| -------- | ---------------------------- | ---------------------------------------- |
| Account  | Production login landing     | [View](screenshots/login.png)            |
| Start    | My books                     | [View](screenshots/library.png)          |
| Start    | First visit / empty library  | [View](screenshots/empty.png)            |
| Account  | Sign in or create an account | [View](screenshots/account.png)          |
| Account  | Check your email             | [View](screenshots/account-sent.png)     |
| Create   | Book details                 | [View](screenshots/create.png)           |
| Create   | Choose photos                | [View](screenshots/upload.png)           |
| Create   | Order the pages              | [View](screenshots/arrange.png)          |
| Creation | Pages are being made         | [View](screenshots/processing.png)       |
| Creation | Some pages are taking longer | [View](screenshots/slow.png)             |
| Review   | Review a page                | [View](screenshots/review.png)           |
| Review   | A page needs attention       | [View](screenshots/issue.png)            |
| Review   | Preview the book             | [View](screenshots/preview.png)          |
| Order    | Choose an edition            | [View](screenshots/edition.png)          |
| Order    | Delivery details             | [View](screenshots/checkout.png)         |
| Order    | Order received               | [View](screenshots/complete.png)         |
| Recovery | Photo upload failed          | [View](screenshots/upload-error.png)     |
| Recovery | A page could not be made     | [View](screenshots/generation-error.png) |

The prototype uses sample content and illustrative prices. It is not connected
to photo storage, image generation, payment, or fulfillment. See
[`apps/web/README.md`](../../apps/web/README.md) for operating details and
[`apps/web/DIRECTION.md`](../../apps/web/DIRECTION.md) for the design brief.
The planned screen-to-API mapping and machine-readable OpenAPI contract are in
[`docs/customer-api-contract.md`](../customer-api-contract.md) and
[`docs/customer-api.openapi.yaml`](../customer-api.openapi.yaml). The
[agent-readable component map](../customer-screen-api-map.yaml) adds the React
component, planned Query hook, operation ID, and connection status for every
screen.
