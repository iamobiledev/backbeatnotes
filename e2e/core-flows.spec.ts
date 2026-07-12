import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

/**
 * End-to-end coverage of the core product flows against a seeded local
 * database (`pnpm db:seed`):
 * - sign in, personal notebook provisioning
 * - page creation, autosave, rich editing
 * - favorites, version history, trash/restore
 * - Cmd+K search with highlights
 * - share dialog + publish to web
 * - permissions: request-access screen for non-members
 *
 * Requires E2E_HAS_DATABASE=1 (or PLAYWRIGHT_BASE_URL pointing at a seeded
 * deployment).
 */

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? "demo@docloom.local";
const OUTSIDER_EMAIL =
  process.env.SEED_OUTSIDER_EMAIL ?? "teammate@docloom.local";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "DocloomDemo123!";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "";

const hasDb =
  Boolean(process.env.E2E_HAS_DATABASE) ||
  Boolean(process.env.PLAYWRIGHT_BASE_URL);

async function shot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
  });
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe.serial("core flows", () => {
  test.skip(!hasDb, "Requires a seeded database (E2E_HAS_DATABASE=1)");

  const runId = Date.now().toString(36);
  const docTitle = `Launch Plan ${runId}`;
  const secretTitle = `Secret salary ${runId}`;
  let docUrl = "";

  test("sign in lands in the app with a personal notebook", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    // Personal notebook is provisioned lazily and appears in the picker or
    // the workspace switcher.
    await page.goto("/app");
    await expect(
      page.getByText("Personal notebook").first(),
    ).toBeVisible();
    await shot(page, "01-workspace-picker");
  });

  test("create a page, autosave, and rich editing", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto("/app");
    await page.getByRole("link", { name: "My Workspace" }).first().click();
    await page.waitForURL(/\/app\/[^/]+$/);

    await page
      .getByRole("button", { name: /new page/i })
      .first()
      .click();
    await page.waitForURL(/\/docs\//);
    docUrl = page.url();

    // Title + content
    await page.getByLabel("Document title").fill(docTitle);
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.type(
      `Our launch checklist ${runId} for the third quarter release.`,
    );
    await page.keyboard.press("Enter");

    // Toolbar: heading
    await page.getByRole("button", { name: "Heading 2" }).click();
    await page.keyboard.type("Milestones");
    await expect(
      editor.getByRole("heading", { level: 2, name: "Milestones" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");

    // Task list
    await page.getByRole("button", { name: /task list/i }).click();
    await page.keyboard.type("Ship the Slack integration");
    await expect(editor.locator("ul[data-type='taskList']")).toBeVisible();
    await expect(
      editor.getByText("Ship the Slack integration"),
    ).toBeVisible();

    // Autosave indicator round-trip
    await expect(page.getByText(/saving…|unsaved changes/i)).toBeVisible();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
    await shot(page, "02-editor-saved");

    // Content survives reload
    await page.reload();
    await expect(page.getByLabel("Document title")).toHaveValue(
      docTitle,
    );
    await expect(editor.getByText("Milestones")).toBeVisible();
  });

  test("favorite a page shows it in the sidebar", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    await page.getByRole("button", { name: /add to favorites/i }).click();
    // Appears twice once favorited: in Favorites and in the page tree.
    await expect(
      page
        .getByRole("navigation", { name: "Documents" })
        .getByText(docTitle),
    ).toHaveCount(2, { timeout: 10_000 });
    await expect(
      page.getByRole("navigation", { name: "Documents" }).getByText("Favorites"),
    ).toBeVisible();
    await shot(page, "03-favorites-sidebar");
  });

  test("Cmd+K search finds content with highlights", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    const input = page.getByLabel("Search pages and content");
    // Retry the shortcut until hydration has attached the listener.
    await expect(async () => {
      await page.keyboard.press("ControlOrMeta+k");
      await expect(input).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await input.fill(`checklist ${runId}`);
    const option = page
      .getByRole("listbox", { name: "Search results" })
      .getByRole("option")
      .first();
    await expect(option).toContainText(docTitle, { timeout: 10_000 });
    await expect(option.locator("mark").first()).toBeVisible();
    await shot(page, "04-search-palette");
    await option.click();
    await page.waitForURL(/\/docs\//);
  });

  test("share dialog publishes to the web", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    await page.getByRole("button", { name: "Share" }).click();
    await expect(page.getByText("Who has access")).toBeVisible();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const publicInput = page.getByLabel("Public link");
    await expect(publicInput).toBeVisible({ timeout: 10_000 });
    const publicUrl = await publicInput.inputValue();
    await shot(page, "05-share-dialog");
    await page.keyboard.press("Escape");

    // Public page renders without auth
    const anonymous = await page.context().browser()!.newContext();
    const anonPage = await anonymous.newPage();
    await anonPage.goto(publicUrl);
    await expect(
      anonPage.getByRole("heading", { name: docTitle }),
    ).toBeVisible();
    await anonymous.close();
  });

  test("version history lists snapshots and restores", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);

    // Force a significant edit (title change) to guarantee a snapshot.
    await page.getByLabel("Document title").fill(`${docTitle} v2`);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /version history/i }).click();
    await expect(page.getByText(/snapshots are taken automatically/i)).toBeVisible();
    const version = page.getByRole("button", { name: /^v\d+/ }).first();
    await expect(version).toBeVisible({ timeout: 10_000 });
    await version.click();
    await expect(
      page.getByRole("button", { name: /restore this version/i }),
    ).toBeVisible();
    await shot(page, "06-version-history");
    await page.keyboard.press("Escape");
  });

  test("trash and restore round-trip", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /move to trash/i }).click();
    await page.waitForURL(/\/app\/[^/]+$/);

    // Trash view lists it
    await page.getByRole("link", { name: "Trash" }).click();
    await page.waitForURL(/\/trash/);
    await expect(page.getByText(docTitle)).toBeVisible();
    await shot(page, "07-trash");

    // Restore
    await page.getByRole("button", { name: /restore/i }).first().click();
    await expect(page.getByText("Page restored")).toBeVisible();
    await page.goto(docUrl);
    await expect(page.getByLabel("Document title")).toBeVisible();
  });

  test("non-members get a request-access screen, not content", async ({
    page,
  }) => {
    await signIn(page, OUTSIDER_EMAIL);
    await page.goto(docUrl);
    await expect(page.getByText("You need access")).toBeVisible();
    // No content leak
    await expect(page.locator("body")).not.toContainText(docTitle);
    await shot(page, "08-request-access");
    await page.getByRole("button", { name: /request access/i }).click();
    await expect(
      page.getByRole("heading", { name: "Request sent" }),
    ).toBeVisible();
  });

  test("personal notebook pages are invisible to others (search)", async ({
    page,
  }) => {
    // Demo user writes a secret page in their personal notebook.
    await signIn(page, DEMO_EMAIL);
    await page.goto("/app");
    await page.getByRole("link", { name: "Personal notebook" }).first().click();
    await page.waitForURL(/\/app\/[^/]+$/);
    await page.getByRole("button", { name: /new page/i }).first().click();
    await page.waitForURL(/\/docs\//);
    await page.getByLabel("Document title").fill(secretTitle);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Outsider cannot find it in search.
    const outsiderContext = await page.context().browser()!.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await signIn(outsiderPage, OUTSIDER_EMAIL);
    const res = await outsiderPage.request.get(
      `/api/search?q=${encodeURIComponent(secretTitle)}`,
    );
    expect(res.ok()).toBeTruthy();
    const data = (await res.json()) as { hits: Array<{ title: string }> };
    expect(
      data.hits.filter((h) => h.title.includes(secretTitle)).length,
    ).toBe(0);
    await outsiderContext.close();
  });
});
