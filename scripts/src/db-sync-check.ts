/**
 * Multi-window database sync check for the RentNotice Pro desktop app
 * (artifacts/rentnotice-pro, served at /app/).
 *
 * The desktop shell can open multiple windows over the same sql.js +
 * IndexedDB store. Two browser tabs in one Playwright context share
 * IndexedDB and BroadcastChannel exactly the same way, so this verifies the
 * cross-window write coordination end-to-end:
 *
 *   1. Tab A and tab B both sign into the same demo workspace.
 *   2. Tab A creates a property. After the debounced save lands, tab B must
 *      see it WITHOUT any reload — its in-memory database only learns about
 *      the change through the BroadcastChannel adopt path.
 *   3. Round-trip: tab B then creates a second property, and tab A must see
 *      both. This guards the generation bookkeeping — if adoption failed to
 *      update the loaded generation (or re-persisted the adopted snapshot),
 *      the second write would either be dropped as stale or ping-pong.
 *
 * The session is in-memory, so all navigation after login happens via SPA
 * clicks (page.goto would log the tab out).
 *
 * Requires the rentnotice-pro web workflow to be running (reachable through
 * the local proxy on port 80).
 */

import { execSync } from "node:child_process";
import { chromium, type Page } from "playwright";

const BASE_URL = process.env.DB_SYNC_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const DEMO_IDENTIFIER = "arivera";
const DEMO_SECRET = "1234";
const TIMEOUT_MS = 30_000;
/** Debounce is 400ms; give the write + broadcast + adopt generous headroom. */
const SYNC_WAIT_MS = 15_000;

const RUN_TAG = Date.now().toString(36);
const PROPERTY_A = `Sync Check A ${RUN_TAG}`;
const PROPERTY_B = `Sync Check B ${RUN_TAG}`;

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

function sidebarButton(page: Page, label: string) {
  return page.locator("button", { hasText: label }).first();
}

/**
 * Sign into the demo workspace. The first tab in a fresh context sees the
 * first-run screen (demo button); later tabs land straight on the login
 * form because the workspace already exists in the shared IndexedDB.
 */
async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${APP_PATH}`, { waitUntil: "load", timeout: TIMEOUT_MS });

  const exploreDemo = page.locator('[data-testid="button-explore-demo"]');
  const identifier = page.locator('[data-testid="input-login-identifier"]');
  await exploreDemo.or(identifier).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });
  if (await exploreDemo.isVisible()) {
    await exploreDemo.click();
  }

  await identifier.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await identifier.fill(DEMO_IDENTIFIER);
  await page.locator('[data-testid="input-login-secret"]').fill(DEMO_SECRET);
  await page.locator('[data-testid="button-login"]').click();

  await sidebarButton(page, "Dashboard").waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

/** Create a property through the add-property dialog on the Properties page. */
async function createProperty(page: Page, nickname: string): Promise<void> {
  await sidebarButton(page, "Properties").click();

  const addButton = page.locator('[data-testid="button-add-property"]');
  const addEmpty = page.locator('[data-testid="button-add-property-empty"]');
  await addButton.or(addEmpty).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });
  if (await addButton.isVisible()) await addButton.click();
  else await addEmpty.click();

  await page.locator('[data-testid="input-property-nickname"]').waitFor({
    state: "visible",
    timeout: TIMEOUT_MS,
  });
  await page.locator('[data-testid="input-property-nickname"]').fill(nickname);
  await page.locator('[data-testid="input-property-address1"]').fill("123 Sync Test Ln");
  await page.locator('[data-testid="input-property-city"]').fill("Sacramento");
  await page.locator('[data-testid="input-property-state"]').fill("CA");
  await page.locator('[data-testid="input-property-zip"]').fill("95814");
  await page.locator('[data-testid="input-property-owner"]').fill("Sync Test Owner");

  const save = page.locator('[data-testid="button-save-property"]');
  await save.click();
  await page
    .locator('[data-testid="input-property-nickname"]')
    .waitFor({ state: "hidden", timeout: TIMEOUT_MS });
}

/**
 * Wait until a property with the given nickname is visible on the Properties
 * page of `page` WITHOUT reloading — only SPA navigation and the app's own
 * cross-window adoption may surface it.
 */
async function expectPropertyVisible(page: Page, nickname: string, where: string): Promise<boolean> {
  await sidebarButton(page, "Properties").click();
  const card = page.locator(`text=${nickname}`).first();
  try {
    await card.waitFor({ state: "visible", timeout: SYNC_WAIT_MS });
    pass(`${where}: "${nickname}" visible`);
    return true;
  } catch {
    fail(`${where}: "${nickname}" never appeared (cross-window adopt did not run?)`);
    return false;
  }
}

async function main(): Promise<void> {
  try {
    const probe = await fetch(`${BASE_URL}${APP_PATH}`, { signal: AbortSignal.timeout(10_000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(
      `Cannot reach ${BASE_URL}${APP_PATH} — is the rentnotice-pro web workflow running? (${String(err)})`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch({ executablePath: resolveChromiumPath() });
  const context = await browser.newContext();

  try {
    const tabA = await context.newPage();
    const tabB = await context.newPage();

    console.log("Signing in on tab A (creates the demo workspace)...");
    await tabA.bringToFront();
    await login(tabA);
    pass("tab A signed in");

    console.log("Signing in on tab B (same IndexedDB, separate session)...");
    await tabB.bringToFront();
    await login(tabB);
    pass("tab B signed in");

    console.log("Tab A: creating property...");
    await tabA.bringToFront();
    await createProperty(tabA, PROPERTY_A);
    pass(`tab A created "${PROPERTY_A}"`);

    console.log("Tab B: waiting for the property to arrive via broadcast...");
    await tabB.bringToFront();
    await expectPropertyVisible(tabB, PROPERTY_A, "tab B");

    console.log("Tab B: creating a second property (round-trip)...");
    await createProperty(tabB, PROPERTY_B);
    pass(`tab B created "${PROPERTY_B}"`);

    console.log("Tab A: waiting for the round-trip property...");
    await tabA.bringToFront();
    await expectPropertyVisible(tabA, PROPERTY_B, "tab A");
    // Tab A must ALSO still have its own property — if tab B's write had
    // clobbered rather than built on tab A's state, it would be gone.
    const ownStillThere = await tabA
      .locator(`text=${PROPERTY_A}`)
      .first()
      .isVisible()
      .catch(() => false);
    if (ownStillThere) pass(`tab A still shows "${PROPERTY_A}" (no clobber)`);
    else fail(`tab A lost "${PROPERTY_A}" — tab B's save clobbered tab A's write`);
  } finally {
    await context.close();
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nAll multi-window db sync checks passed");
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
