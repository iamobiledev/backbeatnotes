import { test, expect } from "@playwright/test";

/**
 * Smoke tests — run against local, preview, or production:
 *   PLAYWRIGHT_BASE_URL=https://your-deployment.vercel.app pnpm test:e2e
 */
test.describe("Docloom smoke", () => {
  test("marketing home loads with brand", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Docloom").first()).toBeVisible();
    await expect(
      page.getByText("Your team's knowledge, organized."),
    ).toBeVisible();
  });

  test("sign-in page is reachable", async ({ page }) => {
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });

  test("health endpoint responds", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.service).toBe("docloom");
  });

  test("unknown public slug renders a noindex not-found response", async ({
    page,
  }) => {
    test.skip(
      !process.env.PLAYWRIGHT_BASE_URL && !process.env.E2E_HAS_DATABASE,
      "Requires a live Neon database (deployed URL or E2E_HAS_DATABASE=1)",
    );
    const res = await page.goto("/p/this-slug-should-not-exist-xyz");
    // Partial prerendering can stream a 200 shell before notFound() resolves;
    // Next adds noindex so crawlers never index the soft-404 response.
    expect([200, 404]).toContain(res?.status());
    await expect(
      page.getByRole("heading", { name: "Page not found" }),
    ).toBeVisible();
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute(
      "content",
      /noindex/i,
    );
  });
});
