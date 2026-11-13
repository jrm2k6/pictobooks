import React, { createContext, useContext, useReducer, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRootRoute, createRoute, createRouter, Outlet, redirect, RouterProvider, useNavigate, useRouterState } from "@tanstack/react-router";
import "./storybook.css";
import { screens, storiesByGroup } from "./screenCatalog.js";
import { stagedPhotos } from "./sampleData.js";
import { customerReducer, initialCustomerState } from "./customerState.js";
import { stateGroups, transitions } from "./stateMachine.js";
import BookDetailsScreen from "./screens/BookDetailsScreen.jsx";
import PhotoSelectionScreen from "./screens/PhotoSelectionScreen.jsx";
import OrderPagesScreen from "./screens/OrderPagesScreen.jsx";
import PageReviewScreen from "./screens/PageReviewScreen.jsx";
import EditionSelectionScreen from "./screens/EditionSelectionScreen.jsx";
import BookPreviewScreen from "./screens/BookPreviewScreen.jsx";
import BookshelfScreen from "./screens/BookshelfScreen.jsx";
import FirstVisitScreen from "./screens/FirstVisitScreen.jsx";
import SignInScreen from "./screens/SignInScreen.jsx";
import EmailConfirmationScreen from "./screens/EmailConfirmationScreen.jsx";
import CheckoutScreen from "./screens/CheckoutScreen.jsx";
import OrderCompleteScreen from "./screens/OrderCompleteScreen.jsx";
import ProcessingScreen from "./screens/ProcessingScreen.jsx";
import PhotoUploadErrorScreen from "./screens/PhotoUploadErrorScreen.jsx";
import GenerationErrorScreen from "./screens/GenerationErrorScreen.jsx";
import SlowProcessingScreen from "./screens/SlowProcessingScreen.jsx";

const screenById = Object.fromEntries(screens.map((screen) => [screen.id, screen]));
const directions = [
  ["studio", "Studio"],
  ["index", "Photo index"],
  ["picture", "Picture world"],
];
const screenPaths = {
  library: "/books",
  empty: "/welcome",
  account: "/account/sign-in",
  "account-sent": "/account/check-email",
  create: "/books/new/details",
  upload: "/books/new/photos",
  arrange: "/books/new/order",
  processing: "/books/new/creating",
  slow: "/books/new/creating/slow",
  review: "/books/new/pages/review",
  issue: "/books/new/pages/needs-attention",
  preview: "/books/new/preview",
  edition: "/books/new/edition",
  checkout: "/checkout",
  complete: "/order/received",
  "upload-error": "/books/new/photos/error",
  "generation-error": "/books/new/pages/error",
};
const screenFromPath = Object.fromEntries(Object.entries(screenPaths).map(([id, path]) => [path, id]));
const ScreenContext = createContext(null);
const reactScreens = {
  library: BookshelfScreen,
  empty: FirstVisitScreen,
  account: SignInScreen,
  "account-sent": EmailConfirmationScreen,
  create: BookDetailsScreen,
  upload: PhotoSelectionScreen,
  arrange: OrderPagesScreen,
  processing: ProcessingScreen,
  slow: SlowProcessingScreen,
  review: PageReviewScreen,
  issue: PageReviewScreen,
  preview: BookPreviewScreen,
  edition: EditionSelectionScreen,
  checkout: CheckoutScreen,
  complete: OrderCompleteScreen,
  "upload-error": PhotoUploadErrorScreen,
  "generation-error": GenerationErrorScreen,
};

function StoryNavigation({ activeId }) {
  return <nav id="story-nav" aria-label="Screen stories">
    {storiesByGroup.map((group) => {
      const entries = screens.filter((screen) => screen.group === group);
      return <section className="story-group" key={group}>
        <div className="story-group-title">{group}</div>
        {entries.map((screen, index) => <button
          key={screen.id}
          type="button"
          className="story-link"
          data-screen={screen.id}
          aria-current={screen.id === activeId ? "page" : undefined}
        ><span className="story-index">{String(screens.indexOf(screen) + 1).padStart(2, "0")}</span><span>{screen.title}</span></button>)}
      </section>;
    })}
  </nav>;
}

