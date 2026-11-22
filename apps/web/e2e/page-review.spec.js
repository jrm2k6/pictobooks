import { expect, test } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

const hasAuthCreds =
  !!process.env.CLERK_SECRET_KEY && !!process.env.TEST_USER_EMAIL;

test.describe("page review", () => {
  test.skip(
    !hasAuthCreds,
    "Set CLERK_SECRET_KEY and TEST_USER_EMAIL to run authenticated flow tests"
  );

  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
    await clerk.signIn({
      page,
      signInParams: {
        strategy: "email_code",
        identifier: process.env.TEST_USER_EMAIL,
      },
    });
    await page.goto("/books");
  });

  test.afterEach(async ({ page }) => {
    await clerk.signOut({ page });
  });

  test("renders the review grid heading", async ({ page }) => {
    await page.goto("/books/new/pages?bookId=test-book-id&runId=test-run-id");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("does not use the wizard step chrome", async ({ page }) => {
    await page.goto("/books/new/pages?bookId=test-book-id&runId=test-run-id");
    await expect(page.getByText(/Step \d of \d/)).toHaveCount(0);
  });
});
