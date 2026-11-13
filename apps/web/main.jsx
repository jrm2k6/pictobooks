// Keep the customer journey storybook in development only. Vite replaces
// import.meta.env.DEV during production builds, so prototype.jsx is removed
// from the public bundle entirely.
if (import.meta.env.DEV && window.location.pathname !== "/" && window.location.pathname !== "/login") {
  import("./prototype.jsx");
} else {
  import("./login.jsx");
}
