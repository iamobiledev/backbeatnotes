import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.SEED_USER_EMAIL ?? "demo@docloom.local";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "DocloomDemo123!";
const workspaceUrl = process.env.E2E_PERF_WORKSPACE_URL;
const documentUrl = process.env.E2E_PERF_DOCUMENT_URL;
const publicDocumentUrl = process.env.E2E_PUBLIC_DOCUMENT_URL;

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe("performance contracts", () => {
  test("static routes stay within the browser resource budget", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByText("Docloom").first()).toBeVisible();
    const resources = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry as PerformanceResourceTiming)
        .filter(
          (entry) =>
            entry.name.includes("/_next/") &&
            (entry.name.includes(".js") || entry.name.includes(".css")),
        )
        .map((entry) => ({
          name: entry.name,
          transferSize: entry.transferSize,
        })),
    );
    const transferred = resources.reduce(
      (total, resource) => total + resource.transferSize,
      0,
    );
    // A zero value means the browser cache hid transfer sizes. Otherwise this
    // guards against accidentally shipping editor-scale code on marketing.
    expect(transferred === 0 || transferred < 300_000).toBeTruthy();
  });

  test("large workspace navigation renders a loading shell promptly", async ({
    page,
  }) => {
    test.skip(!workspaceUrl || !documentUrl, "Set E2E_PERF_* fixture URLs");
    await signIn(page);
    await page.goto(workspaceUrl!);

    const startedAt = Date.now();
    await page.goto(documentUrl!, { waitUntil: "commit" });
    await expect(
      page.locator('[aria-label="Loading page"], [aria-label="Document content"]'),
    ).toBeVisible({ timeout: 1_000 });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  test("mobile drawer contains one navigation tree", async ({ page }) => {
    test.skip(!documentUrl, "Set E2E_PERF_DOCUMENT_URL");
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto(documentUrl!);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Documents" })).toHaveCount(
      1,
    );
  });

  test("published pages do not load editor runtime code", async ({ page }) => {
    test.skip(!publicDocumentUrl, "Set E2E_PUBLIC_DOCUMENT_URL");
    await page.goto(publicDocumentUrl!);
    const scripts = await page.evaluate(() =>
      performance
        .getEntriesByType("resource")
        .map((entry) => entry.name)
        .filter((name) => name.includes("/_next/") && name.includes(".js")),
    );
    const sources = await Promise.all(
      scripts.map((url) => page.request.get(url).then((response) => response.text())),
    );
    expect(sources.join("\n")).not.toMatch(/ProseMirror|tiptap/i);
  });
});
