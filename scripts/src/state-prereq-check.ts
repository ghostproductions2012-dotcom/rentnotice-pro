/**
 * State pre-filing prerequisite gating check for the RentNotice Pro desktop
 * app (artifacts/rentnotice-pro, served at /app/).
 *
 * Verifies end-to-end, in a real browser, that:
 *   1. MD: a 3-day pay-or-quit notice for a Maryland property shows the
 *      "notice of intent" prerequisite blocker in Compliance Validation,
 *      checking the workroom prerequisite checkbox clears the blocker, and
 *      the notice can then be walked to a finalize dialog with no blocking
 *      issues (confirm button enabled after acknowledgements).
 *   2. HI (on/after 2026-02-05): the mediation prerequisite blocker appears
 *      and clears the same way (browser clock fixed after the effective
 *      date).
 *   3. HI (before 2026-02-05): with the browser clock fixed before the
 *      effective date, the mediation blocker does NOT appear at all.
 *
 * The app is an offline-first SPA (sql.js + IndexedDB per browser context),
 * so each scenario boots a fresh context to the first-run screen, enters the
 * seeded demo workspace, and signs in as the demo admin. The session is
 * in-memory, so all navigation after login happens via SPA clicks.
 *
 * Requires the rentnotice-pro web workflow to be running (reachable through
 * the local proxy on port 80).
 */

import { execSync } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

const BASE_URL = process.env.STATE_PREREQ_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const DEMO_IDENTIFIER = "arivera";
const DEMO_SECRET = "1234";
const TIMEOUT_MS = 30_000;

const PREREQ_BLOCKER_TEXT = "pre-filing prerequisite not completed";
const FINALIZE_BLOCKER_TEXT = "blocking issue(s) must be resolved";

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

/** Fill a testid'd input. */
async function fillInput(page: Page, testId: string, value: string): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).fill(value);
}

/** Open a Radix select by trigger testid and pick the option containing `optionText`. */
async function pickSelect(page: Page, triggerTestId: string, optionText: string): Promise<void> {
  await page.locator(`[data-testid="${triggerTestId}"]`).click();
  const option = page.locator('[role="option"]', { hasText: optionText }).first();
  await option.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await option.click();
}

interface Scenario {
  label: string;
  state: string;
  city: string;
  zip: string;
  propertyNickname: string;
  owner: string;
  tenantName: string;
  statementDate: string; // YYYY-MM-DD, must be in the past relative to the (possibly faked) clock
  monthKey: string; // YYYY-MM of the statement
  prereqTestId: string; // checkbox-prereq-<key>
}

/**
 * Create a property, tenant, manual rent statement, and 3-day pay-or-quit
 * notice, ending on the notice workroom page.
 */
