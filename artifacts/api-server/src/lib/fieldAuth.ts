import { createHash } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, fieldSyncTokensTable, licenseKeysTable } from "@workspace/db";

// Auth layer for the /api/field/* sync relay. Requests must present either:
//   - a desktop license key (`x-license-key` header), or
//   - a per-device sync token issued by the desktop app
//     (`x-field-sync-token` header or `Authorization: Bearer <token>`).
// Tokens are issued/revoked via the /api/field/devices routes, which require
// the license key (only the desktop app can manage device access).

export interface FieldAuthContext {
  kind: "license" | "device";
  // Tenant boundary: every relay query must be scoped to this company.
  companyId: string;
}

declare global {
  namespace Express {
    interface Request {
      fieldAuth?: FieldAuthContext;
    }
  }
}

const TOKEN_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateFieldSyncToken(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = Array.from(
    bytes,
    (b) => TOKEN_ALPHABET[b % TOKEN_ALPHABET.length],
  );
  return `RNF-${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8, 12).join("")}`;
}

export function normalizeFieldSyncToken(raw: string): string {
  return raw.trim().toUpperCase();
}

// Tokens are high-entropy random strings, so a fast unsalted SHA-256 is
// sufficient (no bcrypt-style stretching needed) and allows indexed lookup.
export function hashFieldSyncToken(raw: string): string {
  return createHash("sha256")
    .update(normalizeFieldSyncToken(raw))
    .digest("hex");
}

async function resolveLicense(key: string): Promise<FieldAuthContext | null> {
  const rows = await db
    .select()
    .from(licenseKeysTable)
    .where(eq(licenseKeysTable.key, key.trim().toUpperCase()));
  const license = rows[0];
  if (!license || license.status === "revoked" || !license.companyId) {
    return null;
  }
  return { kind: "license", companyId: license.companyId };
}

async function resolveDeviceToken(
  raw: string,
): Promise<FieldAuthContext | null> {
  const token = normalizeFieldSyncToken(raw);
  if (!token) return null;
  const rows = await db
    .select()
    .from(fieldSyncTokensTable)
    .where(eq(fieldSyncTokensTable.tokenHash, hashFieldSyncToken(token)));
  const record = rows[0];
  if (!record || record.revokedAt || !record.companyId) return null;
  // Best-effort usage timestamp; never block the sync on it.
  void db
    .update(fieldSyncTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(fieldSyncTokensTable.id, record.id))
    .catch(() => undefined);
  return { kind: "device", companyId: record.companyId };
}

function extractDeviceToken(req: Request): string | null {
  const header = req.header("x-field-sync-token");
  if (header) return header;
  const auth = req.header("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7);
  return null;
}

export async function requireFieldAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const licenseKey = req.header("x-license-key");
    if (licenseKey) {
      const ctx = await resolveLicense(licenseKey);
      if (ctx) {
        req.fieldAuth = ctx;
        next();
        return;
      }
    }
    const deviceToken = extractDeviceToken(req);
    if (deviceToken) {
      const ctx = await resolveDeviceToken(deviceToken);
      if (ctx) {
        req.fieldAuth = ctx;
        next();
        return;
      }
    }
    res.status(401).json({
      message:
        "Field sync authentication required. Provide a valid license key or device access code.",
      code: "field_auth_required",
    });
  } catch (err) {
    next(err);
  }
}

// Device token management is desktop-only: it must be authenticated with the
// license key, never with another device token.
export function requireLicenseAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.fieldAuth?.kind === "license") {
    next();
    return;
  }
  res.status(403).json({
    message: "Managing field devices requires the desktop license key.",
    code: "license_required",
  });
}
