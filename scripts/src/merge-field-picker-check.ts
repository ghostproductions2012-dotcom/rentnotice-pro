/**
 * Merge-field picker cursor-insertion regression check for the RentNotice Pro
 * desktop app (artifacts/rentnotice-pro, served at /app/).
 *
 * Verifies that clicking a field in the "Insert merge field" picker inserts
 * the {{token}} at the textarea's current cursor position (not appended at
 * the end), and that the cursor is restored right after the token, in both:
 *   1. the New Template dialog (templates list page), and
 *   2. the Edit Template Body dialog (template detail page).
 *
 * The app is an offline-first SPA (sql.js + IndexedDB per browser context),
 * so a fresh context boots to the first-run screen; the check enters the
 * seeded demo workspace and signs in as the demo admin. The session is
 * in-memory, so all navigation after login happens via SPA sidebar clicks.
 *
 * Requires the rentnotice-pro web workflow to be running (reachable through
 * the local proxy on port 80).
 */

import { execSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = process.env.MERGE_FIELD_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const DEMO_IDENTIFIER = "arivera";
const DEMO_SECRET = "1234";
const TIMEOUT_MS = 30_000;

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

  // Fresh context boots to the first-run screen.
  const exploreDemo = page.locator('[data-testid="button-explore-demo"]');
  await exploreDemo.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await exploreDemo.click();

  // After seeding, the login screen appears.
  const identifier = page.locator('[data-testid="input-login-identifier"]');
  await identifier.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await identifier.fill(DEMO_IDENTIFIER);
  await page.locator('[data-testid="input-login-secret"]').fill(DEMO_SECRET);
  await page.locator('[data-testid="button-login"]').click();

  // Sidebar appears once signed in.
  await page
    .locator("button", { hasText: "Templates" })
    .first()
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

interface TextareaState {
  value: string;
  selectionStart: number;
}

async function readTextarea(page: Page, testId: string): Promise<TextareaState> {
  return page.locator(`[data-testid="${testId}"]`).evaluate((el) => {
    const ta = el as HTMLTextAreaElement;
    return { value: ta.value, selectionStart: ta.selectionStart };
  });
}

async function setCursor(page: Page, testId: string, position: number): Promise<void> {
  await page.locator(`[data-testid="${testId}"]`).evaluate((el, pos) => {
    const ta = el as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(pos, pos);
  }, position);
}

/**
 * With the target dialog open and the textarea prepared, expand the picker
 * inside that dialog and insert `field`, then verify placement at `cursorPos`.
 */
async function insertAndVerify(
  page: Page,
  label: string,
  textareaTestId: string,
  field: string,
  cursorPos: number,
): Promise<void> {
  const before = await readTextarea(page, textareaTestId);
  await setCursor(page, textareaTestId, cursorPos);

  // Scope picker interactions to the open dialog (both dialogs use the same testids).
  const dialog = page.locator('[role="dialog"]', {
    has: page.locator(`[data-testid="${textareaTestId}"]`),
  });
  await dialog.locator('[data-testid="button-toggle-merge-fields"]').click();
  const fieldButton = dialog.locator(`[data-testid="button-insert-field-${field}"]`);
  await fieldButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await fieldButton.click();

  // Cursor restore happens in a requestAnimationFrame — give it a beat.
  await page.waitForTimeout(200);

  const token = `{{${field}}}`;
  const expected = before.value.slice(0, cursorPos) + token + before.value.slice(cursorPos);
  const after = await readTextarea(page, textareaTestId);

  if (after.value === expected) {
    pass(`${label}: "${token}" inserted at position ${cursorPos} (not appended)`);
  } else {
    fail(
      `${label}: expected value ${JSON.stringify(expected)} but got ${JSON.stringify(after.value)}`,
    );
    return;
  }

  const expectedCursor = cursorPos + token.length;
  if (after.selectionStart === expectedCursor) {
    pass(`${label}: cursor restored right after the token (position ${expectedCursor})`);
  } else {
    fail(
      `${label}: expected cursor at ${expectedCursor} after insert, but selectionStart is ${after.selectionStart}`,
    );
  }
}

async function checkNewTemplateDialog(page: Page): Promise<void> {
  await page.locator("button", { hasText: "Templates" }).first().click();
  await page
    .locator('[data-testid="button-new-template"]')
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await page.locator('[data-testid="button-new-template"]').click();

  const body = page.locator('[data-testid="input-template-body"]');
  await body.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await body.fill("HELLO WORLD");

  // Cursor between "HELLO " and "WORLD".
  await insertAndVerify(page, "New Template dialog", "input-template-body", "tenant_names", 6);

  // Close without creating the template.
  await page.keyboard.press("Escape");
  await body.waitFor({ state: "hidden", timeout: TIMEOUT_MS });
}

async function checkEditBodyDialog(page: Page): Promise<void> {
  // Open the first template's detail page via SPA click.
  const firstTemplate = page.locator('[data-testid^="card-template-"], [data-testid^="row-template-"]').first();
  if ((await firstTemplate.count()) > 0) {
    await firstTemplate.click();
  } else {
    // Fallback: any link/row leading to a template detail page.
    await page.locator('a[href*="/templates/"]').first().click();
  }

  const editButton = page.locator('[data-testid="button-edit-template"]');
  await editButton.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await editButton.click();

  const body = page.locator('[data-testid="input-edit-body"]');
  await body.waitFor({ state: "visible", timeout: TIMEOUT_MS });

  // The textarea is pre-filled with the existing body; insert at index 4.
  await insertAndVerify(page, "Edit Body dialog", "input-edit-body", "property_address", 4);

  // Close without saving.
  await page.keyboard.press("Escape");
  await body.waitFor({ state: "hidden", timeout: TIMEOUT_MS });
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
  const browser: Browser = await chromium.launch({ executablePath });

  try {
    console.log(`Merge-field picker insertion check against ${BASE_URL}${APP_PATH}`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();

    await enterDemoAndLogin(page);
    console.log("\nNew Template dialog:");
    await checkNewTemplateDialog(page);
    console.log("\nEdit Body dialog:");
    await checkEditBodyDialog(page);

    await context.close();
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} merge-field picker check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll merge-field picker checks passed.");
}

main().catch((err) => {
  console.error("Merge-field picker check crashed:", err);
  process.exit(1);
});
