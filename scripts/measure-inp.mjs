/**
 * Lab harness: measure Event Timing for card subtitle clicks after sign-in.
 * Prevents navigation so the performance context survives the measured click.
 * Usage: node scripts/measure-inp.mjs
 */
import { chromium } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_USER_EMAIL ?? "demo@backbeatnotes.local";
const PASSWORD = process.env.SEED_USER_PASSWORD ?? "BackBeatNotesDemo123!";

async function installObservers(page) {
  await page.evaluate(() => {
    window.__inpEvents = [];
    window.__longTasks = [];
    if (!window.__inpObserving) {
      window.__inpObserving = true;
      try {
        const eventObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const target =
              entry.target && entry.target instanceof Element
                ? `${entry.target.tagName.toLowerCase()}.${[...entry.target.classList]
                    .slice(0, 8)
                    .join(".")}${entry.target.id ? "#" + entry.target.id : ""}`
                : null;
            window.__inpEvents.push({
              name: entry.name,
              duration: Number(entry.duration.toFixed(1)),
              inputDelay: Number(
                (entry.processingStart - entry.startTime).toFixed(1),
              ),
              processing: Number(
                (entry.processingEnd - entry.processingStart).toFixed(1),
              ),
              target,
            });
          }
        });
        eventObs.observe({
          type: "event",
          buffered: true,
          durationThreshold: 16,
        });
      } catch {
        // ignore
      }
      try {
        const longObs = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__longTasks.push({
              duration: Number(entry.duration.toFixed(1)),
              startTime: Number(entry.startTime.toFixed(1)),
            });
          }
        });
        longObs.observe({ type: "longtask", buffered: true });
      } catch {
        // ignore
      }
    }
  });
}

async function measureClick(page, locator, label) {
  await installObservers(page);
  await page.evaluate(() => {
    window.__inpEvents = [];
    window.__longTasks = [];
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

  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.__inpEvents = [];
    window.__longTasks = [];
  });
  await locator.click({ force: true });
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => ({
    path: location.pathname,
    events: window.__inpEvents,
    longTasks: window.__longTasks.slice(-10),
  }));
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await Promise.all([
    page.waitForURL(/\/app/, { timeout: 30_000 }),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  console.log("landed_on", new URL(page.url()).pathname);

  await measureClick(
    page,
    page.getByText("Only you can see these pages"),
    "workspace-picker",
  );

  await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /My Workspace/i }).click();
  await page.waitForURL(/\/app\/[^/]+$/);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);

  const recentSubtitle = page
    .locator("section[aria-labelledby='recent-heading'] a span.block.text-xs")
    .first();
  await measureClick(page, recentSubtitle, "workspace-home-recent");

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
