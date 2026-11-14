import React from "react";
import {
  ClerkProvider,
  RedirectToSignIn,
  SignIn,
  SignUp,
  useAuth,
} from "@clerk/react";
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
    <main style={{ padding: "2rem", fontFamily: "sans-serif" }}>
      <h1>Your Books</h1>
      <p>Your pictobooks will appear here.</p>
    </main>
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

const router = createRouter({
  routeTree: rootRoute.addChildren([
    indexRoute,
    signInRoute,
    signUpRoute,
    authedLayout.addChildren([booksRoute]),
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
