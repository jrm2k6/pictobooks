import { test, expect } from "@playwright/test";
import { setupClerkTestingToken } from "@clerk/testing/playwright";

// ---------------------------------------------------------------------------
// Unauthenticated — wizard routes must redirect to sign-in
// ---------------------------------------------------------------------------

test.describe("unauthenticated wizard redirects", () => {
  for (const path of [
    "/books/new",
    "/books/new/details",
    "/books/new/photos",
    "/books/new/order",
    "/books/new/creating",
  ]) {
    test(`${path} redirects to /sign-in when not authenticated`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/sign-in/);
      expect(page.url()).toContain("/sign-in");
    });
  }
});

// ---------------------------------------------------------------------------
// Authenticated — requires CLERK_SECRET_KEY + VITE_CLERK_PUBLISHABLE_KEY
// ---------------------------------------------------------------------------

test.describe("book creation wizard", () => {
  test.skip(
    !process.env.CLERK_SECRET_KEY,
    "Set CLERK_SECRET_KEY to run authenticated flow tests"
  );

  test.beforeEach(async ({ page }) => {
    await setupClerkTestingToken({ page });
  });

  // ---- Step 1: Book details ------------------------------------------------

  test.describe("step 1 — book details", () => {
    test("renders the book details form", async ({ page }) => {
      await page.goto("/books/new/details");
      await expect(page.getByRole("heading", { name: "Give this book a name." })).toBeVisible();
      await expect(page.getByLabel("Child's first name")).toBeVisible();
      await expect(page.getByLabel("Book title")).toBeVisible();
    });

    test("submit button is enabled even with empty fields (fields are optional)", async ({ page }) => {
      await page.goto("/books/new/details");
      const cta = page.getByRole("button", { name: /choose photos/i });
      await expect(cta).toBeVisible();
      await expect(cta).toBeEnabled();
    });

    test("does not contain an age or child-age field", async ({ page }) => {
      await page.goto("/books/new/details");
      await expect(page.getByLabel(/age/i)).not.toBeVisible();
      await expect(page.locator("select")).not.toBeVisible();
    });

    test("footer note references 5–20 photos", async ({ page }) => {
      await page.goto("/books/new/details");
      await expect(page.getByText(/5.{1,3}20 photos/)).toBeVisible();
    });
  });

  // ---- Step 2: Photo selection ---------------------------------------------

  test.describe("step 2 — photo selection", () => {
    test("renders the photo selection page", async ({ page }) => {
      // Requires a bookId — use a fake one; the page renders before any API call
      await page.goto("/books/new/photos?bookId=test-book-id");
      await expect(page.getByRole("heading", { name: "Pick 5–20 photos." })).toBeVisible();
    });

    test("count line shows the correct limits", async ({ page }) => {
      await page.goto("/books/new/photos?bookId=test-book-id");
      await expect(page.getByText(/at least 5, up to 20 photos/)).toBeVisible();
    });

    test("continue button is disabled with no photos selected", async ({ page }) => {
      await page.goto("/books/new/photos?bookId=test-book-id");
      const cta = page.getByRole("button", { name: /arrange pages/i });
      await expect(cta).toBeDisabled();
    });

    test("continue button is disabled with fewer than 5 photos", async ({ page }) => {
      await page.goto("/books/new/photos?bookId=test-book-id");

      const fileInput = page.locator("#photo-picker");
      const files = Array.from({ length: 4 }, (_, i) => ({
        name: `photo-${i + 1}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(makePng1x1()),
      }));
      await fileInput.setInputFiles(files);

      await expect(page.getByText(/4 photos selected/)).toBeVisible();
      await expect(page.getByRole("button", { name: /arrange pages/i })).toBeDisabled();
    });

    test("continue button is enabled with 5 photos", async ({ page }) => {
      await page.goto("/books/new/photos?bookId=test-book-id");

      const fileInput = page.locator("#photo-picker");
      const files = Array.from({ length: 5 }, (_, i) => ({
        name: `photo-${i + 1}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(makePng1x1()),
      }));
      await fileInput.setInputFiles(files);

      await expect(page.getByText(/5 photos selected/)).toBeVisible();
      await expect(page.getByRole("button", { name: /arrange pages/i })).toBeEnabled();
    });

    test("caps selection at 20 photos", async ({ page }) => {
      await page.goto("/books/new/photos?bookId=test-book-id");

      const fileInput = page.locator("#photo-picker");
      // Try to add 25 — only 20 should be accepted
      const files = Array.from({ length: 25 }, (_, i) => ({
        name: `photo-${i + 1}.png`,
        mimeType: "image/png",
        buffer: Buffer.from(makePng1x1()),
      }));
      await fileInput.setInputFiles(files);

      await expect(page.getByText(/20 photos selected/)).toBeVisible();
    });

    test("removing a photo decrements the count", async ({ page }) => {
      await page.goto("/books/new/photos?bookId=test-book-id");

      const fileInput = page.locator("#photo-picker");
      await fileInput.setInputFiles(
        Array.from({ length: 5 }, (_, i) => ({
          name: `photo-${i + 1}.png`,
          mimeType: "image/png",
          buffer: Buffer.from(makePng1x1()),
        }))
      );
      await expect(page.getByText(/5 photos selected/)).toBeVisible();

      await page.getByRole("button", { name: /remove photo-1\.png/i }).click();
      await expect(page.getByText(/4 photos selected/)).toBeVisible();
      await expect(page.getByRole("button", { name: /arrange pages/i })).toBeDisabled();
    });
  });

  // ---- Step 3: Order pages -------------------------------------------------

  test.describe("step 3 — order pages", () => {
    test("renders the order pages heading", async ({ page }) => {
      await page.goto("/books/new/order?bookId=test-book-id&runId=test-run-id");
      await expect(
        page.getByRole("heading", { name: "Put the moments in order." })
      ).toBeVisible();
    });

    test("shows fallback message when no photo metadata in sessionStorage", async ({ page }) => {
      await page.goto("/books/new/order?bookId=test-book-id&runId=test-run-id");
      await expect(page.getByText(/photo order could not be loaded/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /make the pages/i })).toBeDisabled();
    });

    test("renders photo list from sessionStorage and enables CTA", async ({ page }) => {
      const runId = "test-run-id-order";
      const photoMeta = [
        { photoId: "p1", name: "beach.png", preview: null },
        { photoId: "p2", name: "garden.png", preview: null },
        { photoId: "p3", name: "park.png", preview: null },
        { photoId: "p4", name: "home.png", preview: null },
        { photoId: "p5", name: "school.png", preview: null },
      ];

      // Seed sessionStorage before navigation
      await page.goto("/books/new/details"); // any authed page to get the origin
      await page.evaluate(
        ([key, value]) => sessionStorage.setItem(key, value),
        [`pictobook_photos_${runId}`, JSON.stringify(photoMeta)]
      );

      await page.goto(`/books/new/order?bookId=test-book-id&runId=${runId}`);
      await expect(page.getByRole("heading", { name: "Put the moments in order." })).toBeVisible();
      await expect(page.getByText("beach.png")).toBeVisible();
      await expect(page.getByRole("button", { name: /make the pages/i })).toBeEnabled();
    });

    test("move-up button is disabled for first photo, move-down for last", async ({ page }) => {
      const runId = "test-run-id-arrows";
      const photoMeta = [
        { photoId: "p1", name: "first.png", preview: null },
        { photoId: "p2", name: "last.png", preview: null },
        { photoId: "p3", name: "mid.png", preview: null },
        { photoId: "p4", name: "mid2.png", preview: null },
        { photoId: "p5", name: "mid3.png", preview: null },
      ];

      await page.goto("/books/new/details");
      await page.evaluate(
        ([key, value]) => sessionStorage.setItem(key, value),
        [`pictobook_photos_${runId}`, JSON.stringify(photoMeta)]
      );

      await page.goto(`/books/new/order?bookId=test-book-id&runId=${runId}`);
      await expect(page.getByRole("button", { name: /move first\.png up/i })).toBeDisabled();
      await expect(page.getByRole("button", { name: /move mid3\.png down/i })).toBeDisabled();
      await expect(page.getByRole("button", { name: /move first\.png down/i })).toBeEnabled();
    });
  });

  // ---- Step 4: Processing --------------------------------------------------

  test.describe("step 4 — processing", () => {
    test("renders the processing heading", async ({ page }) => {
      await page.goto("/books/new/creating?bookId=test-book-id&runId=test-run-id");
      await expect(
        page.getByRole("heading", { name: "Your pages are taking shape." })
      ).toBeVisible();
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a minimal valid 1×1 PNG as a Uint8Array.
 * Enough for file input acceptance checks without depending on real images.
 */
function makePng1x1() {
  // Hand-crafted 67-byte PNG: 1×1 red pixel, no alpha
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB, CRC
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT length + type
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // compressed pixel data
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // CRC
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND length + type
    0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
  ]);
}
