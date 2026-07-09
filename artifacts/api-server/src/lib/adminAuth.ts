import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, adminSessionsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";

const ADMIN_COOKIE = "rnp_admin_session";
const ADMIN_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ---------------------------------------------------------------------------
// Credentials (env-based; no admin user rows in the database)
// ---------------------------------------------------------------------------

export function getAdminCredentials(): {
  email: string;
  password: string;
} | null {
  const email = process.env.ADMIN_PANEL_EMAIL?.trim();
  const password = process.env.ADMIN_PANEL_PASSWORD;
  if (!email || !password) return null;
  return { email: email.toLowerCase(), password };
}

/** Constant-time string comparison that does not leak length. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function verifyAdminCredentials(
  email: string,
  password: string,
): boolean {
  const creds = getAdminCredentials();
  if (!creds) return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), creds.email);
  const passwordOk = safeEqual(password, creds.password);
  return emailOk && passwordOk;
}

// ---------------------------------------------------------------------------
// Login rate limiting (in-memory, per IP)
// ---------------------------------------------------------------------------

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const failedAttempts = new Map<string, { count: number; resetAt: number }>();

function clientIp(req: Request): string {
  return req.ip ?? "unknown";
}

export function isRateLimited(req: Request): boolean {
  const entry = failedAttempts.get(clientIp(req));
  if (!entry) return false;
  if (entry.resetAt <= Date.now()) {
    failedAttempts.delete(clientIp(req));
    return false;
  }
  return entry.count >= MAX_FAILED_ATTEMPTS;
}

export function recordFailedAttempt(req: Request): void {
  const ip = clientIp(req);
  const now = Date.now();
  const entry = failedAttempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    failedAttempts.set(ip, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearFailedAttempts(req: Request): void {
  failedAttempts.delete(clientIp(req));
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function createAdminSession(): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_TTL_MS);
  await db.insert(adminSessionsTable).values({ token, expiresAt });
  return { token, expiresAt };
}

export function setAdminSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(ADMIN_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export function clearAdminSessionCookie(res: Response): void {
  res.clearCookie(ADMIN_COOKIE, { path: "/" });
}

export function getAdminSessionToken(req: Request): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[
    ADMIN_COOKIE
  ];
}

export async function destroyAdminSession(token: string): Promise<void> {
  await db
    .delete(adminSessionsTable)
    .where(eq(adminSessionsTable.token, token));
}

export async function hasValidAdminSession(req: Request): Promise<boolean> {
  const token = getAdminSessionToken(req);
  if (!token) return false;

  const [session] = await db
    .select()
    .from(adminSessionsTable)
    .where(eq(adminSessionsTable.token, token));
  if (!session) return false;
  if (session.expiresAt.getTime() < Date.now()) {
    await destroyAdminSession(token);
    // Opportunistic cleanup of other expired admin sessions
    await db
      .delete(adminSessionsTable)
      .where(lt(adminSessionsTable.expiresAt, new Date()));
    return false;
  }
  return true;
}

export function requirePlatformAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  hasValidAdminSession(req)
    .then((valid) => {
      if (!valid) {
        res
          .status(401)
          .json({ error: "Not logged in as platform admin", code: "unauthorized" });
        return;
      }
      next();
    })
    .catch(next);
}
