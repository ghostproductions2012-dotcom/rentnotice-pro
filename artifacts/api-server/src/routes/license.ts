import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  cloudUsersTable,
  companiesTable,
  licenseKeysTable,
} from "@workspace/db";
import type { CloudUser, Company, LicenseKey } from "@workspace/db";
import { ActivateLicenseBody, VerifyLicenseBody } from "@workspace/api-zod";
import {
  computeLicenseStatus,
  syncStoredLicenseStatus,
  LICENSE_GRACE_DAYS,
  type ComputedLicenseStatus,
} from "../lib/license";
import { getPlanConfig } from "../lib/plans";

const router: IRouter = Router();

function directoryUser(user: CloudUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    isMasterAdmin: user.isMasterAdmin,
  };
}

async function buildLicenseInfo(
  license: LicenseKey,
  company: Company,
  computed: ComputedLicenseStatus,
) {
  const plan = getPlanConfig(company.tier);
  const users = await db
    .select()
    .from(cloudUsersTable)
    .where(
      and(
        eq(cloudUsersTable.companyId, company.id),
        eq(cloudUsersTable.active, true),
      ),
    );
  return {
    status: computed.status,
    statusReason: computed.statusReason,
    company: { id: company.id, name: company.name },
    tier: company.tier,
    seats: plan?.seats ?? 0,
    paidThrough: computed.paidThrough?.toISOString() ?? null,
    users: users.map(directoryUser),
    graceDays: LICENSE_GRACE_DAYS,
    verifiedAt: new Date().toISOString(),
  };
}

async function findLicense(
  key: string,
): Promise<{ license: LicenseKey; company: Company } | null> {
  const [license] = await db
    .select()
    .from(licenseKeysTable)
    .where(eq(licenseKeysTable.key, key.trim().toUpperCase()));
  if (!license) return null;
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, license.companyId));
  if (!company) return null;
  return { license, company };
}

router.post("/license/activate", async (req, res, next) => {
  try {
    const parsed = ActivateLicenseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "invalid_input" });
      return;
    }
    const found = await findLicense(parsed.data.licenseKey);
    if (!found) {
      res
        .status(404)
        .json({ error: "Unknown license key", code: "unknown_key" });
      return;
    }
    const { license, company } = found;

    const computed = await computeLicenseStatus(company);
    await syncStoredLicenseStatus(license, computed);

    if (computed.status !== "active") {
      res.status(403).json({
        error: `License is ${computed.status}: ${computed.statusReason}`,
        code: `license_${computed.status}`,
      });
      return;
    }

    const now = new Date();
    await db
      .update(licenseKeysTable)
      .set({
        activatedAt: license.activatedAt ?? now,
        lastVerifiedAt: now,
        deviceId: parsed.data.deviceId,
        deviceName: parsed.data.deviceName ?? license.deviceName,
        updatedAt: now,
      })
      .where(eq(licenseKeysTable.id, license.id));

    res.json(await buildLicenseInfo(license, company, computed));
  } catch (err) {
    next(err);
  }
});

router.post("/license/verify", async (req, res, next) => {
  try {
    const parsed = VerifyLicenseBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "invalid_input" });
      return;
    }
    const found = await findLicense(parsed.data.licenseKey);
    if (!found) {
      res
        .status(404)
        .json({ error: "Unknown license key", code: "unknown_key" });
      return;
    }
    const { license, company } = found;

    const computed = await computeLicenseStatus(company);
    await syncStoredLicenseStatus(license, computed);

    const now = new Date();
    await db
      .update(licenseKeysTable)
      .set({
        lastVerifiedAt: now,
        ...(parsed.data.deviceId ? { deviceId: parsed.data.deviceId } : {}),
        updatedAt: now,
      })
      .where(eq(licenseKeysTable.id, license.id));

    // verify returns 200 with the effective status even when paused/cancelled
    res.json(await buildLicenseInfo(license, company, computed));
  } catch (err) {
    next(err);
  }
});

export default router;