async function createNotice(page: Page, s: Scenario): Promise<void> {
  // ---- property ----
  await sidebarButton(page, "Properties").click();
  const addProperty = page.locator('[data-testid="button-add-property"]');
  await addProperty.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await addProperty.click();
  await page.locator('[data-testid="input-property-nickname"]').waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await fillInput(page, "input-property-nickname", s.propertyNickname);
  await fillInput(page, "input-property-address1", "100 Test St");
  await fillInput(page, "input-property-city", s.city);
  await fillInput(page, "input-property-state", s.state);
  await fillInput(page, "input-property-zip", s.zip);
  await fillInput(page, "input-property-owner", s.owner);
  await fillInput(page, "input-payment-payto", s.owner);
  await fillInput(page, "input-payment-address", `PO Box 1, ${s.city}, ${s.state} ${s.zip}`);
  // Accepted payment methods are required — otherwise finalization is blocked
  // by the unrelated "Accepted payment methods are missing" blocker.
  await page.locator('[data-testid="checkbox-method-personal_check"]').click();
  await page.locator('[data-testid="checkbox-method-money_order"]').click();
  await page.locator('[data-testid="button-save-property"]').click();
  await page.locator('[data-testid="input-property-nickname"]').waitFor({ state: "hidden", timeout: TIMEOUT_MS });

  // ---- tenant ----
  await sidebarButton(page, "Tenants").click();
  const addTenant = page.locator('[data-testid="button-add-tenant"]');
  await addTenant.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await addTenant.click();
  await page.locator('[data-testid="input-tenant-names"]').waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await fillInput(page, "input-tenant-names", s.tenantName);
  await pickSelect(page, "select-tenant-property", s.propertyNickname);
  await fillInput(page, "input-tenant-unit", "1A");
  await fillInput(page, "input-tenant-rent", "1500");
  await page.locator('[data-testid="button-save-tenant"]').click();
  await page.locator('[data-testid="input-tenant-names"]').waitFor({ state: "hidden", timeout: TIMEOUT_MS });

  // ---- manual statement (rent charge) ----
  await page.locator("a", { hasText: s.tenantName }).first().click();
  const enterStatement = page.locator('[data-testid="button-enter-statement"]');
  await enterStatement.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await enterStatement.click();
  await page.locator('[data-testid="input-manual-date-0"]').waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await fillInput(page, "input-manual-date-0", s.statementDate);
  // Row type defaults to "rent" (rent charge) — leave as-is.
  await fillInput(page, "input-manual-amount-0", "1500");
  await page.locator('[data-testid="button-manual-save"]').click();
  await page.locator('[data-testid="input-manual-date-0"]').waitFor({ state: "hidden", timeout: TIMEOUT_MS });

  // ---- notice wizard ----
  await sidebarButton(page, "Notices").click();
  const newNotice = page.locator('a[href*="/notices/new"]').first();
  await newNotice.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await newNotice.click();

  await page.locator('[data-testid="select-tenant"]').waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await pickSelect(page, "select-tenant", s.tenantName);
  await pickSelect(page, "select-ledger", "manual entry");
  await page.locator('[data-testid="button-step1-next"]').click();

  const monthCheckbox = page.locator(`[data-testid="checkbox-month-${s.monthKey}"]`);
  await monthCheckbox.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  if ((await monthCheckbox.getAttribute("data-state")) !== "checked") await monthCheckbox.click();
  await page.locator('[data-testid="button-step2-next"]').click();

  const create = page.locator('[data-testid="button-create-notice"]');
  await create.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await create.click();

  // Workroom page: the compliance validation card renders once the notice loads.
  await page
    .locator("text=Compliance Validation")
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

function complianceCard(page: Page) {
  return page.locator("div.rounded-lg, div.rounded-xl, [class*='card']", {
    has: page.locator("text=Compliance Validation"),
  });
}

async function prereqBlockerVisible(page: Page): Promise<boolean> {
  return (await page.locator(`text=${PREREQ_BLOCKER_TEXT}`).count()) > 0;
}

/** MD + HI-after: blocker appears, checkbox clears it. Returns true on success. */
async function checkBlockerClears(page: Page, s: Scenario, stateName: string): Promise<boolean> {
  const requirements = page.locator('[data-testid="card-state-requirements"]');
  if ((await requirements.count()) === 0) {
    fail(`${s.label}: card-state-requirements not shown on the workroom page`);
    return false;
  }
  pass(`${s.label}: ${stateName} State Requirements card is shown`);

  const checkbox = page.locator(`[data-testid="${s.prereqTestId}"]`);
  if ((await checkbox.getAttribute("data-state")) === "checked") {
    fail(`${s.label}: prerequisite checkbox is unexpectedly pre-checked`);
    return false;
  }

  if (!(await prereqBlockerVisible(page))) {
    fail(`${s.label}: expected "${PREREQ_BLOCKER_TEXT}" blocker with checkbox unchecked, none shown`);
    return false;
  }
  pass(`${s.label}: prerequisite blocker is shown while the box is unchecked`);

  await checkbox.click();
  await page
    .locator(`text=${PREREQ_BLOCKER_TEXT}`)
    .first()
    .waitFor({ state: "detached", timeout: TIMEOUT_MS })
    .catch(() => undefined);

  if ((await checkbox.getAttribute("data-state")) !== "checked") {
    fail(`${s.label}: prerequisite checkbox did not become checked after clicking`);
    return false;
  }
  if (await prereqBlockerVisible(page)) {
    fail(`${s.label}: prerequisite blocker still shown after checking the box`);
    return false;
  }
  pass(`${s.label}: checking the prerequisite box clears the blocker`);
  return true;
}

/** Walk the MD notice to the finalize dialog and confirm nothing blocks it. */
async function checkFinalizeAvailable(page: Page, label: string): Promise<void> {
  await page.locator('[data-testid="button-submit-review"]').click();
  const approve = page.locator('[data-testid="button-approve"]');
  await approve.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await approve.click();
  const finalize = page.locator('[data-testid="button-finalize"]');
  await finalize.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await finalize.click();

  const confirm = page.locator('[data-testid="button-confirm-finalize"]');
  await confirm.waitFor({ state: "visible", timeout: TIMEOUT_MS });

  if ((await page.locator(`text=${FINALIZE_BLOCKER_TEXT}`).count()) > 0) {
    fail(`${label}: finalize dialog still reports blocking issues after prerequisite was checked`);
    return;
  }
  pass(`${label}: finalize dialog shows no blocking issues`);

  // Acknowledge any warnings and attest so the confirm button can enable.
  const acks = page.locator('[data-testid^="input-ack-"]');
  const ackCount = await acks.count();
  for (let i = 0; i < ackCount; i++) {
    await acks.nth(i).fill("Automated state-prerequisite check acknowledgement");
  }
  const attest = page.locator('[data-testid="checkbox-attestation"]');
  if ((await attest.count()) > 0 && (await attest.getAttribute("data-state")) !== "checked") {
    await attest.click();
  }

  if (await confirm.isEnabled()) {
    pass(`${label}: Finalize & Generate Packet button is enabled — finalization is allowed`);
  } else {
    fail(`${label}: Finalize confirm button is still disabled after acknowledgements`);
  }
}

async function newScenarioPage(
  browser: Browser,
  fixedTime?: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  if (fixedTime) await page.clock.install({ time: new Date(fixedTime) });
  return { context, page };
}

async function runMaryland(browser: Browser): Promise<void> {
  console.log("\nMaryland (notice_of_intent prerequisite):");
  const s: Scenario = {
    label: "MD",
    state: "MD",
    city: "Annapolis",
    zip: "21401",
    propertyNickname: "MD Prereq Check",
    owner: "Chesapeake Holdings LLC",
    tenantName: "Jordan Testcase",
    statementDate: "2026-06-01",
    monthKey: "2026-06",
    prereqTestId: "checkbox-prereq-notice_of_intent",
  };
  const { context, page } = await newScenarioPage(browser);
  try {
    await enterDemoAndLogin(page);
    await createNotice(page, s);
    if (await checkBlockerClears(page, s, "Maryland")) {
      await checkFinalizeAvailable(page, s.label);
    }
  } finally {
    await context.close();
  }
}

async function runHawaiiAfterEffectiveDate(browser: Browser): Promise<void> {
  console.log("\nHawaii, filing on/after 2026-02-05 (mediation prerequisite applies):");
  const s: Scenario = {
    label: "HI-after",
    state: "HI",
    city: "Honolulu",
    zip: "96813",
    propertyNickname: "HI Prereq Check",
    owner: "Pacific Rentals LLC",
    tenantName: "Kai Testcase",
    statementDate: "2026-06-01",
    monthKey: "2026-06",
    prereqTestId: "checkbox-prereq-mediation_if_requested",
  };
  // Pin the clock after the effective date so the check stays deterministic.
  const { context, page } = await newScenarioPage(browser, "2026-07-15T10:00:00");
  try {
    await enterDemoAndLogin(page);
    await createNotice(page, s);
    await checkBlockerClears(page, s, "Hawaii");
  } finally {
    await context.close();
  }
}

async function runHawaiiBeforeEffectiveDate(browser: Browser): Promise<void> {
  console.log("\nHawaii, filing before 2026-02-05 (mediation gate must NOT apply):");
  const s: Scenario = {
    label: "HI-before",
    state: "HI",
    city: "Hilo",
    zip: "96720",
    propertyNickname: "HI Early Check",
    owner: "Big Island Rentals LLC",
    tenantName: "Noa Testcase",
    statementDate: "2025-12-01",
    monthKey: "2025-12",
    prereqTestId: "checkbox-prereq-mediation_if_requested",
  };
  const { context, page } = await newScenarioPage(browser, "2026-01-15T10:00:00");
  try {
    await enterDemoAndLogin(page);
    await createNotice(page, s);
    if (await prereqBlockerVisible(page)) {
      fail("HI-before: mediation prerequisite blocker shown for a filing before 2026-02-05");
    } else {
      pass("HI-before: no mediation prerequisite blocker before the effective date");
    }
  } finally {
    await context.close();
  }
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

  try {
    console.log(`State prerequisite gating check against ${BASE_URL}${APP_PATH}`);
    await runMaryland(browser);
    await runHawaiiAfterEffectiveDate(browser);
    await runHawaiiBeforeEffectiveDate(browser);
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} state prerequisite check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll state prerequisite checks passed.");
}

main().catch((err) => {
  console.error("State prerequisite check crashed:", err);
  process.exit(1);
});
