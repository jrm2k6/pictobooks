import React from "react";
import {
  ClerkProvider,
  RedirectToSignIn,
  SignIn,
  SignUp,
  useAuth,
} from "@clerk/react";
import { AppShell } from "./app-shell.jsx";
import { AuthLayout, clerkAppearance } from "./auth-layout.jsx";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!PUBLISHABLE_KEY) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY. Copy .env.example to .env and add your key.");
}

function AuthedLayout() {
  const { isSignedIn, isLoaded } = useAuth();
  if (!isLoaded) return null;
  if (!isSignedIn) return <RedirectToSignIn />;
  return <Outlet />;
}

function BooksPage() {
  return (
    <AppShell>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "360px", textAlign: "center", gap: "16px" }}>
        <div style={{
          width: "72px", height: "72px", borderRadius: "20px",
          background: "oklch(0.99 0.005 80)",
          border: "1.5px dashed oklch(0.65 0.18 30 / 0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M6 8h20M6 13h20M6 18h12" stroke="oklch(0.65 0.18 30)" strokeWidth="1.75" strokeLinecap="round" />
            <circle cx="23" cy="22" r="6" fill="oklch(0.65 0.18 30 / 0.12)" stroke="oklch(0.65 0.18 30)" strokeWidth="1.5" />
            <path d="M23 19.5v5M20.5 22h5" stroke="oklch(0.65 0.18 30)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1 style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: "22px", fontWeight: 700, color: "#203649", margin: "0 0 6px" }}>
            No books yet
          </h1>
          <p style={{ fontFamily: '"Plus Jakarta Sans", sans-serif', fontSize: "15px", color: "#73818b", margin: 0 }}>
            Create your first coloring book from family photos.
          </p>
        </div>
        <button style={{
          marginTop: "8px",
          background: "oklch(0.65 0.18 30)",
          color: "#fff",
          border: "none",
          borderRadius: "10px",
          padding: "12px 24px",
          fontFamily: '"Plus Jakarta Sans", sans-serif',
          fontSize: "14px",
          fontWeight: 700,
          cursor: "pointer",
        }}>
          Create a book
        </button>
      </div>
    </AppShell>
  );
}

const rootRoute = createRootRoute();

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/books" });
  },
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: () => (
    <AuthLayout
      kicker="Welcome back"
      heading="Your books are waiting."
      intro="Sign in to pick up where your family left off."
      toggleText="Don't have an account?"
      toggleHref="/sign-up"
      toggleLinkText="Sign up"
    >
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/books"
        appearance={clerkAppearance}
      />
    </AuthLayout>
  ),
});

const signUpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-up",
  component: () => (
    <AuthLayout
      kicker="Get started"
      heading="Make memories colorful."
      intro="Create your Pictobook account — it only takes a moment."
      toggleText="Already have an account?"
      toggleHref="/sign-in"
      toggleLinkText="Sign in"
    >
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/books"
        appearance={clerkAppearance}
      />
    </AuthLayout>
  ),
});

const authedLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "authed",
  component: AuthedLayout,
});

const booksRoute = createRoute({
  getParentRoute: () => authedLayout,
  path: "/books",
  component: BooksPage,
});

const howItWorksRoute = createRoute({
  getParentRoute: () => authedLayout,
  path: "/how-it-works",
  component: () => (
    <AppShell>
      <h1 style={{ fontFamily: '"Fraunces", Georgia, serif', fontSize: "28px", fontWeight: 700, color: "#203649" }}>How it works</h1>
      <p style={{ fontFamily: '"Plus Jakarta Sans", sans-serif', color: "#73818b", marginTop: "8px" }}>Coming soon.</p>
    </AppShell>
  ),
});

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    signInRoute,
    signUpRoute,
    authedLayout.addChildren([booksRoute, howItWorksRoute]),
  ]),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 1000 * 60 * 5 },
  },
});

createRoot(document.getElementById("root")).render(
  <ClerkProvider
    publishableKey={PUBLISHABLE_KEY}
    signInUrl="/sign-in"
    signUpUrl="/sign-up"
    afterSignInUrl="/books"
    afterSignUpUrl="/books"
  >
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </ClerkProvider>
);
