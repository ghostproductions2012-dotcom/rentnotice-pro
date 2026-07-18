/**
 * Mobile layout regression check for the marketing website (artifacts/www).
 *
 * Renders key pages at a ~375px phone viewport and fails if:
 *   - the page overflows horizontally (document.documentElement.scrollWidth
 *     exceeds window.innerWidth), or
 *   - the expected mobile hamburger button is missing
 *     (data-testid "button-mobile-menu" on marketing pages,
 *      "button-portal-mobile-menu" on portal pages), or
 *   - the hamburger menu doesn't actually work: clicking it must open the
 *     drawer with its nav links visible, clicking a link must navigate to the
 *     expected page, and the drawer must close after navigation.
 *
 * Portal pages authenticate with a self-provisioned fixture account via
 * the real login API. Admin pages authenticate by inserting a plaintext token
 * into the admin_sessions table and setting the rnp_admin_session cookie.
 *
 * Requires the www dev server and API server workflows to be running
 * (reachable through the local proxy on port 80) and DATABASE_URL to be set.
 */

import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import pg from "pg";
import { ensureFixture } from "./e2e-fixture.js";

const BASE_URL = process.env.MOBILE_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const VIEWPORT = { width: 375, height: 812 };
// Dedicated self-provisioned e2e fixture — the old seeded admin@admin.com
// account was retired.
const PORTAL_EMAIL = process.env.MOBILE_CHECK_PORTAL_EMAIL ?? "mobile-layout-check@example.com";
const PORTAL_PASSWORD = process.env.MOBILE_CHECK_PORTAL_PASSWORD ?? "mobile-layout-check-pass-1";
const NAV_TIMEOUT_MS = 30_000;

interface PageCheck {
  name: string;
  path: string;
  /** data-testid of the hamburger button that must be present, if any. */
  hamburgerTestId?: string;
  /** CSS selector that must appear before we measure, proving the page rendered. */
  readySelector: string;
}

const MARKETING_PAGES: PageCheck[] = [
  { name: "Home", path: "/", hamburgerTestId: "button-mobile-menu", readySelector: '[data-testid="button-mobile-menu"]' },
  { name: "Pricing", path: "/pricing", hamburgerTestId: "button-mobile-menu", readySelector: '[data-testid="button-mobile-menu"]' },
  { name: "Download", path: "/download", hamburgerTestId: "button-mobile-menu", readySelector: '[data-testid="button-mobile-menu"]' },
  { name: "Login", path: "/login", hamburgerTestId: "button-mobile-menu", readySelector: '[data-testid="button-mobile-menu"]' },
  { name: "Signup", path: "/signup", hamburgerTestId: "button-mobile-menu", readySelector: '[data-testid="button-mobile-menu"]' },
];

const PORTAL_PAGES: PageCheck[] = [
  { name: "Portal Overview", path: "/portal", hamburgerTestId: "button-portal-mobile-menu", readySelector: '[data-testid="button-portal-mobile-menu"]' },
  { name: "Portal Team", path: "/portal/users", hamburgerTestId: "button-portal-mobile-menu", readySelector: '[data-testid="button-portal-mobile-menu"]' },
];

const ADMIN_PAGES: PageCheck[] = [
  { name: "Admin Dashboard", path: "/admin", readySelector: '[data-testid^="card-metric-"]' },
];

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

async function checkPage(page: Page, check: PageCheck): Promise<void> {
  const url = `${BASE_URL}${check.path}`;
  await page.goto(url, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });
  try {
    await page.waitForSelector(check.readySelector, { timeout: NAV_TIMEOUT_MS, state: "attached" });
  } catch {
    fail(`${check.name} (${check.path}): expected element "${check.readySelector}" never appeared — page did not render as expected (redirected or broken?). Final URL: ${page.url()}`);
    return;
  }
  // Give layout a moment to settle (fonts, images, async data).
  await page.waitForLoadState("networkidle", { timeout: NAV_TIMEOUT_MS }).catch(() => {});
  await page.waitForTimeout(250);

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));

  if (scrollWidth > innerWidth) {
    fail(`${check.name} (${check.path}): horizontal overflow at ${VIEWPORT.width}px — scrollWidth ${scrollWidth} > innerWidth ${innerWidth}`);
  } else {
    pass(`${check.name} (${check.path}): no horizontal overflow (scrollWidth ${scrollWidth} <= innerWidth ${innerWidth})`);
  }

  if (check.hamburgerTestId) {
    const visible = await page
      .locator(`[data-testid="${check.hamburgerTestId}"]`)
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) {
      fail(`${check.name} (${check.path}): hamburger button [data-testid="${check.hamburgerTestId}"] is missing or not visible at ${VIEWPORT.width}px`);
    } else {
      pass(`${check.name} (${check.path}): hamburger [data-testid="${check.hamburgerTestId}"] visible`);
    }
  }
}

