import { clerkSetup } from "@clerk/testing/playwright";

export default async function globalSetup() {
  // Clerk testing setup — requires CLERK_SECRET_KEY in env.
  // If the secret key is absent (local dev without full credentials), skip
  // so unauthenticated-flow tests can still run.
  if (process.env.CLERK_SECRET_KEY) {
    await clerkSetup();
  }
}
