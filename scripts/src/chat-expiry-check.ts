/**
 * Chat access-expiry recovery check for both clients.
 *
 * Verifies, in a real browser, that when a chat member token is
 * force-expired in Postgres mid-session:
 *
 *   Desktop (rentnotice-pro at /app/):
 *     1. An activated workspace with a signed-in cloud admin shows live
 *        team chat on the Communications page.
 *     2. After the token is expired via SQL, the next poll flips the page
 *        to the "Sign in again to connect to team chat" guidance card
 *        (no raw request errors).
 *     3. Locking the workspace and signing back in mints a fresh token and
 *        restores chat.
 *
 *   Mobile (rentnotice-field Expo web, reached via its dev domain):
 *     4. Chat sign-in with license key + credentials works.
 *     5. After the token is expired via SQL, sending a message queues it,
 *        the 401 returns the user to the chat sign-in screen with the
 *        "expired" notice, and the queued outbox entry survives.
 *     6. Signing back in flushes the queued message — it reaches the
 *        server and renders in the conversation.
 *
 * All chat messages created by the check are deleted afterwards.
 *
 * Requires DATABASE_URL plus these workflows running:
 *   - artifacts/api-server: API Server   (proxy port 80, /api)
 *   - artifacts/rentnotice-pro: web      (proxy port 80, /app/)
 *   - artifacts/rentnotice-field: expo   (web via $REPLIT_EXPO_DEV_DOMAIN)
 */

import { execSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import pg from "pg";

const BASE_URL = process.env.CHAT_EXPIRY_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const APP_PATH = "/app/";
const EXPO_DOMAIN = process.env.REPLIT_EXPO_DEV_DOMAIN ?? "";
const LICENSE_KEY = process.env.CHAT_EXPIRY_CHECK_LICENSE_KEY ?? "RNP-KX88-NHUR-ZZYQ-CCPS";
const ADMIN_IDENTIFIER = process.env.CHAT_EXPIRY_CHECK_IDENTIFIER ?? "admin@admin.com";
const ADMIN_PASSWORD = process.env.CHAT_EXPIRY_CHECK_PASSWORD ?? "admin";
const TIMEOUT_MS = 30_000;
// Desktop channel polling runs every 10s; allow a couple of cycles.
const POLL_TIMEOUT_MS = 45_000;
const RUN_TAG = `chat-expiry-check-${Date.now()}`;
const EXPIRED_ISO = "2000-01-01T00:00:00.000Z";

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

// ------------------------------- database ---------------------------------

function dbClient(): pg.Client {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  return new pg.Client({ connectionString: databaseUrl });
}

async function withDb<T>(run: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = dbClient();
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

interface CompanyIds {
  companyId: string;
  memberKey: string;
}

async function lookupIds(): Promise<CompanyIds> {
  return withDb(async (c) => {
    const lic = await c.query<{ company_id: string }>(
      "SELECT company_id FROM license_keys WHERE key = $1",
      [LICENSE_KEY],
    );
    if (lic.rowCount === 0) throw new Error(`license key ${LICENSE_KEY} not found in dev DB`);
    const companyId = lic.rows[0].company_id;
    const user = await c.query<{ id: string }>(
      "SELECT id FROM cloud_users WHERE company_id = $1 AND (email = $2 OR username = $2)",
      [companyId, ADMIN_IDENTIFIER],
    );
    if (user.rowCount === 0) {
      throw new Error(`cloud user ${ADMIN_IDENTIFIER} not found for company ${companyId}`);
    }
    return { companyId, memberKey: user.rows[0].id };
  });
}

/** Force-expire every live token for the member; returns how many were hit. */
async function expireTokens(ids: CompanyIds): Promise<number> {
  return withDb(async (c) => {
    const res = await c.query(
      "UPDATE chat_member_tokens SET expires_at = $3 WHERE company_id = $1 AND member_key = $2 AND expires_at <> $3",
      [ids.companyId, ids.memberKey, EXPIRED_ISO],
    );
    return res.rowCount ?? 0;
  });
}

async function countLiveTokens(ids: CompanyIds): Promise<number> {
  return withDb(async (c) => {
    const res = await c.query(
      "SELECT COUNT(*)::int AS n FROM chat_member_tokens WHERE company_id = $1 AND member_key = $2 AND expires_at > $3",
      [ids.companyId, ids.memberKey, new Date().toISOString()],
    );
    return (res.rows[0] as { n: number }).n;
  });
}

async function messageDelivered(body: string): Promise<boolean> {
  return withDb(async (c) => {
    const res = await c.query("SELECT 1 FROM chat_messages WHERE body = $1", [body]);
    return (res.rowCount ?? 0) > 0;
  });
}

async function cleanup(ids: CompanyIds | null): Promise<void> {
  await withDb(async (c) => {
    await c.query("DELETE FROM chat_messages WHERE body LIKE $1", [`%${RUN_TAG}%`]);
    if (ids) {
      await c.query(
        "DELETE FROM chat_member_tokens WHERE company_id = $1 AND member_key = $2 AND expires_at = $3",
        [ids.companyId, ids.memberKey, EXPIRED_ISO],
      );
    }
  }).catch((err) => console.warn("cleanup failed:", err));
}

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  intervalMs = 1_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
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

async function openCommunications(page: Page): Promise<void> {
  await sidebarButton(page, "Communications").click();
  await page
    .locator('[data-testid="text-page-title"]', { hasText: "Communications" })
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

async function checkDesktop(browser: Browser, ids: CompanyIds): Promise<void> {
  console.log("\nDesktop (rentnotice-pro):");
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  try {
    await activateAndLogin(page);
    pass("workspace activated and cloud admin signed in");

    await openCommunications(page);
    const chatTab = page.locator('[data-testid="tab-team-chat"]');
    await chatTab.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await page
      .locator('[data-testid="list-channels"]')
      .waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("Communications page shows live team chat (member token accepted)");

    const hit = await expireTokens(ids);
    if (hit === 0) {
      fail("no live chat_member_tokens rows to expire for the desktop session");
      return;
    }
    pass(`force-expired ${hit} chat member token(s) via SQL mid-session`);

    const guidance = page.locator('[data-testid="text-comms-requires-activation"]');
    try {
      await guidance.waitFor({ state: "visible", timeout: POLL_TIMEOUT_MS });
    } catch {
      fail("guidance card never appeared after the token expired (waited through poll cycles)");
      return;
    }
    const guidanceText = (await guidance.textContent())?.trim() ?? "";
    if (guidanceText.includes("Sign in again to connect to team chat")) {
      pass('polling 401 cleared the cached token and shows the "sign in again" guidance card');
    } else {
      fail(`guidance card shows unexpected text: "${guidanceText}"`);
    }
    // The chat UI (raw errors included) must be gone.
    if (await chatTab.isVisible().catch(() => false)) {
      fail("team chat tabs are still rendered alongside the guidance card");
    } else {
      pass("chat UI is hidden while signed out of chat (no raw errors surfaced)");
    }

    // Sign out (lock) and back in: the desktop re-mints a token on every
    // online sign-in, which must restore chat.
    await page.locator('button[title="Lock Workspace"]').click();
    await signInDesktop(page);
    pass("locked the workspace and signed back in");

    await openCommunications(page);
    try {
      await chatTab.waitFor({ state: "visible", timeout: TIMEOUT_MS });
      await page
        .locator('[data-testid="list-channels"]')
        .waitFor({ state: "visible", timeout: TIMEOUT_MS });
      pass("chat reconnected after re-sign-in");
    } catch {
      fail("chat did not reconnect after signing back in");
      return;
    }
    if ((await countLiveTokens(ids)) > 0) {
      pass("a fresh (non-expired) member token was minted at re-sign-in");
    } else {
      fail("no fresh member token found in the database after re-sign-in");
    }
  } finally {
    await context.close();
  }
}

// --------------------------------- mobile ---------------------------------

async function signInMobileChat(page: Page): Promise<void> {
  const licenseInput = page.locator('[data-testid="input-license-key"]');
  await licenseInput.waitFor({ state: "visible", timeout: TIMEOUT_MS });
  await licenseInput.fill(LICENSE_KEY);
  await page.locator('[data-testid="input-chat-identifier"]').fill(ADMIN_IDENTIFIER);
  await page.locator('[data-testid="input-chat-password"]').fill(ADMIN_PASSWORD);
  await page.locator('[data-testid="button-connect-chat"]').click();
  await page
    .locator('[data-testid="button-switch-chat-user"]')
    .waitFor({ state: "visible", timeout: TIMEOUT_MS });
}

async function checkMobile(browser: Browser, ids: CompanyIds): Promise<void> {
  console.log("\nMobile (rentnotice-field, Expo web):");
  if (!EXPO_DOMAIN) {
    fail("REPLIT_EXPO_DEV_DOMAIN is not set — cannot reach the Expo web build");
    return;
  }
  const mobileUrl = `https://${EXPO_DOMAIN}/chat`;
  const context = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await context.newPage();
  try {
    await page.goto(mobileUrl, { waitUntil: "load", timeout: 60_000 });
    await signInMobileChat(page);
    pass("chat sign-in with license key + credentials succeeded");

    // Open the first conversation (the desktop stage guarantees #general).
    const conversation = page.locator('[data-testid^="conversation-"]').first();
    await conversation.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await conversation.click();
    const composer = page.locator('[data-testid="input-chat-message"]');
    await composer.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    pass("conversation opened with a message composer");

    // Draft first, then expire, then send immediately: the send's outbox
    // flush hits the 401 before the next 10s channel poll does.
    const messageBody = `E2E ${RUN_TAG}: sent after re-sign-in`;
    await composer.fill(messageBody);
    const hit = await expireTokens(ids);
    if (hit === 0) {
      fail("no live chat_member_tokens rows to expire for the mobile session");
      return;
    }
    pass(`force-expired ${hit} chat member token(s) via SQL mid-session`);
    await page.locator('[data-testid="button-send-message"]').click();

    const expiredNotice = page.locator('[data-testid="text-chat-signin-expired"]');
    try {
      await expiredNotice.waitFor({ state: "visible", timeout: POLL_TIMEOUT_MS });
      pass('401 returned the user to the chat sign-in screen with the "expired" notice');
    } catch {
      fail("expired-sign-in notice never appeared after the 401");
      return;
    }

    // The queued message must survive the sign-out (web AsyncStorage is
    // localStorage) and must not have reached the server yet.
    const outboxRaw = await page.evaluate(() =>
      window.localStorage.getItem("rnf.comms.outbox.v1"),
    );
    const outbox = outboxRaw ? (JSON.parse(outboxRaw) as unknown[]) : [];
    if (outbox.length === 1) {
      pass("queued unsent message survived in the outbox");
    } else {
      fail(`expected 1 queued outbox entry, found ${outbox.length}`);
    }
    if (await messageDelivered(messageBody)) {
      fail("message reached the server before re-sign-in (should have been queued)");
    }

    await signInMobileChat(page);
    pass("re-signed in to chat");

    // The outbox flushes after the first successful poll; the message must
    // reach the server and render in the conversation.
    const delivered = await waitFor(() => messageDelivered(messageBody), POLL_TIMEOUT_MS);
    if (delivered) {
      pass("queued message was delivered to the server after re-sign-in");
    } else {
      fail("queued message never reached the server after re-sign-in");
      return;
    }
    await conversation.waitFor({ state: "visible", timeout: TIMEOUT_MS });
    await conversation.click();
    const bubble = page.locator(`text=${messageBody}`).first();
    try {
      await bubble.waitFor({ state: "visible", timeout: TIMEOUT_MS });
      pass("delivered message renders in the conversation");
    } catch {
      fail("delivered message does not render in the conversation");
    }
  } finally {
    await context.close();
  }
}

// ---------------------------------- main -----------------------------------

async function main(): Promise<void> {
  try {
    const probe = await fetch(`${BASE_URL}${APP_PATH}`, { signal: AbortSignal.timeout(10_000) });
    if (!probe.ok) throw new Error(`HTTP ${probe.status}`);
  } catch (err) {
    console.error(
      `Cannot reach the desktop app at ${BASE_URL}${APP_PATH} (${err instanceof Error ? err.message : String(err)}). ` +
        "Make sure the rentnotice-pro web and API server workflows are running.",
    );
    process.exit(1);
  }

  let ids: CompanyIds | null = null;
  const executablePath = resolveChromiumPath();
  const browser = await chromium.launch({ executablePath });
  try {
    ids = await lookupIds();
    console.log(
      `Chat expiry recovery check (license ${LICENSE_KEY}, member ${ids.memberKey}, tag ${RUN_TAG})`,
    );
    await checkDesktop(browser, ids);
    await checkMobile(browser, ids);
  } finally {
    await browser.close();
    await cleanup(ids);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} chat expiry check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll chat expiry recovery checks passed.");
}

main().catch((err) => {
  console.error("Chat expiry check crashed:", err);
  process.exit(1);
});
