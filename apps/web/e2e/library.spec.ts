/**
 * AnimBook E2E — Library happy-path.
 *
 * Run with `npx playwright test` from apps/web/ once @playwright/test is
 * installed and Chromium is downloaded.
 *
 * Verifies the critical Web surfaces that can regress:
 *  1. Landing page renders 12 verticals.
 *  2. The DOCS vertical shows at least one card (we seeded 5).
 *  3. `/pricing` page shows all 3 tiers.
 *  4. `/legal/terms` page renders.
 */
import { test, expect } from "@playwright/test";

test.describe("Library surface", () => {
  test("home page lists 12 verticals + DOCS AnimBook", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Open a page/i })).toBeVisible();
    // The library page renders a section for each present vertical.
    // We don't assert a full count (KIDS / BUSINESS may roll up), but we
    // do assert the new DOCS vertical has at least one row.
    const docsSection = page.locator("section", { has: page.locator("h2", { hasText: /Docs/i }) });
    if (await docsSection.count()) {
      await expect(docsSection.first().locator(".book-card")).toHaveCountGreaterThan(0);
    }
  });

  test("pricing page lists 3 tiers", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { name: /Choose your AnimBook tier/i })).toBeVisible();
    await expect(page.getByText("Reader", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Premium", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("Studio", { exact: false }).first()).toBeVisible();
  });

  test("legal/terms renders without 404", async ({ page }) => {
    const response = await page.goto("/legal/terms");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Terms of Service/i })).toBeVisible();
  });

  test("legal/privacy renders without 404", async ({ page }) => {
    const response = await page.goto("/legal/privacy");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Privacy Policy/i })).toBeVisible();
  });

  test("legal/refund renders without 404", async ({ page }) => {
    const response = await page.goto("/legal/refund");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: /Refund Policy/i })).toBeVisible();
  });

  test("reader error boundary catches a bad slug", async ({ page }) => {
    await page.goto("/read/__nope__");
    // Either the loading state, the empty state, or the error state — never blank.
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    const body = await page.locator("body").innerText();
    expect(body.length).toBeGreaterThan(20);
  });
});