interface MenuCheck {
  name: string;
  /** Page to load before clicking the hamburger. */
  startPath: string;
  /** data-testid of the hamburger button to click. */
  hamburgerTestId: string;
  /** Selectors (scoped to the open drawer) that must be visible once open. */
  expectedLinkSelectors: string[];
  /** Selector (scoped to the open drawer) of the link to click. */
  clickLinkSelector: string;
  /** Path the SPA must navigate to after clicking the link. */
  expectedPath: string;
}

const MARKETING_MENU: MenuCheck = {
  name: "Marketing mobile menu",
  startPath: "/",
  hamburgerTestId: "button-mobile-menu",
  expectedLinkSelectors: [
    '[data-testid="link-mobile-features"]',
    '[data-testid="link-mobile-pricing"]',
    '[data-testid="link-mobile-download"]',
    '[data-testid="link-mobile-log-in"]',
    '[data-testid="link-mobile-get-started"]',
  ],
  clickLinkSelector: '[data-testid="link-mobile-pricing"]',
  expectedPath: "/pricing",
};

const PORTAL_MENU: MenuCheck = {
  name: "Portal mobile menu",
  startPath: "/portal",
  hamburgerTestId: "button-portal-mobile-menu",
  expectedLinkSelectors: ['a[href="/portal"]', 'a[href="/portal/users"]', 'a[href="/download"]'],
  clickLinkSelector: 'a[href="/portal/users"]',
  expectedPath: "/portal/users",
};

async function checkMobileMenu(page: Page, check: MenuCheck): Promise<void> {
  const label = `${check.name} (${check.startPath})`;
  await page.goto(`${BASE_URL}${check.startPath}`, { waitUntil: "load", timeout: NAV_TIMEOUT_MS });

  const hamburger = page.locator(`[data-testid="${check.hamburgerTestId}"]`).first();
  try {
    await hamburger.waitFor({ state: "visible", timeout: NAV_TIMEOUT_MS });
  } catch {
    fail(`${label}: hamburger [data-testid="${check.hamburgerTestId}"] never became visible — cannot test the menu. Final URL: ${page.url()}`);
    return;
  }

  await hamburger.click();

  const drawer = page.locator('[role="dialog"]');
  try {
    await drawer.waitFor({ state: "visible", timeout: 5_000 });
  } catch {
    fail(`${label}: clicking the hamburger did not open the drawer (no visible [role="dialog"] within 5s)`);
    return;
  }
  pass(`${label}: drawer opens on hamburger click`);

  let linksOk = true;
  for (const selector of check.expectedLinkSelectors) {
    const visible = await drawer
      .locator(selector)
      .first()
      .isVisible()
      .catch(() => false);
    if (!visible) {
      fail(`${label}: expected nav link ${selector} is not visible in the open drawer`);
      linksOk = false;
    }
  }
  if (linksOk) {
    pass(`${label}: all ${check.expectedLinkSelectors.length} expected nav links visible in the drawer`);
  }

  const target = drawer.locator(check.clickLinkSelector).first();
  if (!(await target.isVisible().catch(() => false))) {
    fail(`${label}: cannot click ${check.clickLinkSelector} — not visible; skipping navigation check`);
    return;
  }
  await target.click();

  try {
    await page.waitForURL((url) => url.pathname === check.expectedPath, { timeout: 10_000 });
    pass(`${label}: clicking ${check.clickLinkSelector} navigated to ${check.expectedPath}`);
  } catch {
    fail(`${label}: clicking ${check.clickLinkSelector} did not navigate to ${check.expectedPath} within 10s (still at ${page.url()})`);
    return;
  }

  try {
    await drawer.waitFor({ state: "hidden", timeout: 5_000 });
    pass(`${label}: drawer closed after navigation`);
  } catch {
    fail(`${label}: drawer is still open 5s after navigating to ${check.expectedPath}`);
  }
}

