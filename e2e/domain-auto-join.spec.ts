import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

const DEMO_EMAIL = process.env.SEED_USER_EMAIL ?? "demo@backbeatnotes.local";
const SEED_PASSWORD =
  process.env.SEED_USER_PASSWORD ?? "BackBeatNotesDemo123!";
const MEMBER_PASSWORD = "DomainAutoJoin123!";
const DB =
  process.env.E2E_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/main";
const hasDb =
  Boolean(process.env.E2E_HAS_DATABASE) ||
  Boolean(process.env.PLAYWRIGHT_BASE_URL);

function psql(query: string): string {
  return execFileSync("psql", [DB, "-tAc", query], {
    encoding: "utf8",
  }).trim();
}

async function signIn(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app/);
}

/** Sign up through the UI, mark verified in the DB, then sign in. */
async function registerAndSignIn(
  browser: Browser,
  email: string,
  name: string,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(MEMBER_PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify-email/);
  // Email delivery is console-only locally; verify directly like the
  // invitation specs do.
  psql(`UPDATE "user" SET email_verified=true WHERE email='${email}'`);
  await signIn(page, email, MEMBER_PASSWORD);
  return { context, page };
}

test.describe.serial("domain auto-join", () => {
  test.skip(!hasDb, "Requires a seeded database (E2E_HAS_DATABASE=1)");

  const runId = Date.now().toString(36);
  const domain = `autojoin-${runId}.example.com`;
  const memberEmail = `insider-${runId}@${domain}`;
  const outsiderEmail = `outsider-${runId}@elsewhere-${runId}.example.com`;
  let workspaceId = "";

  test.beforeAll(() => {
    workspaceId = psql(
      "SELECT id FROM workspaces WHERE is_personal=false AND name='My Workspace' LIMIT 1",
    );
    expect(workspaceId).toBeTruthy();
  });

  test.afterAll(() => {
    if (workspaceId) {
      psql(
        `UPDATE workspaces SET auto_join_domain=NULL WHERE id='${workspaceId}'`,
      );
    }
  });

  test("admin enables domain access from workspace settings", async ({
    page,
  }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(`/app/${workspaceId}/settings`);
    await expect(
      page.getByRole("heading", { name: "Domain access" }),
    ).toBeVisible();
    await page.getByLabel("Allowed email domain").fill(domain);
    await page
      .locator("section[aria-labelledby='domain-access-heading']")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByText(`Domain access enabled for @${domain}`),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      psql(`SELECT auto_join_domain FROM workspaces WHERE id='${workspaceId}'`),
    ).toBe(domain);
  });

  test("public email domains are rejected", async ({ page }) => {
    await signIn(page, DEMO_EMAIL);
    await page.goto(`/app/${workspaceId}/settings`);
    await page.getByLabel("Allowed email domain").fill("gmail.com");
    await page
      .locator("section[aria-labelledby='domain-access-heading']")
      .getByRole("button", { name: "Save" })
      .click();
    await expect(
      page.getByText(/public email domains like gmail\.com/i),
    ).toBeVisible({ timeout: 15_000 });
    // The stored domain is unchanged.
    expect(
      psql(`SELECT auto_join_domain FROM workspaces WHERE id='${workspaceId}'`),
    ).toBe(domain);
  });

  test("a verified user at the domain auto-joins as member on sign-in", async ({
    browser,
  }) => {
    const { context, page } = await registerAndSignIn(
      browser,
      memberEmail,
      "Domain Insider",
    );

    await expect(page.getByText("My Workspace").first()).toBeVisible({
      timeout: 15_000,
    });
    expect(
      psql(
        `SELECT wm.role FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${memberEmail}'`,
      ),
    ).toBe("member");
    // Plain platform user, not an admin.
    expect(
      psql(`SELECT role FROM "user" WHERE email='${memberEmail}'`),
    ).toBe("developer");
    await context.close();
  });

  test("repeat sign-ins stay idempotent and keep manual role changes", async ({
    browser,
  }) => {
    // Simulate an admin promoting the auto-joined user.
    psql(
      `UPDATE workspace_members SET role='admin' WHERE workspace_id='${workspaceId}' AND user_id=(SELECT id FROM "user" WHERE email='${memberEmail}')`,
    );

    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, memberEmail, MEMBER_PASSWORD);
    await context.close();

    expect(
      psql(
        `SELECT count(*) FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${memberEmail}'`,
      ),
    ).toBe("1");
    expect(
      psql(
        `SELECT wm.role FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${memberEmail}'`,
      ),
    ).toBe("admin");
  });

  test("users at other domains do not join", async ({ browser }) => {
    const { context } = await registerAndSignIn(
      browser,
      outsiderEmail,
      "Outside User",
    );
    await context.close();

    expect(
      psql(
        `SELECT count(*) FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${outsiderEmail}'`,
      ),
    ).toBe("0");
  });

  test("pending guest invite blocks auto-join and applies guest on accept", async ({
    browser,
  }) => {
    const guestEmail = `guest-${runId}@${domain}`;
    const racedEmail = `raced-${runId}@${domain}`;
    const guestToken = `guest-invite-${runId}`;
    const racedToken = `raced-invite-${runId}`;
    const demoUserId = psql(
      `SELECT id FROM "user" WHERE email='${DEMO_EMAIL}' LIMIT 1`,
    );
    expect(demoUserId).toBeTruthy();

    psql(
      `INSERT INTO workspace_invitations (id, workspace_id, email, role, token, status, invited_by_id, expires_at)
       VALUES
       (
         'inv-guest-${runId}',
         '${workspaceId}',
         '${guestEmail}',
         'guest',
         '${guestToken}',
         'pending',
         '${demoUserId}',
         NOW() + INTERVAL '7 days'
       ),
       (
         'inv-raced-${runId}',
         '${workspaceId}',
         '${racedEmail}',
         'guest',
         '${racedToken}',
         'pending',
         '${demoUserId}',
         NOW() + INTERVAL '7 days'
       )`,
    );

    const { context, page } = await registerAndSignIn(
      browser,
      guestEmail,
      "Domain Guest",
    );

    // Auto-join must not create a member row while the guest invite is pending.
    expect(
      psql(
        `SELECT count(*) FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${guestEmail}'`,
      ),
    ).toBe("0");

    await page.goto(`/invitations/${guestToken}`);
    await expect(
      page.getByRole("button", { name: "Accept invitation" }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await page.waitForURL(`/app/${workspaceId}`, { timeout: 30_000 });

    expect(
      psql(
        `SELECT wm.role FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${guestEmail}'`,
      ),
    ).toBe("guest");
    expect(
      psql(
        `SELECT status FROM workspace_invitations WHERE token='${guestToken}'`,
      ),
    ).toBe("accepted");
    await context.close();

    // Race cover: if a member row already exists (e.g. auto-join won), accept
    // still applies the invited guest role instead of leaving them as member.
    const raced = await registerAndSignIn(
      browser,
      racedEmail,
      "Raced Guest",
    );
    const racedUserId = psql(
      `SELECT id FROM "user" WHERE email='${racedEmail}' LIMIT 1`,
    );
    psql(
      `INSERT INTO workspace_members (id, workspace_id, user_id, role)
       VALUES ('wm-raced-${runId}', '${workspaceId}', '${racedUserId}', 'member')
       ON CONFLICT DO NOTHING`,
    );
    await raced.page.goto(`/invitations/${racedToken}`);
    await expect(
      raced.page.getByRole("button", { name: "Accept invitation" }),
    ).toBeVisible({ timeout: 15_000 });
    await raced.page.getByRole("button", { name: "Accept invitation" }).click();
    await raced.page.waitForURL(`/app/${workspaceId}`, { timeout: 30_000 });
    expect(
      psql(
        `SELECT wm.role FROM workspace_members wm JOIN "user" u ON u.id=wm.user_id WHERE wm.workspace_id='${workspaceId}' AND u.email='${racedEmail}'`,
      ),
    ).toBe("guest");
    await raced.context.close();
  });
});
