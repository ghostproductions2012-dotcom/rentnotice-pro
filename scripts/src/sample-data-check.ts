/**
 * Sample-data lifecycle check for the RentNotice Pro desktop app
 * (artifacts/rentnotice-pro, served at /app/).
 *
 * Verifies end-to-end, in a real browser, that:
 *   1. The Settings page shows the Sample Data card with the customize form,
 *      and the sidebar has no sample badge before loading.
 *   2. Loading with a couple of custom fields filled (total doors + late
 *      payers) completes, flips the card into its "loaded" state, and shows
 *      the sidebar "Sample data" badge.
 *   3. The generated door count (units) honors the requested total doors —
 *      read back from the audit log entry the load writes.
 *   4. The Properties list grows by exactly the number of sample properties
 *      reported by the load.
 *   5. Removing sample data restores the pre-load state: property count back
 *      to baseline, badge gone, card back to its "load" state, and a removal
 *      audit entry recorded.
 *
 * The app is an offline-first SPA (sql.js + IndexedDB per browser context),
 * so the scenario boots a fresh context to the first-run screen, enters the
 * seeded demo workspace, and signs in as the demo admin. The session is
 * in-memory, so all navigation after login happens via SPA clicks (page.goto
 * would log us out).
 *
 * Requires the rentnotice-pro web workflow to be running (reachable through
 * the local proxy on port 80).
 */

import { execSync } from "node:child_process";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.SAMPLE_DATA_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const DEMO_IDENTIFIER = "arivera";
const DEMO_SECRET = "1234";
const TIMEOUT_MS = 30_000;
// Loading generates properties, tenants, ledgers, and notices in batches
// that yield to the UI, so give it extra headroom.
const LOAD_TIMEOUT_MS = 120_000;

const CUSTOM_TOTAL_DOORS = 60;
const CUSTOM_LATE_PAYER_PCT = 50;

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

/** Count property cards on the Properties list (navigates there via the sidebar). */
async function countPropertyCards(page: Page): Promise<number> {
  await sidebarButton(page, "Properties").click();
  // Either at least one card or the empty state renders once loading is done.
  const anyCard = page.locator('a[href*="/properties/"]').first();
  const emptyState = page.locator('[data-testid="button-add-property-empty"]');
  await anyCard.or(emptyState).waitFor({ state: "visible", timeout: TIMEOUT_MS });
  return page.locator('a[href*="/properties/"]').count();
}

/**
 * Read the newest "Loaded sample portfolio" audit entry and parse the
 * property/unit counts out of its summary.
 */
