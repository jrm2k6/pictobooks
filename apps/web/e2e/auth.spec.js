import { test, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";

// ---------------------------------------------------------------------------
// Unauthenticated flows — no Clerk secret key required
// ---------------------------------------------------------------------------

test.describe("unauthenticated redirects", () => {
  test("/ redirects to /sign-in when not authenticated", async ({ page }) => {
    await page.goto("/");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("/sign-in");
  });

  test("/books redirects to /sign-in when not authenticated", async ({ page }) => {
    await page.goto("/books");
    await page.waitForURL(/\/sign-in/);
    expect(page.url()).toContain("/sign-in");
  });

  test("/sign-in renders Clerk SignIn widget", async ({ page }) => {
    await page.goto("/sign-in");
    // Clerk renders a form or its card container
    await expect(page.locator(".cl-rootBox, [data-clerk-root]").first()).toBeVisible({ timeout: 10000 });
  });

  test("/sign-up renders Clerk SignUp widget", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.locator(".cl-rootBox, [data-clerk-root]").first()).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Authenticated flows — requires CLERK_SECRET_KEY + VITE_CLERK_PUBLISHABLE_KEY
// ---------------------------------------------------------------------------

test.describe("authenticated flows", () => {
  test.skip(
    !process.env.CLERK_SECRET_KEY,
    "Set CLERK_SECRET_KEY to run authenticated flow tests"
  );

  test("authenticated user reaches /books", async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto("/books");
    await expect(page).toHaveURL(/\/books/);
    await expect(page.getByRole("heading", { name: /your books/i })).toBeVisible();
  });

  test("authenticated user is not redirected away from /books", async ({ page }) => {
    await setupClerkTestingToken({ page });
    await page.goto("/books");
    // Should stay on /books, not bounce to /sign-in
    await page.waitForTimeout(1000);
    expect(page.url()).toContain("/books");
  });
});
