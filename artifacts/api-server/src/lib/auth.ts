import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { db, cloudUsersTable, webSessionsTable } from "@workspace/db";
import { eq, lt } from "drizzle-orm";
import type { CloudUser } from "@workspace/db";

const SESSION_COOKIE = "rnp_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}

export async function createSession(userId: string): Promise<{
  token: string;
  expiresAt: Date;
}> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(webSessionsTable).values({ token, userId, expiresAt });
  return { token, expiresAt };
}

export function setSessionCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export async function destroySession(token: string): Promise<void> {
  await db.delete(webSessionsTable).where(eq(webSessionsTable.token, token));
}

export async function getSessionUser(req: Request): Promise<CloudUser | null> {
  const token = (req as Request & { cookies?: Record<string, string> })
    .cookies?.[SESSION_COOKIE];
  if (!token) return null;

  const [session] = await db
    .select()
    .from(webSessionsTable)
    .where(eq(webSessionsTable.token, token));
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await destroySession(token);
    // Opportunistic cleanup of other expired sessions
    await db
      .delete(webSessionsTable)
      .where(lt(webSessionsTable.expiresAt, new Date()));
    return null;
  }

  const [user] = await db
    .select()
    .from(cloudUsersTable)
    .where(eq(cloudUsersTable.id, session.userId));
  if (!user || !user.active) return null;
  return user;
}

export function getSessionToken(req: Request): string | undefined {
  return (req as Request & { cookies?: Record<string, string> }).cookies?.[
    SESSION_COOKIE
  ];
}

export interface AuthedRequest extends Request {
  user: CloudUser;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  getSessionUser(req)
    .then((user) => {
      if (!user) {
        res.status(401).json({ error: "Not logged in", code: "unauthorized" });
        return;
      }
      (req as AuthedRequest).user = user;
      next();
    })
    .catch(next);
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const user = (req as AuthedRequest).user;
  if (!user || user.role !== "admin") {
    res.status(403).json({ error: "Requires admin role", code: "forbidden" });
    return;
  }
  next();
}
