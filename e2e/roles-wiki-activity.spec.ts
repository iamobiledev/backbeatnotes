import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

/**
 * E2E for round-2 features: wiki locking, activity log, admin/developer
 * user types, invitation resend UI, and the notifications toggle.
 * Requires a seeded local DB (`pnpm db:seed`).
 */

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? "demo@backbeatnotes.local";
const OUTSIDER_EMAIL =
  process.env.SEED_OUTSIDER_EMAIL ?? "teammate@backbeatnotes.local";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "BackBeatNotesDemo123!";
const DB =
  process.env.E2E_DATABASE_URL ??
  "postgresql://docloom:docloom@localhost:5432/docloom";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "";

const hasDb =
  Boolean(process.env.E2E_HAS_DATABASE) ||
  Boolean(process.env.PLAYWRIGHT_BASE_URL);

function psql(query: string): string {
  return execSync(`psql "${DB}" -tAc "${query.replace(/"/g, '\\"')}"`)
    .toString()
    .trim();
}

async function shot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}.png` });
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/);
}

test.describe.serial("wikis, roles, activity, invitations", () => {
  test.skip(!hasDb, "Requires a seeded database (E2E_HAS_DATABASE=1)");

  const runId = Date.now().toString(36);
  let wsId = "";
  let wikiUrl = "";

  test.beforeAll(() => {
    wsId = psql(
      "SELECT id FROM workspaces WHERE is_personal=false AND name='My Workspace' LIMIT 1",
    );
    // Ensure the teammate is an editor-level member so the lock demotion
    // is observable, and demo is a platform admin (seed guarantees it).
    const teammateId = psql(
      `SELECT id FROM \"user\" WHERE email='${OUTSIDER_EMAIL}'`,
    );
    psql(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('e2em-${runId}', '${wsId}', '${teammateId}', 'member') ON CONFLICT (workspace_id, user_id) DO UPDATE SET role='member'`,
    );
  });

  test("admin creates a wiki and locks it; activity is recorded", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(`/app/${wsId}`);

    await page.getByRole("button", { name: /new wiki/i }).click();
    await page.waitForURL(/\/docs\//);
    wikiUrl = page.url();
    await expect(page.getByText("Wiki", { exact: true })).toBeVisible();

    await page.getByLabel("Document title").fill(`Team Handbook ${runId}`);
    const editor = page.locator(".ProseMirror");
    await editor.click();
    await page.keyboard.type("Rules of engagement for the team.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    // Lock it.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /lock wiki/i }).click();
    await expect(
      page.getByText(/locked — you can edit it because you're an admin/i),
    ).toBeVisible({ timeout: 10_000 });
    await shot(page, "18-wiki-locked-admin");

    // Activity log shows created + edits + lock.
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /version history/i }).click();
    await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();
    await expect(page.getByText(/created this wiki/i)).toBeVisible();
    await expect(page.getByText(/made changes/i).first()).toBeVisible();
    await expect(page.getByText(/locked this wiki/i)).toBeVisible();
    await shot(page, "19-activity-log");
    await page.keyboard.press("Escape");
  });

  test("locked wiki is read-only for editor-level members", async ({
    page,
  }) => {
    await signIn(page, OUTSIDER_EMAIL);
    await page.goto(wikiUrl);
    await expect(
      page.getByText(/locked\. only admins can make changes/i),
    ).toBeVisible();
    // Read-only: no editable title input and no lock menu item.
    await expect(page.getByLabel("Document title")).toHaveCount(0);
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: /lock wiki|unlock wiki/i }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await shot(page, "20-wiki-locked-member");
  });

  test("unlocking restores editing for members", async ({ page, browser }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(wikiUrl);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /unlock wiki/i }).click();
    await expect(page.getByText(/unlocked/i).first()).toBeVisible();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, OUTSIDER_EMAIL);
    await memberPage.goto(wikiUrl);
    await expect(memberPage.getByLabel("Document title")).toBeVisible();
    await memberContext.close();
  });

  test("developers cannot create workspaces", async ({ page }) => {
    await signIn(page, OUTSIDER_EMAIL);
    await page.goto("/app/new");
    await expect(
      page.getByRole("heading", { name: "Admins only" }),
    ).toBeVisible();
    await shot(page, "21-admins-only");
  });

  test("invitations show sent time and can be re-sent", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(`/app/${wsId}/settings`);
    const inviteEmail = `delivered+${runId}@resend.dev`;
    await page.getByLabel("Email", { exact: true }).fill(inviteEmail);
    await page.getByRole("button", { name: /send invite/i }).click();
    await expect(page.getByText(`Invitation sent to ${inviteEmail}`)).toBeVisible(
      { timeout: 15_000 },
    );

    const row = page
      .locator("li")
      .filter({ hasText: inviteEmail })
      .first();
    await expect(row.getByText(/email sent less than a minute ago/i)).toBeVisible();
    await row.getByRole("button", { name: "Resend" }).click();
    await expect(
      page.getByText(`Invitation re-sent to ${inviteEmail}`),
    ).toBeVisible({ timeout: 15_000 });
    await shot(page, "22-invitation-resend");

    // Clean up the pending invitation.
    await row.getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.getByText(`Invitation to ${inviteEmail} revoked`),
    ).toBeVisible();
  });

  test("email notifications toggle round-trips", async ({ page }) => {
    // Normalize state: an interrupted earlier run can leave the flag off.
    psql(
      `UPDATE \"user\" SET email_notifications = true WHERE email='${DEMO_EMAIL}'`,
    );
    await signIn(page, DEMO_EMAIL);
    await page.goto(`/app/${wsId}/settings`);
    const toggle = page.getByRole("switch", {
      name: /email me about page changes/i,
    });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(page.getByText(/notifications off/i)).toBeVisible();
    expect(
      psql(
        `SELECT email_notifications FROM \"user\" WHERE email='${DEMO_EMAIL}'`,
      ),
    ).toBe("f");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });
});
