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

    // Slash command: heading
    await page.keyboard.type("/h2");
    await expect(
      page.getByRole("listbox", { name: "Insert block" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Milestones");
    await expect(
      editor.getByRole("heading", { level: 2, name: "Milestones" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");

    // Slash command: to-do list
    await page.keyboard.type("/todo");
    await expect(
      page.getByRole("listbox", { name: "Insert block" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
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

  test("paragraph deep links scroll to and highlight the saved block", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    const paragraph = page
      .locator(".ProseMirror p")
      .filter({ hasText: `Our launch checklist ${runId}` })
      .first();
    const blockId = await paragraph.getAttribute("data-block-id");
    expect(blockId).toBeTruthy();

    await page.goto(`${docUrl}#block-${blockId}`);
    const target = page.locator(`#block-${blockId}`);
    await expect(target).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.location.hash))
      .toBe(`#block-${blockId}`);
    await expect(target).toHaveJSProperty("id", `block-${blockId}`);
    await expect
      .poll(() =>
        target.evaluate((element) => ({
          highlighted: element.classList.contains("is-deep-link-target"),
          animation: getComputedStyle(element).animationName,
        })),
      )
      .toEqual({
        highlighted: true,
        animation: "deep-link-highlight",
      });

    // Stale links still open the document normally.
    await page.goto(`${docUrl}#block-does_not_exist`);
    await expect(page.getByLabel("Document title")).toHaveValue(docTitle);
    await expect(page.locator(".ProseMirror")).toBeVisible();
  });

  test("'/subpage' creates a nested page linked from the parent", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);

    // Insert a sub-page at the end of the parent document.
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/subpage");
    await expect(
      page.getByRole("listbox", { name: "Insert block" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");

    // Notion behavior: the new child page opens automatically.
    await page.waitForURL(
      (url) => /\/docs\//.test(url.pathname) && !url.href.includes(docUrl),
      { timeout: 15_000 },
    );
    const childUrl = page.url();
    // New pages open with an empty title + "New page" placeholder.
    const childTitle = page
      .getByLabel("Document title")
      .filter({ visible: true });
    await expect(childTitle).toHaveValue("");

    // Rename the child, then confirm the parent's link text follows.
    await childTitle.fill(`Chapter One ${runId}`);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(
      page.getByText("Saved", { exact: true }).filter({ visible: true }),
    ).toBeVisible({ timeout: 10_000 });

    await page.goto(docUrl);
    const subpageLink = page
      .locator(".ProseMirror [data-type='subpage'] a")
      .first();
    await expect(
      page.locator(".ProseMirror [data-type='subpage'] a"),
    ).toHaveCount(1);
    await expect(subpageLink).toContainText(`Chapter One ${runId}`);
    await shot(page, "02b-subpage-link");

    // The link navigates to the child page.
    await subpageLink.click();
    await page.waitForURL(childUrl);

    // The sidebar tree shows the child nested under the parent.
    await expect(
      page
        .getByRole("navigation", { name: "Documents" })
        .getByText(`Chapter One ${runId}`),
    ).toBeVisible();
  });

  test("sidebar has Private/Teamspaces sections and a '···' page menu", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);

    // Notion-style sections.
    const nav = page.getByRole("navigation", { name: "Documents" });
    await expect(nav.getByText("Private", { exact: true })).toBeVisible();
    await expect(nav.getByText("Teamspaces", { exact: true })).toBeVisible();
    await expect(nav.getByText("My Workspace")).toBeVisible();

    // Inline rename via the row's ··· menu.
    const row = nav
      .getByRole("treeitem")
      .filter({ hasText: docTitle })
      .first();
    await row.hover();
    await row.getByRole("button", { name: /page options/i }).first().click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const renameInput = page.getByLabel("Rename page");
    await renameInput.fill(`${docTitle} renamed`);
    await renameInput.press("Enter");
    await expect(
      nav.getByText(`${docTitle} renamed`).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Rename back so later tests keep working with the original title.
    const renamedRow = nav
      .getByRole("treeitem")
      .filter({ hasText: `${docTitle} renamed` })
      .first();
    await renamedRow.hover();
    await renamedRow
      .getByRole("button", { name: /page options/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByLabel("Rename page").fill(docTitle);
    await page.getByLabel("Rename page").press("Enter");
    await expect(nav.getByText(docTitle).first()).toBeVisible({
      timeout: 10_000,
    });

    // Duplicate, then trash the copy from the same menu.
    const originalRow = nav
      .getByRole("treeitem")
      .filter({ hasText: docTitle })
      .first();
    await originalRow.hover();
    await originalRow
      .getByRole("button", { name: /page options/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: "Duplicate" }).click();
    const copyRow = nav
      .getByRole("treeitem")
      .filter({ hasText: `${docTitle} (copy)` })
      .first();
    await expect(copyRow).toBeVisible({ timeout: 10_000 });

    await copyRow.hover();
    await copyRow
      .getByRole("button", { name: /page options/i })
      .first()
      .click();
    await page.getByRole("menuitem", { name: /move to trash/i }).click();
    await expect(
      nav.getByText(`${docTitle} (copy)`),
    ).toHaveCount(0, { timeout: 10_000 });
  });

  test("'/code' inserts a Notion-style code block with highlighting", async ({
    page,
  }) => {
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);

    const editor = page.locator(".ProseMirror");
    // Click a fixed corner: the element's center could hit the sub-page
    // link inserted by the previous test and navigate away.
    await editor.click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/code");
    await expect(
      page.getByRole("listbox", { name: "Insert block" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("const greet = () => 'hi';");

    const codeBlock = page.locator(".ProseMirror .code-block").first();
    await expect(codeBlock.locator("pre code")).toContainText("const greet");

    // Pick a language from the hover controls → syntax colors appear.
    await codeBlock.hover();
    await codeBlock.getByRole("button", { name: "Code language" }).click();
    await page.getByRole("menuitem", { name: "JavaScript" }).click();
    await expect(codeBlock.locator(".hljs-keyword").first()).toHaveText(
      "const",
    );

    // Copy button copies the code and confirms.
    await codeBlock.hover();
    await codeBlock.getByRole("button", { name: "Copy code" }).click();
    await expect(codeBlock.getByText("Copied")).toBeVisible();

    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Language + content survive a reload.
    await page.reload();
    const reloaded = page.locator(".ProseMirror .code-block").first();
    await expect(reloaded.locator(".hljs-keyword").first()).toHaveText(
      "const",
    );
  });

  test("appearance setting toggles dark mode and defaults to system", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    const html = page.locator("html");

    // Default: sync with system (Playwright emulates light by default).
    await expect(html).not.toHaveClass(/dark/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await expect(page.getByText("Appearance")).toBeVisible();
    await page.getByRole("menuitem", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);

    // Persists across reloads (no flash-managed init script).
    await page.reload();
    await expect(html).toHaveClass(/dark/);

    await page.getByRole("button", { name: "Account menu" }).click();
    await page.getByRole("menuitem", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/dark/);

    // Back to the default for the remaining tests.
    await page.getByRole("menuitem", { name: "Sync with system" }).click();
    await expect(html).not.toHaveClass(/dark/);
    await page.keyboard.press("Escape");
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

  test("share popover publishes to the web", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(docUrl);
    await page.getByRole("button", { name: /^Share/ }).click();
    // Notion-style popover with Share | Publish tabs.
    await expect(page.getByRole("tab", { name: "Share" })).toBeVisible();
    await page.getByRole("tab", { name: "Publish" }).click();
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
    await page.getByRole("tab", { name: "Versions" }).click();
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

    // Trash view lists it (title is "… v2" after the version-history test;
    // match it exactly since a trashed "(copy)" page may also be present).
    await page.getByRole("link", { name: "Trash" }).click();
    await page.waitForURL(/\/trash/);
    const trashedTitle = `${docTitle} v2`;
    await expect(
      page.getByRole("link", { name: trashedTitle, exact: true }),
    ).toBeVisible();
    await shot(page, "07-trash");

    // Restore the parent page specifically (its sub-page is also listed).
    await page
      .locator("li", { hasText: trashedTitle })
      .first()
      .getByRole("button", { name: /restore/i })
      .click();
    await expect(page.getByText("Page restored")).toBeVisible();
    await page.goto(docUrl);
    await expect(page.getByLabel("Document title")).toBeVisible();
  });

  test("users without access get a request-access screen, not content", async ({
    page,
    browser,
  }) => {
    // Demo creates a page in their PERSONAL notebook — inaccessible to
    // everyone else regardless of team memberships.
    const privateTitle = `Private plan ${runId}`;
    await signIn(page, DEMO_EMAIL);
    await page.goto("/app");
    await page.getByRole("link", { name: "Personal notebook" }).first().click();
    await page.waitForURL(/\/app\/[^/]+$/);
    await page.getByRole("button", { name: /new page/i }).first().click();
    await page.waitForURL(/\/docs\//);
    const privateUrl = page.url();
    await page.getByLabel("Document title").fill(privateTitle);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // The other user opens the link → request-access screen, no leak.
    const outsiderContext = await browser.newContext();
    const outsiderPage = await outsiderContext.newPage();
    await signIn(outsiderPage, OUTSIDER_EMAIL);
    await outsiderPage.goto(privateUrl);
    await expect(outsiderPage.getByText("You need access")).toBeVisible();
    await expect(outsiderPage.locator("body")).not.toContainText(privateTitle);
    await shot(outsiderPage, "08-request-access");
    await outsiderPage
      .getByRole("button", { name: /request access/i })
      .click();
    await expect(
      outsiderPage.getByRole("heading", { name: "Request sent" }),
    ).toBeVisible();
    await outsiderContext.close();
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
