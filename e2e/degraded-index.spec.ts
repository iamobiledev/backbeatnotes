import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const ENABLED = process.env.E2E_DEGRADED_INDEX === "1";
const DB =
  process.env.E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1/main";
const EMAIL = process.env.SEED_USER_EMAIL ?? "demo@backbeatnotes.local";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "BackBeatNotesDemo123!";

function psql(query: string) {
  execFileSync("psql", [DB, "-v", "ON_ERROR_STOP=1", "-c", query], {
    stdio: "pipe",
  });
}

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe.serial("document writes without the derived block index", () => {
  test.skip(
    !ENABLED,
    "Set E2E_DEGRADED_INDEX=1 and run this spec in isolation",
  );

  test.beforeAll(() => {
    psql(`
      DO $$
      BEGIN
        IF to_regclass('public.document_search_blocks_unavailable') IS NOT NULL THEN
          ALTER TABLE document_search_blocks_unavailable
            RENAME TO document_search_blocks;
        END IF;
        ALTER TABLE document_search_blocks
          RENAME TO document_search_blocks_unavailable;
      END
      $$;
    `);
  });

  test.afterAll(() => {
    psql(`
      DO $$
      BEGIN
        IF to_regclass('public.document_search_blocks_unavailable') IS NOT NULL THEN
          ALTER TABLE document_search_blocks_unavailable
            RENAME TO document_search_blocks;
        END IF;
      END
      $$;
    `);
  });

  test("create, autosave, reload, search, and subpage remain available", async ({
    page,
  }) => {
    const runId = Date.now().toString(36);
    const title = `Degraded index ${runId}`;
    const body = `Canonical content ${runId}`;
    await signIn(page);
    await page.goto("/app");
    await page.getByRole("link", { name: "My Workspace" }).first().click();
    await page.waitForURL(/\/app\/[^/]+$/);

    await page.getByRole("button", { name: "New page" }).first().click();
    await page.waitForURL(/\/docs\//);
    const parentUrl = page.url();
    await page.getByLabel("Document title").fill(title);
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.type(body);
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await page.reload();
    await expect(page.getByLabel("Document title")).toHaveValue(title);
    await expect(page.locator(".ProseMirror")).toContainText(body);

    const search = await page.request.get(
      `/api/search?q=${encodeURIComponent(runId)}`,
    );
    expect(search.ok()).toBeTruthy();
    const result = (await search.json()) as {
      hits: Array<{ title: string }>;
    };
    expect(result.hits.some((hit) => hit.title === title)).toBe(true);

    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/subpage");
    await expect(
      page.getByRole("listbox", { name: "Insert block" }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await page.waitForURL(
      (url) => url.pathname.includes("/docs/") && url.href !== parentUrl,
      { timeout: 15_000 },
    );

    await page.goto(parentUrl);
    await expect(
      page.locator(".ProseMirror [data-type='subpage'] a"),
    ).toHaveCount(1);
  });
});