function FlowMap({ activeId }) {
  return <section className="flow-map-page">
    <div className="flow-map-heading">
      <div><div className="app-eyebrow">Customer journey · state machine</div><h1>From first visit to finished book.</h1>
        <p>Each row names the current state, the customer event, and the next state. Select a state to inspect its screen.</p></div>
      <span className="flow-state-count">{screens.length} states · {transitions.length} transitions</span>
    </div>
    <div className="flow-lanes">
      {stateGroups.map((group) => <section className="flow-lane" key={group.name}>
        <h2>{group.name}</h2>
        <div>{group.ids.map((id, index) => <React.Fragment key={id}>
          <button type="button" data-screen={id} className={`flow-state ${activeId === id ? "selected" : ""}`}>
            <span>{String(screens.indexOf(screenById[id]) + 1).padStart(2, "0")}</span>{screenById[id].title}
          </button>
          {index < group.ids.length - 1 && <span className="flow-down" aria-hidden="true">↓</span>}
        </React.Fragment>)}</div>
      </section>)}
    </div>
    <div className="transition-table-wrap">
      <div className="transition-table-title"><h2>Transition rules</h2><span>Events and guards that move the customer forward</span></div>
      <table className="transition-table"><thead><tr><th>Current state</th><th>Customer event</th><th>Guard / condition</th><th>Next state</th></tr></thead>
        <tbody>{transitions.map((transition, index) => <tr key={`${transition.from}-${transition.event}-${index}`}>
          <td><button type="button" data-screen={transition.from}>{screenById[transition.from].title}</button></td>
          <td>{transition.event}</td><td>{transition.guard || "—"}</td>
          <td><button type="button" className="transition-next" data-screen={transition.to}>→ {screenById[transition.to].title}</button></td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function ScreenRoute({ screenId }) {
  const screenContext = useContext(ScreenContext);
  const ActiveScreen = reactScreens[screenId];
  if (!ActiveScreen) throw new Error(`No React screen registered for '${screenId}'`);
  return <div className="screen-in" key={screenId}>
    <ActiveScreen
      draft={screenContext.customerState.draft}
      email={screenContext.customerState.email}
      onEmailChange={screenContext.onEmailChange}
      onResend={screenContext.onResend}
      onDraftChange={screenContext.onDraftChange}
      photos={screenContext.photos}
      onReorderPhotos={screenContext.onReorderPhotos}
      onAddFiles={screenContext.onAddFiles}
      onRemovePhoto={screenContext.onRemovePhoto}
      approved={screenContext.customerState.approved}
      compare={screenContext.customerState.compare}
      issue={screenId === "issue"}
      format={screenContext.customerState.format}
      onFormatChange={screenContext.onFormatChange}
      onToggleCompare={screenContext.onToggleCompare}
      onApprove={screenContext.onApprove}
      onNavigate={screenContext.onNavigate}
    />
  </div>;
}

function App() {
  const [customerState, dispatch] = useReducer(customerReducer, initialCustomerState);
  const routerNavigate = useNavigate();
  const routerLocation = useRouterState({ select: (routerState) => routerState.location });
  const pathname = routerLocation.pathname.replace(/\/+$/, "") || "/";
  const activeScreenId = screenFromPath[pathname] || "library";
  const active = screenById[activeScreenId] || screens[0];
  const direction = directions.some(([id]) => id === routerLocation.search.direction)
    ? routerLocation.search.direction
    : "studio";
  const view = routerLocation.search.view === "flow" ? "flow" : "stories";
  const [lastTransition, setLastTransition] = useState(null);
  const availableTransitions = transitions.filter((transition) => transition.from === activeScreenId);
  const unorderedPhotos = [
    ...stagedPhotos.map(([name, preview, sizeLabel], index) => ({ id: `sample-${index}`, name, preview, sizeLabel, sample: true }))
      .filter((photo) => !customerState.removedSamples.includes(photo.id)),
    ...customerState.files,
  ];
  const photosById = new Map(unorderedPhotos.map((photo) => [photo.id, photo]));
  const orderedIds = customerState.photoOrder.filter((id) => photosById.has(id));
  const selectedPhotos = [
    ...orderedIds.map((id) => photosById.get(id)),
    ...unorderedPhotos.filter((photo) => !orderedIds.includes(photo.id)),
  ];

  const updateRoute = (screen = activeScreenId, nextDirection = direction, nextView = view, replace = false) => {
    routerNavigate({
      to: screenPaths[screen],
      search: { direction: nextDirection, ...(nextView === "flow" ? { view: "flow" } : {}) },
      replace,
    });
  };

  const navigate = (screen, { fromAction = false, eventName = null, replace = false } = {}) => {
    if (!screenById[screen]) return;
    if (fromAction) {
      const edge = transitions.find((item) => item.from === activeScreenId && item.to === screen && (!eventName || item.event === eventName));
      if (!edge) return;
      setLastTransition(edge);
    }
    updateRoute(screen, direction, "stories", replace);
    window.scrollTo(0, 0);
  };

  const handleClick = (event) => {
    // The storybook root also has data-direction for theming; only the picker buttons are actions.
    const direction = event.target.closest("button[data-direction]");
    if (direction) {
      updateRoute(activeScreenId, direction.dataset.direction, view);
      return;
    }
    const mode = event.target.closest("[data-view]");
    if (mode) {
      const nextView = mode.dataset.view;
      updateRoute(activeScreenId, direction, nextView);
      return;
    }
    const route = event.target.closest("[data-screen]");
    if (route) {
      event.preventDefault();
      navigate(route.dataset.screen, { fromAction: route.closest("#screen-root") !== null });
      return;
    }
    const action = event.target.closest("[data-action]");
    if (action?.dataset.action === "story-prev" || action?.dataset.action === "story-next") {
      const offset = action.dataset.action === "story-prev" ? -1 : 1;
      navigate(screens[Math.max(0, screens.indexOf(active) + offset)].id);
    }
  };

  const addFiles = async (files) => {
    const uploads = await Promise.all(files.map((file) => new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ id: `upload-${crypto.randomUUID()}`, name: file.name, size: file.size, sizeLabel: `${(file.size / 1024 / 1024).toFixed(1)} MB`, preview: reader.result });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    })));
    const uploadLimit = Math.max(0, 10 - stagedPhotos.length + customerState.removedSamples.length);
    dispatch({ type: "photos/added", files: uploads.filter(Boolean), maxUserFiles: uploadLimit });
  };

  const removePhoto = (index) => {
    const photo = selectedPhotos[index];
    if (!photo) return;
    dispatch({ type: "photo/removed", id: photo.id, sample: photo.sample });
  };

  const reorderPhotos = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= selectedPhotos.length) return;
    const ids = selectedPhotos.map((photo) => photo.id);
    const [moved] = ids.splice(fromIndex, 1);
    ids.splice(toIndex, 0, moved);
    dispatch({ type: "photos/reordered", ids });
  };

  const screenContext = {
    customerState,
    photos: selectedPhotos,
    onEmailChange: (email) => dispatch({ type: "email/updated", email }),
    onResend: () => dispatch({ type: "email/resent" }),
    onDraftChange: (partial) => dispatch({ type: "draft/updated", partial }),
    onReorderPhotos: reorderPhotos,
    onAddFiles: addFiles,
    onRemovePhoto: removePhoto,
    onFormatChange: (format) => dispatch({ type: "edition/selected", format }),
    onToggleCompare: () => dispatch({ type: "review/compared" }),
    onApprove: () => { dispatch({ type: "review/approved" }); navigate("preview", { fromAction: true, eventName: "Keep page" }); },
    onNavigate: (screen, eventName) => navigate(screen, { fromAction: true, eventName }),
  };

  return <div className="storybook" id="storybook" data-direction={direction} onClick={handleClick}>
    <aside className="story-rail" aria-label="Storybook screen navigation">
      <button className="story-brand" type="button" data-screen="library" aria-label="Pictobook storybook home"><span className="brand-mark">p</span><span>Pictobook <small>customer app</small></span></button>
      <div className="rail-overline">Screen stories</div>
      <StoryNavigation activeId={activeScreenId} />
      <div className="rail-footer"><span className="online-dot"></span><span>Local prototype<br /><small>No live uploads or orders</small></span></div>
    </aside>

    <main className="review-stage">
      <header className="storybook-bar">
        <div><div className="story-kicker">Customer product · React prototype</div><div className="story-title">{view === "flow" ? "Customer flow map" : active.title}</div></div>
        <div className="review-mode" role="group" aria-label="Review mode">
          <button type="button" data-view="stories" aria-pressed={view === "stories"}>Screens</button>
          <button type="button" data-view="flow" aria-pressed={view === "flow"}>Flow map</button>
        </div>
        <div className="direction-picker" role="group" aria-label="Visual direction"><span>Direction</span>
          {directions.map(([id, label]) => <button key={id} type="button" data-direction={id} aria-pressed={direction === id}>{label}</button>)}
        </div>
        <a className="live-site-link" href="https://pictobook.app/" target="_blank" rel="noreferrer">Live site ↗</a>
      </header>

      <div className="canvas-wrap">
        {view === "flow" ? <FlowMap activeId={activeScreenId} /> : <>
          <div className="customer-app" id="customer-app">
            <header className="customer-header">
              <button className="customer-logo" type="button" data-screen="library" aria-label="Go to My books"><span className="customer-mark">p</span><span>pictobook</span></button>
              <nav className="customer-nav" aria-label="Customer navigation"><button className={activeScreenId === "library" ? "active" : ""} type="button" data-screen="library">My books</button><button className={activeScreenId === "empty" ? "active" : ""} type="button" data-screen="empty">How it works</button></nav>
              <button type="button" className="account-chip" data-screen="library"><span className="account-avatar">M</span><span>Milo’s books</span><span aria-hidden="true">⌄</span></button>
            </header>
            <ScreenContext.Provider value={screenContext}>
              <section id="screen-root" aria-live="polite"><Outlet /></section>
            </ScreenContext.Provider>
          </div>
          <div className="canvas-caption"><span>INTERACTIVE REACT PROTOTYPE</span><span>Sample account · Milo</span></div>
        </>}
      </div>
    </main>

    <aside className="story-notes" aria-label="Story details">
      <div className="notes-top"><span className="notes-icon">i</span><div><strong>{view === "flow" ? "Flow map" : "Story notes"}</strong><small>{view === "flow" ? "Defined customer transitions" : "What this screen demonstrates"}</small></div></div>
      <div className="notes-screen-title">{view === "flow" ? "State machine" : active.title}</div>
      <div className="notes-copy">{view === "flow" ? "The left-to-right journey is split into customer states. Recovery paths rejoin the book without discarding completed work." : active.note}</div>
      {view === "stories" && <>
        <div className="notes-label">Review points</div><ul className="notes-bullets">{active.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>
        <div className="notes-label">Valid next states</div>
        {availableTransitions.length ? <ul className="next-state-list">{availableTransitions.map((transition, index) => <li key={`${transition.event}-${index}`}><button type="button" data-screen={transition.to}><span>{transition.event}</span><strong>→ {screenById[transition.to].title}</strong></button>{transition.guard && <small>Requires: {transition.guard}</small>}</li>)}</ul> : <div className="notes-copy">This is a terminal state in the current prototype.</div>}
        {lastTransition?.to === active.id && <div className="last-transition"><span>Last transition</span><strong>{screenById[lastTransition.from]?.title} → {lastTransition.event} → {active.title}</strong>{lastTransition.guard && <small>Guard: {lastTransition.guard}</small>}</div>}
      </>}
      <div className="notes-label">Prototype route</div><div className="notes-copy">{pathname}?direction={direction}{view === "flow" ? "&amp;view=flow" : ""}</div>
      <div className="notes-controls"><button type="button" className="story-step" data-action="story-prev" disabled={screens.indexOf(active) === 0}>← Previous</button><button type="button" className="story-step next" data-action="story-next" disabled={screens.indexOf(active) === screens.length - 1}>Next story →</button></div>
      <div className="prototype-disclaimer">Sample content and prices. No real upload, generation, payment, or order.</div>
    </aside>
  </div>;
}

const rootRoute = createRootRoute({
  component: App,
  validateSearch: (search) => ({
    direction: directions.some(([id]) => id === search.direction) ? search.direction : undefined,
    view: search.view === "flow" ? "flow" : undefined,
    screen: typeof search.screen === "string" ? search.screen : undefined,
  }),
  notFoundComponent: () => <div className="flow-map-page"><h1>We couldn’t find that page.</h1><button className="button primary" type="button" onClick={() => { window.location.href = screenPaths.library; }}>Go to My books</button></div>,
});

const legacyIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ search }) => {
    const legacyScreen = screenById[search.screen] ? search.screen : "library";
    throw redirect({
      to: screenPaths[legacyScreen],
      search: { direction: search.direction || "studio", ...(search.view === "flow" ? { view: "flow" } : {}) },
      replace: true,
    });
  },
});

const screenRoutes = screens.map((screen) => createRoute({
  getParentRoute: () => rootRoute,
  path: screenPaths[screen.id].slice(1),
  component: () => <ScreenRoute screenId={screen.id} />,
}));

const router = createRouter({ routeTree: rootRoute.addChildren([legacyIndexRoute, ...screenRoutes]) });
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
