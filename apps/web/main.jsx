// Keep the customer journey storybook in development only. Vite replaces
// import.meta.env.DEV during production builds, so prototype.jsx is removed
// from the public bundle entirely.
if (import.meta.env.DEV && window.location.pathname.startsWith("/storybook")) {
  import("./prototype.jsx");
} else {
  import("./app.jsx");
}