async function loginPortal(context: BrowserContext): Promise<boolean> {
  if (!process.env.MOBILE_CHECK_PORTAL_EMAIL) {
    await ensureFixture({
      companyName: "Mobile Layout Check Co",
      email: PORTAL_EMAIL,
      password: PORTAL_PASSWORD,
      userName: "Mobile Layout Check",
      username: "mobilecheck",
    });
  }
  const res = await context.request.post(`${BASE_URL}/api/www/auth/login`, {
    data: { email: PORTAL_EMAIL, password: PORTAL_PASSWORD },
  });
  if (!res.ok()) {
    fail(`Portal login as ${PORTAL_EMAIL} failed with HTTP ${res.status()}: ${(await res.text()).slice(0, 200)}`);
    return false;
  }
  const cookies = await context.cookies(BASE_URL);
  if (!cookies.some((c) => c.name === "rnp_session")) {
    fail("Portal login succeeded but no rnp_session cookie was set on the browser context");
    return false;
  }
  return true;
}

async function createAdminSession(): Promise<string> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set — cannot create an admin session for the admin page check");
  }
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(
      "INSERT INTO admin_sessions (token, expires_at) VALUES ($1, $2)",
      [token, expiresAt],
    );
  } finally {
    await client.end();
  }
  return token;
}

async function deleteAdminSession(token: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return;
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("DELETE FROM admin_sessions WHERE token = $1", [token]);
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  // Fail fast with a clear message if the site is not reachable.
  try {
    const probe = await fetch(`${BASE_URL}/`, { signal: AbortSignal.timeout(10_000) });
    if (!probe.ok) {
      throw new Error(`HTTP ${probe.status}`);
    }
  } catch (err) {
    console.error(
      `Cannot reach the website at ${BASE_URL} (${err instanceof Error ? err.message : String(err)}). ` +
        "Make sure the www and API server workflows are running.",
    );
    process.exit(1);
  }

  const executablePath = resolveChromiumPath();
  const browser: Browser = await chromium.launch({ executablePath });
  let adminToken: string | undefined;

  try {
    console.log(`Mobile layout check @ ${VIEWPORT.width}x${VIEWPORT.height} against ${BASE_URL}`);

    // --- Marketing pages (no auth) ---
    console.log("\nMarketing pages:");
    {
      const context = await browser.newContext({ viewport: VIEWPORT });
      const page = await context.newPage();
      for (const check of MARKETING_PAGES) {
        await checkPage(page, check);
      }
      await checkMobileMenu(page, MARKETING_MENU);
      await context.close();
    }

    // --- Portal pages (seeded customer account) ---
    console.log("\nPortal pages:");
    {
      const context = await browser.newContext({ viewport: VIEWPORT });
      if (await loginPortal(context)) {
        const page = await context.newPage();
        for (const check of PORTAL_PAGES) {
          await checkPage(page, check);
        }
        await checkMobileMenu(page, PORTAL_MENU);
      }
      await context.close();
    }

    // --- Admin pages (token inserted into admin_sessions) ---
    console.log("\nAdmin pages:");
    {
      adminToken = await createAdminSession();
      const context = await browser.newContext({ viewport: VIEWPORT });
      await context.addCookies([
        {
          name: "rnp_admin_session",
          value: adminToken,
          url: BASE_URL,
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      for (const check of ADMIN_PAGES) {
        await checkPage(page, check);
      }
      await context.close();
    }
  } finally {
    await browser.close();
    if (adminToken) {
      await deleteAdminSession(adminToken).catch(() => {});
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} mobile layout check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll mobile layout checks passed.");
}

main().catch((err) => {
  console.error("Mobile layout check crashed:", err);
  process.exit(1);
});
