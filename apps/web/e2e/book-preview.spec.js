import { expect, test } from "@playwright/test";
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";

const hasAuthCreds =
  !!process.env.CLERK_SECRET_KEY && !!process.env.TEST_USER_EMAIL;

test.describe("book preview", () => {
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

  test("renders the preview heading and a back-to-review link", async ({
    page,
  }) => {
    await page.goto("/books/new/preview?bookId=test-book-id&runId=test-run-id");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /back to page review/i })
    ).toBeVisible();
  });
});
