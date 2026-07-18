import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  licenseKeysTable,
  companiesTable,
  type CloudUser,
} from "@workspace/db";
import { getSessionUser } from "./auth";
import { computeLicenseStatus } from "./license";

/**
 * Company-scoped authentication for the communications hub.
 *
 * Two credentials are accepted:
 *  1. A license key — sent by the desktop app (`x-license-key` header) or the
 *     mobile app (`Authorization: Bearer RNP-…`). Resolves to the company the
 *     license belongs to. Sender identity within a company is client-declared
 *     (senderKey/senderName snapshots), consistent with the field-relay
 *     posture where the desktop owns user records.
 *  2. An rnp_session cookie — a portal session; resolves to the user's
 *     company and additionally attaches the session user for role checks.
 */

export interface CompanyScopedRequest extends Request {
  companyId: string;
  sessionUser?: CloudUser;
}

function extractLicenseKey(req: Request): string | null {
  const header = req.header("x-license-key");
  if (header && header.trim()) return header.trim().toUpperCase();
  const auth = req.header("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    // License keys look like RNP-XXXX-…; ignore unrelated bearer tokens.
    if (/^RNP-[A-Z0-9-]+$/i.test(token)) return token.toUpperCase();
  }
  return null;
}

/**
 * Best-effort company resolution from a license credential. Returns null when
 * no (valid) license key is attached. Used by the field-relay push routes to
 * stamp rows with their owning company without changing their auth posture.
 */
export async function resolveCompanyIdFromLicense(
  req: Request,
): Promise<string | null> {
  const key = extractLicenseKey(req);
  if (!key) return null;
  const [license] = await db
    .select()
    .from(licenseKeysTable)
    .where(eq(licenseKeysTable.key, key));
  if (!license || license.status === "revoked") return null;
  return license.companyId;
}

export function requireCompany(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  (async () => {
    const key = extractLicenseKey(req);
    if (key) {
      const [license] = await db
        .select()
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.key, key));
      if (!license || license.status === "revoked") {
        res.status(401).json({
          error: "Invalid or revoked license key",
          code: "invalid_license",
        });
        return;
      }
      const [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, license.companyId));
      if (!company) {
        res.status(401).json({
          error: "Invalid or revoked license key",
          code: "invalid_license",
        });
        return;
      }
      const computed = await computeLicenseStatus(company);
      if (computed.status !== "active") {
        res.status(401).json({
          error: `License is ${computed.status}: ${computed.statusReason}`,
          code: `license_${computed.status}`,
        });
        return;
      }
      (req as CompanyScopedRequest).companyId = company.id;
      // A portal session may accompany the license key (the desktop combines
      // both for privileged routes such as integration management). Attach it
      // when it belongs to the same company so downstream role checks can
      // rely on a server-validated user rather than client-declared identity.
      const sessionUser = await getSessionUser(req);
      if (sessionUser && sessionUser.companyId === company.id) {
        (req as CompanyScopedRequest).sessionUser = sessionUser;
      }
      next();
      return;
    }

    const user = await getSessionUser(req);
    if (user) {
      (req as CompanyScopedRequest).companyId = user.companyId;
      (req as CompanyScopedRequest).sessionUser = user;
      next();
      return;
    }

    res.status(401).json({
      error: "Missing credentials",
      code: "unauthorized",
    });
  })().catch(next);
}