async function readLoadAuditStats(
  page: Page,
): Promise<{ properties: number; units: number } | null> {
  await sidebarButton(page, "Audit Log").click();
  const entry = page.locator("text=/Loaded sample portfolio:/").first();
  try {
    await entry.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  } catch {
    return null;
  }
  const text = (await entry.textContent()) ?? "";
  const m = text.match(/(\d+) properties, (\d+) units/);
  if (!m) return null;
  return { properties: Number(m[1]), units: Number(m[2]) };
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
    console.log(`Sample-data lifecycle check against ${BASE_URL}${APP_PATH}`);
    await enterDemoAndLogin(page);

    // ---- baseline ----
    const baselineProperties = await countPropertyCards(page);
    pass(`baseline Properties list has ${baselineProperties} card(s)`);

    // ---- 1. settings card + customize form, no badge yet ----
    await sidebarButton(page, "Settings").click();
    const card = page.locator('[data-testid="card-sample-data"]');
    await card.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("Settings shows the Sample Data card");

    if (await page.locator('[data-testid="badge-sample-data"]').isVisible()) {
      fail("sidebar sample-data badge is visible before any sample data was loaded");
    } else {
      pass("no sidebar sample-data badge before loading");
    }

    const loadButton = page.locator('[data-testid="button-load-sample-data"]');
    await loadButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    if (!(await loadButton.isEnabled())) {
      const reason = await page
        .locator('[data-testid="text-sample-blocked-reason"]')
        .textContent()
        .catch(() => null);
      fail(`Load sample data button is disabled for the demo admin (${reason ?? "no reason shown"})`);
      throw new Error("cannot proceed: loading is blocked");
    }

    await page.locator('[data-testid="button-customize-sample-data"]').click();
    const optionsForm = page.locator('[data-testid="form-sample-options"]');
    await optionsForm.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("Customize opens the options form");

    // ---- 2. load with custom fields (others left blank → defaults) ----
    await page
      .locator('[data-testid="input-sample-totalDoors"]')
      .fill(String(CUSTOM_TOTAL_DOORS));
    await page
      .locator('[data-testid="input-sample-latePayerPct"]')
      .fill(String(CUSTOM_LATE_PAYER_PCT));
    await loadButton.click();

    const removeButton = page.locator('[data-testid="button-remove-sample-data"]');
    await removeButton.waitFor({ state: "visible", timeout: LOAD_TIMEOUT_MS });
    pass("load completed and the card flipped to its loaded state");

    const badge = page.locator('[data-testid="badge-sample-data"]');
    await badge.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("sidebar shows the Sample data badge");

    // ---- 3. door count honors the custom total ----
    const stats = await readLoadAuditStats(page);
    if (!stats) {
      fail("could not find/parse the 'Loaded sample portfolio' audit entry");
    } else if (stats.units >= CUSTOM_TOTAL_DOORS && stats.units <= CUSTOM_TOTAL_DOORS + 5) {
      pass(
        `generated door count honors the custom total (requested ${CUSTOM_TOTAL_DOORS}, got ${stats.units} units across ${stats.properties} properties)`,
      );
    } else {
      fail(
        `generated door count ${stats.units} is not close to the requested ${CUSTOM_TOTAL_DOORS}`,
      );
    }

    // ---- 4. Properties list grew by exactly the sample property count ----
    const loadedProperties = await countPropertyCards(page);
    if (stats && loadedProperties === baselineProperties + stats.properties) {
      pass(
        `Properties list grew by the ${stats.properties} sample properties (now ${loadedProperties})`,
      );
    } else if (stats) {
      fail(
        `Properties list has ${loadedProperties} cards; expected ${baselineProperties} + ${stats.properties}`,
      );
    } else if (loadedProperties > baselineProperties) {
      pass(`Properties list grew after loading (now ${loadedProperties})`);
    } else {
      fail(`Properties list did not grow after loading (still ${loadedProperties})`);
    }

    // ---- 5. removal restores the pre-load state ----
    await sidebarButton(page, "Settings").click();
    await removeButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await removeButton.click();
    const confirmRemove = page.locator('[data-testid="button-confirm-remove-sample-data"]');
    await confirmRemove.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await confirmRemove.click();

    await loadButton.waitFor({ state: "visible", timeout: LOAD_TIMEOUT_MS });
    pass("removal completed and the card flipped back to its load state");

    await badge.waitFor({ state: "detached", timeout: TIMEOUT_MS });
    pass("sidebar Sample data badge is gone after removal");

    const finalProperties = await countPropertyCards(page);
    if (finalProperties === baselineProperties) {
      pass(`Properties list is back to the pre-load baseline (${finalProperties})`);
    } else {
      fail(
        `Properties list has ${finalProperties} cards after removal; expected the baseline ${baselineProperties}`,
      );
    }

    await sidebarButton(page, "Audit Log").click();
    const removalEntry = page.locator("text=/Removed all sample portfolio data/").first();
    await removalEntry
      .waitFor({ state: "visible", timeout: TIMEOUT_MS })
      .then(() => pass("audit log records the sample-data removal"))
      .catch(() => fail("audit log is missing the sample-data removal entry"));
  } finally {
    await context.close();
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} sample-data check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll sample-data lifecycle checks passed.");
}

main().catch((err) => {
  console.error("Sample-data check crashed:", err);
  process.exit(1);
});
