/**
 * Work-order lifecycle check for the RentNotice Pro desktop app
 * (artifacts/rentnotice-pro, served at /app/).
 *
 * Verifies end-to-end, in a real browser, that:
 *   1. A work order can be created from the Maintenance page and renders in
 *      the list view.
 *   2. The inline status select walks it through
 *      assigned → in progress → completed, and a completed order drops out
 *      of the default "Open" filter but reappears under "All statuses".
 *   3. The priority filter narrows the list correctly.
 *   4. The board view shows the order in the Completed column.
 *   5. The detail dialog records the status history and shows the Photos
 *      section.
 *   6. The work order appears in the property's Maintenance history tab.
 *
 * The app is an offline-first SPA (sql.js + IndexedDB per browser context),
 * so the scenario boots a fresh context to the first-run screen, enters the
 * seeded demo workspace, and signs in as the demo admin. The session is
 * in-memory, so all navigation after login happens via SPA clicks.
 *
 * Requires the rentnotice-pro web workflow to be running (reachable through
 * the local proxy on port 80).
 */

import { execSync } from "node:child_process";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.WORK_ORDER_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const DEMO_IDENTIFIER = "arivera";
const DEMO_SECRET = "1234";
const TIMEOUT_MS = 30_000;

const WO_TITLE = `E2E check — leaky faucet ${Date.now()}`;

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error(`  FAIL  ${message}`);
}

function pass(message: string): void {
  console.log(`  ok    ${message}`);
}

function resolveChromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try {
    return execSync("which chromium", { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

/** Enter the demo workspace from a fresh context and sign in as the demo admin. */
async function enterDemoAndLogin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${APP_PATH}`, { waitUntil: "load", timeout: TIMEOUT_MS });

  const exploreDemo = page.locator('[data-testid="button-explore-demo"]');
  await exploreDemo.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await exploreDemo.click();

  const identifier = page.locator('[data-testid="input-login-identifier"]');
  await identifier.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await identifier.fill(DEMO_IDENTIFIER);
  await page.locator('[data-testid="input-login-secret"]').fill(DEMO_SECRET);
  await page.locator('[data-testid="button-login"]').click();

  await sidebarButton(page, "Dashboard").waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

function sidebarButton(page: Page, label: string) {
  return page.locator("button", { hasText: label }).first();
}

/** Open a Radix select by trigger testid and pick the option with exact `optionText`. */
async function pickSelect(page: Page, triggerTestId: string, optionText: string): Promise<void> {
  await page.locator(`[data-testid="${triggerTestId}"]`).click();
  const option = page
    .locator('[role="option"]')
    .filter({ hasText: new RegExp(`^${optionText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) })
    .first();
  await option.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await option.click();
}

/**
 * Open a Radix select and pick the FIRST option, returning its text.
 * Used to grab whichever seeded demo property comes first.
 */
async function pickFirstOption(page: Page, triggerTestId: string): Promise<string> {
  await page.locator(`[data-testid="${triggerTestId}"]`).click();
  const option = page.locator('[role="option"]').first();
  await option.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  const text = (await option.textContent())?.trim() ?? "";
  await option.click();
  return text;
}

/** Create a work order from the Maintenance page; returns the property nickname used. */
async function createWorkOrder(page: Page): Promise<string> {
  await sidebarButton(page, "Maintenance").click();
  const newButton = page.locator('[data-testid="button-new-work-order"]');
  await newButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await newButton.click();

  await page.locator('[data-testid="input-title"]').waitFor({ state: "visible", timeout: TIMEOUT_MS });
  const propertyNickname = await pickFirstOption(page, "select-property");
  await page.locator('[data-testid="input-title"]').fill(WO_TITLE);
  await pickSelect(page, "select-category", "Plumbing");
  await pickSelect(page, "select-priority", "High");
  await page.locator('[data-testid="button-create-work-order"]').click();
  await page
    .locator('[data-testid="input-title"]')
    .waitFor({ state: "hidden", timeout: TIMEOUT_MS });
  return propertyNickname;
}

function listCard(page: Page) {
  return page
    .locator('[data-testid^="card-work-order-"]')
    .filter({ hasText: WO_TITLE })
    .first();
}

