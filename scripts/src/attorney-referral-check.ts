/**
 * Attorney secure-link loop check for the RentNotice Pro desktop app
 * (artifacts/rentnotice-pro at /app/) + api-server public attorney routes.
 *
 * Verifies end-to-end, in a real browser:
 *   1. An activated workspace (dedicated e2e fixture license) loads sample
 *      data, which includes served notices.
 *   2. From a served notice, "Email Secure Link to Attorney" generates the
 *      packet and creates a referral; the secure link is captured from the
 *      create response.
 *   3. Acting as the attorney over plain HTTP: open the case page (viewed
 *      event), download the packet (downloaded event), post a reply, upload
 *      a PDF, and record a court date + case number.
 *   4. Back in the desktop app, the referral panel shows the full activity
 *      timeline — first opened, packet downloaded, reply, upload,
 *      court date — plus the court-date block, the reply body, and the
 *      upload auto-imported into Documents.
 *   5. The Deadline Calendar shows the court hearing on the chosen date.
 *
 * The app is an offline-first SPA (sql.js + IndexedDB per browser context)
 * with an in-memory session, so all navigation after login happens via SPA
 * clicks (page.goto would log us out).
 *
 * Requires DATABASE_URL plus these workflows running:
 *   - artifacts/api-server: API Server   (proxy port 80, /api)
 *   - artifacts/rentnotice-pro: web      (proxy port 80, /app/)
 *
 * Server-side referral rows created by the check are deleted afterwards.
 */

import { execSync } from "node:child_process";
import { chromium, type Page } from "playwright";
import pg from "pg";
import { ensureFixture } from "./e2e-fixture.js";

const BASE_URL = process.env.ATTORNEY_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const LICENSE_KEY = process.env.ATTORNEY_CHECK_LICENSE_KEY ?? "RNP-ATRF-CHCK-E2EE-FXTR";
const ADMIN_IDENTIFIER =
  process.env.ATTORNEY_CHECK_IDENTIFIER ?? "attorney-referral-check@example.com";
const ADMIN_PASSWORD = process.env.ATTORNEY_CHECK_PASSWORD ?? "attorney-check-pass-1";
const FIXTURE_COMPANY_NAME = "Attorney Referral Check Co";
const TIMEOUT_MS = 30_000;
// Sample-data load and packet PDF generation both run in-browser; allow slack.
const LOAD_TIMEOUT_MS = 120_000;
const SEND_TIMEOUT_MS = 90_000;

const RUN_TAG = `attorney-check-${Date.now()}`;
const ATTORNEY_NAME = "E2E Check, Esq.";
const ATTORNEY_EMAIL = "attorney-e2e@example.com";
const REPLY_BODY = `Reviewed the packet — filing this week. [${RUN_TAG}]`;
const UPLOAD_NAME = `filed-complaint-${RUN_TAG}.pdf`;
const CASE_NUMBER = `24-UD-${RUN_TAG.slice(-6)}`;
const TINY_PDF_BASE64 = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
).toString("base64");

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

/** Court date a few days out, as local YYYY-MM-DD. */
function pickCourtDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ------------------------------- database ---------------------------------

async function cleanupServerRows(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    // Events/replies/uploads cascade from the referral rows.
    await client.query(
      `DELETE FROM attorney_referrals
       WHERE company_id = (SELECT company_id FROM license_keys WHERE key = $1)`,
      [LICENSE_KEY],
    );
  } catch (err) {
    console.warn("cleanup failed:", err);
  } finally {
    await client.end().catch(() => undefined);
  }
}

// -------------------------------- desktop ---------------------------------

function sidebarButton(page: Page, label: string) {
  return page.locator("button", { hasText: label }).first();
}

