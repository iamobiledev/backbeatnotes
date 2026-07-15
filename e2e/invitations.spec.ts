import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? "demo@backbeatnotes.local";
const EXISTING_EMAIL =
  process.env.SEED_OUTSIDER_EMAIL ?? "teammate@backbeatnotes.local";
const SEED_PASSWORD =
  process.env.SEED_USER_PASSWORD ?? "BackBeatNotesDemo123!";
const INVITEE_PASSWORD = "InvitationFlow123!";
const DB =
  process.env.E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/main";
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "";
const hasDb =
  Boolean(process.env.E2E_HAS_DATABASE) ||
  Boolean(process.env.PLAYWRIGHT_BASE_URL);

function psql(query: string): string {
  return execFileSync("psql", [DB, "-tAc", query], {
    encoding: "utf8",
  }).trim();
}

async function shot(page: Page, name: string) {
  if (!SCREENSHOT_DIR) return;
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: true,
  });
}

async function signIn(
  page: Page,
  email: string,
  password = SEED_PASSWORD,
) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

async function inviteWorkspaceMember(
  page: Page,
  workspaceId: string,
  email: string,
) {
  await page.goto(`/app/${workspaceId}/settings`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: /send invite/i }).click();
  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible({
    timeout: 15_000,
  });
  return psql(
    `SELECT token FROM workspace_invitations WHERE workspace_id='${workspaceId}' AND email='${email}' AND status='pending' ORDER BY created_at DESC LIMIT 1`,
  );
}

async function registerFromInvitation(
  browser: Browser,
  token: string,
  email: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`/invitations/${token}`);
  await expect(page).toHaveURL(new RegExp(`/invitations/${token}$`));
  await expect(page.getByLabel("Email")).toHaveValue(email);
  await expect(page.getByLabel("Email")).toHaveAttribute("readonly", "");
  await page.getByLabel("Name").fill("Invited Collaborator");
  await page.getByLabel("Create password").fill(INVITEE_PASSWORD);
  await page.getByLabel("Confirm password").fill(INVITEE_PASSWORD);
  await page
    .getByRole("button", { name: "Set password and continue" })
    .click();
  return { context, page };
}

test.describe.serial("invitation onboarding", () => {
  test.skip(!hasDb, "Requires a seeded database (E2E_HAS_DATABASE=1)");

  const runId = Date.now().toString(36);
  const workspaceInvitee = `workspace-invite-${runId}@example.com`;
  const documentInvitee = `document-invite-${runId}@example.com`;
  let workspaceId = "";

  test.beforeAll(() => {
    workspaceId = psql(
      "SELECT id FROM workspaces WHERE is_personal=false AND name='My Workspace' LIMIT 1",
    );
    expect(workspaceId).toBeTruthy();
  });

  test("new workspace invitee sets a password, accepts, and can sign in later", async ({
    page,
    browser,
  }) => {
    await signIn(page, DEMO_EMAIL);
    const token = await inviteWorkspaceMember(
      page,
      workspaceId,
      workspaceInvitee,
    );
    expect(token).toBeTruthy();

    const invitee = await registerFromInvitation(
      browser,
      token,
      workspaceInvitee,
    );
    await expect(
      invitee.page.getByRole("button", { name: "Accept invitation" }),
    ).toBeVisible({ timeout: 15_000 });
    await shot(
      invitee.page,
      `34-workspace-invitation-ready-to-accept-${runId}`,
    );
    expect(
      psql(
        `SELECT email_verified FROM "user" WHERE email='${workspaceInvitee}'`,
      ),
    ).toBe("t");

    await invitee.page
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await invitee.page.waitForURL(`/app/${workspaceId}`);
    await expect(invitee.page.getByText("My Workspace").first()).toBeVisible();
    expect(
      psql(
        `SELECT wm.role FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${workspaceInvitee}'`,
      ),
    ).toBe("member");
    await shot(invitee.page, `36-workspace-invitation-accepted-${runId}`);
    await invitee.context.close();

    const laterContext = await browser.newContext();
    const laterPage = await laterContext.newPage();
    await signIn(laterPage, workspaceInvitee, INVITEE_PASSWORD);
    await expect(laterPage.getByText("My Workspace").first()).toBeVisible();
    await laterContext.close();
  });

  test("existing account signs in inline before accepting", async ({
    page,
    browser,
  }) => {
    await signIn(page, DEMO_EMAIL);
    const token = await inviteWorkspaceMember(
      page,
      workspaceId,
      EXISTING_EMAIL,
    );

    const context = await browser.newContext();
    const invitee = await context.newPage();
    await invitee.goto(`/invitations/${token}`);
    await expect(
      invitee.getByRole("heading", { name: "Sign in to continue" }),
    ).toBeVisible();
    await expect(invitee.getByLabel("Name")).toHaveCount(0);
    await invitee.getByLabel("Password").fill(SEED_PASSWORD);
    await invitee
      .getByRole("button", { name: "Sign in and continue" })
      .click();
    await expect(
      invitee.getByRole("button", { name: "Accept invitation" }),
    ).toBeVisible({ timeout: 15_000 });
    await invitee
      .getByRole("button", { name: "Accept invitation" })
      .click();
    await invitee.waitForURL(`/app/${workspaceId}`);
    await context.close();
  });

  test("new document invitee sets a password and opens the shared page", async ({
    page,
    browser,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto("/app");
    await page
      .getByRole("link", { name: "Personal notebook" })
      .first()
      .click();
    await page.getByRole("button", { name: /new page/i }).first().click();
    await page.waitForURL(/\/docs\//);
    const documentId = new URL(page.url()).pathname.split("/").at(-1)!;
    const title = `Invitation page ${runId}`;
    await page.getByLabel("Document title").fill(title);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(page.getByText("Saved", { exact: true })).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: /^Share/ }).click();
    await page
      .getByPlaceholder("Email or group, separated by commas")
      .fill(documentInvitee);
    await page.getByRole("button", { name: "Access level for invitees" }).click();
    await page.getByRole("menuitem", { name: "Can view" }).click();
    await page.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(page.getByText(/invitation sent to/i)).toBeVisible({
      timeout: 10_000,
    });
    const token = psql(
      `SELECT token FROM document_invitations WHERE document_id='${documentId}' AND email='${documentInvitee}' AND status='pending' ORDER BY created_at DESC LIMIT 1`,
    );

    const invitee = await registerFromInvitation(
      browser,
      token,
      documentInvitee,
    );
    await expect(
      invitee.page.getByRole("button", { name: "Open the page" }),
    ).toBeVisible({ timeout: 15_000 });
    await shot(
      invitee.page,
      `35-document-invitation-ready-to-open-${runId}`,
    );
    await invitee.page.getByRole("button", { name: "Open the page" }).click();
    await invitee.page.waitForURL(new RegExp(`/docs/${documentId}$`));
    await expect(
      invitee.page.getByRole("heading", { name: title }),
    ).toBeVisible();
    await expect(invitee.page.locator(".ProseMirror")).toHaveCount(0);
    await shot(invitee.page, `37-document-invitation-opened-${runId}`);
    await invitee.context.close();
  });

  test("unknown token never exposes an account form", async ({ page }) => {
    await page.goto(`/invitations/unknown-${runId}`);
    await expect(
      page.getByRole("heading", { name: "Invitation not found" }),
    ).toBeVisible();
    await expect(page.getByLabel("Create password")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /continue/i })).toHaveCount(
      0,
    );
  });
});