async function main(): Promise<void> {
  try {
    const probe = await fetch(`${BASE_URL}${APP_PATH}`, { signal: AbortSignal.timeout(10_000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(
      `Cannot reach the app at ${BASE_URL}${APP_PATH} (${err instanceof Error ? err.message : String(err)}). ` +
        "Make sure the rentnotice-pro web workflow is running.",
    );
    process.exit(1);
  }

  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  try {
    console.log(`Work-order lifecycle check against ${BASE_URL}${APP_PATH}`);
    await enterDemoAndLogin(page);

    // ---- 1. create + renders in list ----
    const propertyNickname = await createWorkOrder(page);
    const card = listCard(page);
    await card.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass(`created work order renders in the list (property: ${propertyNickname})`);

    const cardTestId = (await card.getAttribute("data-testid")) ?? "";
    const woId = cardTestId.replace("card-work-order-", "");
    if (!woId) {
      fail("could not extract the work order id from the list card");
      throw new Error("no work order id");
    }

    // ---- 2. status walk via the inline select ----
    for (const label of ["Assigned", "In Progress"]) {
      await pickSelect(page, `select-status-${woId}`, label);
      const badge = listCard(page).locator(`text=${label}`).first();
      await badge.waitFor({ state: "visible", timeout: TIMEOUT_MS });
      pass(`status changed to ${label} and renders on the card`);
    }

    await pickSelect(page, `select-status-${woId}`, "Completed");
    await page
      .locator(`[data-testid="card-work-order-${woId}"]`)
      .waitFor({ state: "detached", timeout: TIMEOUT_MS });
    pass('completed order drops out of the default "Open" filter');

    await pickSelect(page, "select-status-filter", "All statuses");
    await listCard(page).waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass('completed order reappears under "All statuses"');

    // ---- 3. priority filter ----
    await pickSelect(page, "select-priority-filter", "High");
    if (await listCard(page).isVisible()) {
      pass("priority filter High keeps the high-priority order visible");
    } else {
      fail("priority filter High hid the high-priority order");
    }
    await pickSelect(page, "select-priority-filter", "Low");
    await page
      .locator(`[data-testid="card-work-order-${woId}"]`)
      .waitFor({ state: "detached", timeout: TIMEOUT_MS })
      .then(() => pass("priority filter Low hides the high-priority order"))
      .catch(() => fail("priority filter Low still shows the high-priority order"));
    await pickSelect(page, "select-priority-filter", "All priorities");

    // ---- 4. board view ----
    await page.locator('[data-testid="button-view-board"]').click();
    const boardCard = page
      .locator('[data-testid="board-column-completed"]')
      .locator(`[data-testid="board-card-${woId}"]`);
    await boardCard.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("board view shows the order in the Completed column");

    // ---- 5. detail dialog: history + photos section ----
    await boardCard.click();
    const dialog = page.locator('[data-testid="dialog-work-order-detail"]');
    await dialog.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    const historyEntries = dialog.locator("text=In Progress");
    if ((await historyEntries.count()) > 0) {
      pass("detail dialog records the In Progress status change in history");
    } else {
      fail("detail dialog history does not mention the In Progress status change");
    }
    if ((await dialog.locator('[data-testid="button-add-photo"]').count()) > 0) {
      pass("detail dialog shows the Photos section with an Add Photo control");
    } else {
      fail("detail dialog is missing the Photos section / Add Photo control");
    }
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden", timeout: TIMEOUT_MS });

    // ---- 6. property maintenance history ----
    await sidebarButton(page, "Properties").click();
    const propertyLink = page
      .locator('a[href*="/properties/"]')
      .filter({ hasText: propertyNickname })
      .first();
    await propertyLink.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await propertyLink.click();
    const maintenanceTab = page.locator('[role="tab"]', { hasText: "Maintenance" }).first();
    await maintenanceTab.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await maintenanceTab.click();
    const historyRow = page
      .locator(`[data-testid="row-work-order-${woId}"]`)
      .or(page.locator(`[data-testid^="row-work-order-"]`).filter({ hasText: WO_TITLE }))
      .first();
    await historyRow.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("work order appears in the property's Maintenance history tab");

    // ---- 7. maintenance summary in Reports ----
    await sidebarButton(page, "Reports").click();
    const summaryCard = page.locator('[data-testid="card-maintenance-summary"]');
    await summaryCard.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    const completedRow = summaryCard.locator(
      '[data-testid="row-report-completed-work-orders"]',
    );
    await completedRow.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    const completedCount = Number((await completedRow.locator("span").last().textContent())?.trim());
    if (Number.isFinite(completedCount) && completedCount >= 1) {
      pass(`Reports maintenance summary counts the completed order (completed: ${completedCount})`);
    } else {
      fail(`Reports maintenance summary shows an unexpected completed count: ${completedCount}`);
    }
    if ((await summaryCard.locator('[data-testid="row-report-open-work-orders"]').count()) > 0) {
      pass("Reports maintenance summary shows the open work order count");
    } else {
      fail("Reports maintenance summary is missing the open work order count");
    }
  } finally {
    await context.close();
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} work-order check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll work-order lifecycle checks passed.");
}

main().catch((err) => {
  console.error("Work-order check crashed:", err);
  process.exit(1);
});
