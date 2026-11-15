// Keep the customer journey storybook in development only. Vite replaces
// import.meta.env.DEV during production builds, so prototype.jsx is removed
// from the public bundle entirely.
//
// In dev: prototype paths (anything other than auth routes) load the storybook.
// Auth routes and production always load app.jsx with real Clerk auth.
const authPaths = ["/", "/sign-in", "/sign-up"];
if (import.meta.env.DEV && !authPaths.includes(window.location.pathname)) {
  import("./prototype.jsx");
} else {
  import("./app.jsx");
}
