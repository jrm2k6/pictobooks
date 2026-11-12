# Customer screen component contract

The parent application in `../main.jsx` owns customer state, URL synchronization,
the storybook shell, and transitions. Screen components render one state and
receive data and callbacks through props. A screen must not choose its own next
route or update global state directly; it emits a customer action with its
callback and the parent applies the transition from `../stateMachine.js`.

## Parallel implementation rules

- Keep one route screen per JSX module.
- Subagents should edit only their assigned screen file. The main agent owns
  shared navigation, state, CSS, transition definitions, and integration.
- Reuse the existing Pictobook classes in `../storybook.css` to preserve the
  reviewed visual direction.
- Keep the current storybook route IDs when matching an existing screen.
- Screen callbacks should describe customer intent (`onNavigate`, `onApprove`,
  `onAddFiles`); the parent owns route changes and persistence.
- Use real labels, accessible names, and buttons with `type="button"`.

## Current React screens

- `BookshelfScreen.jsx` and `FirstVisitScreen.jsx` — return and first-run states.
- `SignInScreen.jsx` and `EmailConfirmationScreen.jsx` — mock account access.
- `BookDetailsScreen.jsx`, `PhotoSelectionScreen.jsx`, and `OrderPagesScreen.jsx` — book setup.
- `ProcessingScreen.jsx` and `SlowProcessingScreen.jsx` — complete and partial generation.
- `PageReviewScreen.jsx` — ready and needs-attention page states.
- `BookPreviewScreen.jsx` and `EditionSelectionScreen.jsx` — book review and format.
- `CheckoutScreen.jsx` and `OrderCompleteScreen.jsx` — simulated ordering.
- `PhotoUploadErrorScreen.jsx` and `GenerationErrorScreen.jsx` — focused recovery paths.

All 17 story states render as React components. The state machine owns the
allowed product transitions; the storybook rail and flow map may jump directly
between routes for review.
