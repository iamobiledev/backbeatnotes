import { test, expect, type Page } from "@playwright/test";

const EMAIL = process.env.SEED_USER_EMAIL ?? "demo@backbeatnotes.local";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "BackBeatNotesDemo123!";

/**
 * Regression for Interaction Timing attributed to
 * `span.mt-0.5.block.text-xs.text-[var(--muted-foreground)]` on workspace
 * picker / Recent cards. High input delay came from AppShell DocumentTree
 * hydration overlapping the click after soft sign-in navigation.
 *
 * Event Timing only reports entries ≥16ms by default. Zero reported events
 * after a click means the interaction was faster than that threshold (good).
 */
async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await page.waitForLoadState("networkidle");
}

type EventTimingEntry = PerformanceEntry & {
  processingStart: number;
};

async function measureCardSubtitleClick(page: Page, subtitleText: RegExp | string) {
  await page.evaluate(() => {
    window.__inpEvents = [];
    if (!window.__inpObserving) {
      window.__inpObserving = true;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as EventTimingEntry[]) {
          window.__inpEvents.push({
            name: entry.name,
            duration: entry.duration,
            inputDelay: entry.processingStart - entry.startTime,
          });
        }
      });
      observer.observe({
        type: "event",
        buffered: true,
        durationThreshold: 16,
      } as PerformanceObserverInit);
    }
    document.addEventListener(
      "click",
      (event) => {
        const link =
          event.target instanceof Element ? event.target.closest("a") : null;
        if (link) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true,
    );
  });

  const subtitle = page.locator("span").filter({ hasText: subtitleText }).first();
  await expect(subtitle).toBeVisible({ timeout: 15_000 });
  // Let dynamic DocumentTree / hydration settle before measuring.
  await page.waitForTimeout(1_200);
  await page.evaluate(() => {
    window.__inpEvents = [];
  });
  await subtitle.click({ force: true });
  await page.waitForTimeout(400);

  return page.evaluate(() => {
    const events = window.__inpEvents ?? [];
    const worst = events.reduce(
      (max, event) => (event.duration > max.duration ? event : max),
      { name: "none", duration: 0, inputDelay: 0 },
    );
    return { worst, events };
  });
}

declare global {
  interface Window {
    __inpEvents: Array<{
      name: string;
      duration: number;
      inputDelay: number;
    }>;
    __inpObserving?: boolean;
  }
}

test.describe("workspace card INP", () => {
  test.beforeEach(() => {
    test.skip(
      !process.env.E2E_HAS_DATABASE,
      "Requires E2E_HAS_DATABASE=1 and a running app with seed data",
    );
  });

  test("workspace picker subtitle click stays within INP budget", async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();

    const { worst, events } = await measureCardSubtitleClick(
      page,
      /Only you can see these pages|Owner|Admin|Editor|Viewer/,
    );

    // No Event Timing entries ⇒ every interaction was under the 16ms floor.
    if (events.length === 0) return;

    expect(
      worst.duration,
      `INP candidate too slow: ${JSON.stringify(worst)}`,
    ).toBeLessThan(200);
    expect(
      worst.inputDelay,
      `input delay too high: ${JSON.stringify(worst)}`,
    ).toBeLessThan(100);
  });

  test("workspace Recent subtitle click stays within INP budget", async ({
    page,
  }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();

    // Prefer the seeded shared workspace (has documents / Recent).
    await page.getByRole("link", { name: /My Workspace/i }).click();
    await page.waitForURL(/\/app\/[^/]+$/, { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("heading", { name: /Recent/i })).toBeVisible({
      timeout: 15_000,
    });

    // Relative time subtitles under Recent cards match the attributed selector.
    const recentCard = page
      .locator("section[aria-labelledby='recent-heading'] a")
      .first();
    await expect(recentCard).toBeVisible();

    await page.evaluate(() => {
      window.__inpEvents = [];
      if (!window.__inpObserving) {
        window.__inpObserving = true;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as EventTimingEntry[]) {
            window.__inpEvents.push({
              name: entry.name,
              duration: entry.duration,
              inputDelay: entry.processingStart - entry.startTime,
            });
          }
        });
        observer.observe({
          type: "event",
          buffered: true,
          durationThreshold: 16,
        } as PerformanceObserverInit);
      }
      document.addEventListener(
        "click",
        (event) => {
          const link =
            event.target instanceof Element ? event.target.closest("a") : null;
          if (link) {
            event.preventDefault();
            event.stopPropagation();
          }
        },
        true,
      );
    });

    await page.waitForTimeout(1_500);
    await page.evaluate(() => {
      window.__inpEvents = [];
    });

    const subtitle = recentCard.locator("span.block.text-xs").first();
    await expect(subtitle).toBeVisible();
    await subtitle.click({ force: true });
    await page.waitForTimeout(400);

    const { worst, events } = await page.evaluate(() => {
      const list = window.__inpEvents ?? [];
      const worstEvent = list.reduce(
        (max, event) => (event.duration > max.duration ? event : max),
        { name: "none", duration: 0, inputDelay: 0 },
      );
      return { worst: worstEvent, events: list };
    });

    if (events.length === 0) return;

    expect(
      worst.duration,
      `INP candidate too slow: ${JSON.stringify(worst)}`,
    ).toBeLessThan(200);
    expect(
      worst.inputDelay,
      `input delay too high: ${JSON.stringify(worst)}`,
    ).toBeLessThan(100);
  });
});