async function signInDesktop(page: Page): Promise<void> {
  const identifier = page.locator('[data-testid="input-login-identifier"]');
  await identifier.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await identifier.fill(ADMIN_IDENTIFIER);
  await page.locator('[data-testid="input-login-secret"]').fill(ADMIN_PASSWORD);
  await page.locator('[data-testid="button-login"]').click();
  await sidebarButton(page, "Dashboard").waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

/** Fresh context: activate the workspace with the license key, sign in. */
async function activateAndLogin(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}${APP_PATH}`, { waitUntil: "load", timeout: TIMEOUT_MS });
  const choose = page.locator('[data-testid="button-choose-activate"]');
  await choose.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await choose.click();

  const keyInput = page.locator('[data-testid="input-license-key"]');
  await keyInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await keyInput.fill(LICENSE_KEY);
  await page.locator('[data-testid="button-validate-key"]').click();

  const activationId = page.locator('[data-testid="input-activation-identifier"]');
  await activationId.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await activationId.fill(ADMIN_IDENTIFIER);
  await page.locator('[data-testid="input-activation-secret"]').fill(ADMIN_PASSWORD);
  await page.locator('[data-testid="button-activate"]').click();

  // Activation either lands on the dashboard directly or on the lock screen.
  const dashboard = sidebarButton(page, "Dashboard");
  const login = page.locator('[data-testid="input-login-identifier"]');
  await dashboard.or(login).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });
  if (!(await dashboard.isVisible().catch(() => false))) {
    await signInDesktop(page);
  }
}

/** Load the sample portfolio (includes served notices) from Settings. */
async function loadSampleData(page: Page): Promise<void> {
  await sidebarButton(page, "Settings").click();
  const loadButton = page.locator('[data-testid="button-load-sample-data"]');
  await loadButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  if (!(await loadButton.isEnabled())) {
    const reason = await page
      .locator('[data-testid="text-sample-blocked-reason"]')
      .textContent()
      .catch(() => null);
    throw new Error(`sample-data load is blocked (${reason ?? "no reason shown"})`);
  }
  await loadButton.click();
  await page
    .locator('[data-testid="button-remove-sample-data"]')
    .waitFor({ state: "visible", timeout: LOAD_TIMEOUT_MS });
}

/** Open the first served notice from the Notices list; returns its local id. */
async function openServedNotice(page: Page): Promise<string> {
  await sidebarButton(page, "Notices").click();
  await page
    .locator("h1", { hasText: "Notices" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
  // The status badge is its own element with exactly the status text; the
  // row's concatenated text ("$1,825.00served") defeats word-boundary regexes.
  const servedLink = page
    .locator('a[href*="/notices/"]')
    .filter({ has: page.locator("div", { hasText: /^served$/i }) })
    .first();
  try {
    await servedLink.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  } catch (err) {
    // Diagnostics: what does the list actually show?
    const anchors = page.locator('a[href*="/notices/"]');
    const count = await anchors.count().catch(() => -1);
    const texts = (await anchors.allTextContents().catch(() => [])).slice(0, 8);
    const bodySnippet = (await page.locator("main, body").first().innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 400);
    console.error(
      `  debug url=${page.url()} noticeLinks=${count}\n` +
        `  debug linkTexts=${JSON.stringify(texts)}\n` +
        `  debug page="${bodySnippet}"`,
    );
    throw err;
  }
  await servedLink.click();
  await page
    .locator('[data-testid="card-attorney-referral"]')
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
  const m = page.url().match(/\/notices\/([^/?#]+)/);
  if (!m) throw new Error(`could not parse notice id from URL ${page.url()}`);
  return m[1];
}

/** Re-open a specific notice via SPA navigation (remount refetches referrals). */
async function reopenNotice(page: Page, noticeId: string): Promise<void> {
  await sidebarButton(page, "Dashboard").click();
  await sidebarButton(page, "Notices").click();
  const link = page.locator(`a[href*="/notices/${noticeId}"]`).first();
  await link.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await link.click();
  await page
    .locator('[data-testid="card-attorney-referral"]')
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

/** Send the secure link from the referral panel; returns the one-time link. */
async function sendSecureLink(page: Page): Promise<{ link: string; referralId: string }> {
  await page.locator('[data-testid="button-send-attorney-link"]').click();
  const nameInput = page.locator('[data-testid="input-attorney-name"]');
  await nameInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await nameInput.fill(ATTORNEY_NAME);
  await page.locator('[data-testid="input-attorney-email"]').fill(ATTORNEY_EMAIL);
  await page
    .locator('[data-testid="textarea-attorney-message"]')
    .fill(`Automated end-to-end check [${RUN_TAG}]`);

  const responsePromise = page.waitForResponse(
    (r) =>
      r.url().includes("/api/attorney-referrals") && r.request().method() === "POST",
    { timeout: SEND_TIMEOUT_MS },
  );
  await page.locator('[data-testid="button-create-referral"]').click();
  const response = await responsePromise;
  if (response.status() !== 201) {
    const body = await response.text().catch(() => "");
    throw new Error(`referral create returned HTTP ${response.status()}: ${body}`);
  }
  const created = (await response.json()) as { id: string; link: string };
  if (!created.link) throw new Error("referral create response had no link");
  // Dialog closes on success.
  await nameInput.waitFor({ state: "hidden", timeout: TIMEOUT_MS });
  return { link: created.link, referralId: created.id };
}

// ----------------------------- attorney (HTTP) -----------------------------

function apiFromLink(link: string): string {
  const token = new URL(link).pathname.split("/").filter(Boolean).pop();
  if (!token) throw new Error(`could not extract token from link ${link}`);
  return `${BASE_URL}/api/attorney/case/${token}`;
}

async function attorneyActs(caseApi: string, courtDate: string): Promise<void> {
  // 1. Open the case page (logs the "viewed" event).
  const caseRes = await fetch(caseApi);
  if (!caseRes.ok) throw new Error(`case fetch returned HTTP ${caseRes.status}`);
  pass("attorney opened the case (viewed event logged)");

  // 2. Download the packet (logs the "downloaded" event).
  const packetRes = await fetch(`${caseApi}/packet`);
  if (!packetRes.ok) throw new Error(`packet fetch returned HTTP ${packetRes.status}`);
  const bytes = await packetRes.arrayBuffer();
  if (bytes.byteLength < 100) throw new Error(`packet is only ${bytes.byteLength} bytes`);
  pass(`attorney downloaded the packet (${bytes.byteLength} bytes)`);

  // 3. Post a reply.
  const replyRes = await fetch(`${caseApi}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: REPLY_BODY }),
  });
  if (replyRes.status !== 201) throw new Error(`reply returned HTTP ${replyRes.status}`);
  pass("attorney posted a reply");

  // 4. Upload a PDF.
  const uploadRes = await fetch(`${caseApi}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: UPLOAD_NAME,
      mimeType: "application/pdf",
      dataBase64: TINY_PDF_BASE64,
      note: "Filed complaint (e2e check)",
    }),
  });
  if (uploadRes.status !== 201) throw new Error(`upload returned HTTP ${uploadRes.status}`);
  pass("attorney uploaded a document");

  // 5. Record the court date + case number.
  const courtRes = await fetch(`${caseApi}/court-date`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      courtDate,
      courtCaseNumber: CASE_NUMBER,
      courtNotes: "Dept 12, bring the original notice.",
    }),
  });
  if (!courtRes.ok) throw new Error(`court-date returned HTTP ${courtRes.status}`);
  pass(`attorney recorded court date ${courtDate} (case ${CASE_NUMBER})`);
}

// ----------------------------- panel assertions ----------------------------

async function verifyPanel(page: Page, courtDate: string): Promise<void> {
  const panel = page.locator('[data-testid="card-attorney-referral"]');

  const expectations: Array<[string, string]> = [
    ['[data-testid^="event-sent-"]', "timeline shows the link-sent event"],
    ['[data-testid^="event-viewed-"]', "timeline shows the first-opened event"],
    ['[data-testid^="event-downloaded-"]', "timeline shows the packet-downloaded event"],
    ['[data-testid^="event-reply-"]', "timeline shows the reply event"],
    ['[data-testid^="event-upload-"]', "timeline shows the upload event"],
    ['[data-testid^="event-court_date-"]', "timeline shows the court-date event"],
  ];
  for (const [selector, label] of expectations) {
    try {
      await panel.locator(selector).first().waitFor({ state: "visible", timeout: TIMEOUT_MS });
      pass(label);
    } catch {
      fail(`${label} — ${selector} not visible`);
    }
  }

  await panel
    .locator("text=First opened by the attorney")
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS })
    .then(() => pass('timeline labels the first open as "First opened by the attorney"'))
    .catch(() => fail("timeline is missing the first-opened wording"));

  await panel
    .locator(`text=${CASE_NUMBER}`)
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS })
    .then(() => pass("court-date block shows the case number"))
    .catch(() => fail("court-date block does not show the case number"));

  await panel
    .locator(`text=${RUN_TAG}`)
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS })
    .then(() => pass("reply body is visible in the panel"))
    .catch(() => fail("reply body is not visible in the panel"));

  // The upload auto-imports into the local Documents store.
  await panel
    .locator("text=in Documents")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .then(() => pass("attorney upload was auto-imported into Documents"))
    .catch(() => fail("attorney upload was not imported into Documents"));

  const dateVisible = await panel
    .locator(`text=Court date`)
    .first()
    .isVisible()
    .catch(() => false);
  if (dateVisible) pass(`court date ${courtDate} is displayed on the notice`);
  else fail("court date block is not displayed on the notice");
}

/**
 * Reopen the send dialog and confirm the attorney entered during the send was
 * saved as a reusable contact that prefills the form.
 */
async function verifySavedContact(page: Page): Promise<void> {
  await page.locator('[data-testid="button-send-attorney-link"]').click();
  const select = page.locator('[data-testid="select-saved-attorney"]');
  const visible = await select
    .waitFor({ state: "visible", timeout: TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  const closeDialog = async () => {
    await page.locator('[data-testid="button-cancel-referral"]').click();
    await page
      .locator('[data-testid="input-attorney-email"]')
      .waitFor({ state: "hidden", timeout: TIMEOUT_MS });
  };

  if (!visible) {
    fail("saved-attorney picker is not shown in the send dialog");
    await closeDialog();
    return;
  }
  pass("send dialog shows the saved-attorney picker");

  await select.click();
  const option = page
    .locator('[data-testid^="option-saved-attorney-"]')
    .filter({ hasText: ATTORNEY_EMAIL })
    .first();
  const optionVisible = await option
    .waitFor({ state: "visible", timeout: TIMEOUT_MS })
    .then(() => true)
    .catch(() => false);
  if (!optionVisible) {
    fail(`saved attorney ${ATTORNEY_EMAIL} is not listed in the picker`);
    await page.keyboard.press("Escape"); // close the select dropdown
    await closeDialog();
    return;
  }
  await option.click();

  const emailValue = await page
    .locator('[data-testid="input-attorney-email"]')
    .inputValue();
  const nameValue = await page
    .locator('[data-testid="input-attorney-name"]')
    .inputValue();
  if (emailValue === ATTORNEY_EMAIL && nameValue === ATTORNEY_NAME) {
    pass("choosing the saved attorney prefills name and email");
  } else {
    fail(
      `saved attorney prefill mismatch: name "${nameValue}", email "${emailValue}"`,
    );
  }

  await closeDialog();
}

async function verifyCalendar(page: Page, noticeId: string, courtDate: string): Promise<void> {
  await sidebarButton(page, "Calendar").click();
  await page
    .locator('[data-testid="button-next-month"]')
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });

  // The calendar opens on the current month; hop forward if the court date
  // landed in the next month.
  const now = new Date();
  const courtMonth = courtDate.slice(0, 7);
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (courtMonth !== currentMonth) {
    await page.locator('[data-testid="button-next-month"]').click();
  }

  await page
    .locator(`[data-testid="text-court-hearing-${noticeId}"]`)
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS })
    .then(() => pass("Deadline Calendar shows the court hearing"))
    .catch(() => fail(`Deadline Calendar is missing text-court-hearing-${noticeId}`));
}

// ---------------------------------- main -----------------------------------

async function main(): Promise<void> {
  try {
    const probe = await fetch(`${BASE_URL}${APP_PATH}`, { signal: AbortSignal.timeout(10_000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(
      `Cannot reach the app at ${BASE_URL}${APP_PATH} (${err instanceof Error ? err.message : String(err)}). ` +
        "Make sure the rentnotice-pro web and api-server workflows are running.",
    );
    process.exit(1);
  }

  if (!process.env.ATTORNEY_CHECK_LICENSE_KEY) {
    await ensureFixture({
      companyName: FIXTURE_COMPANY_NAME,
      email: ADMIN_IDENTIFIER,
      password: ADMIN_PASSWORD,
      userName: "Attorney Referral Check",
      username: "attorneycheck",
      licenseKey: LICENSE_KEY,
    });
  }

  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const courtDate = pickCourtDate();

  try {
    console.log(`Attorney secure-link loop check against ${BASE_URL}${APP_PATH}`);
    await activateAndLogin(page);
    pass("workspace activated and cloud admin signed in");

    await loadSampleData(page);
    pass("sample portfolio loaded (includes served notices)");

    const noticeId = await openServedNotice(page);
    pass(`opened a served notice (${noticeId}) with the referral panel visible`);

    const { link } = await sendSecureLink(page);
    pass("secure link created and captured from the create response");

    await attorneyActs(apiFromLink(link), courtDate);

    // Remount the notice page so the panel refetches referral activity and
    // runs the auto-import of attorney uploads/court date.
    await reopenNotice(page, noticeId);
    await verifyPanel(page, courtDate);
    await verifySavedContact(page);
    await verifyCalendar(page, noticeId, courtDate);
  } finally {
    await context.close();
    await browser.close();
    await cleanupServerRows();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} attorney secure-link check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll attorney secure-link loop checks passed.");
}

main().catch(async (err) => {
  console.error("Attorney secure-link check crashed:", err);
  await cleanupServerRows();
  process.exit(1);
});
