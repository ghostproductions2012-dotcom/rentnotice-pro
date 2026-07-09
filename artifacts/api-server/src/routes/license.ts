import { Router, type IRouter } from "express";
import { eq, and, ne, asc } from "drizzle-orm";
import {
  db,
  cloudUsersTable,
  companiesTable,
  licenseKeysTable,
} from "@workspace/db";
import type { CloudUser, Company, LicenseKey } from "@workspace/db";
import {
  ActivateLicenseBody,
  VerifyLicenseBody,
  RedeemInviteBody,
} from "@workspace/api-zod";
import {
  computeLicenseStatus,
  syncStoredLicenseStatus,
  effectiveInviteExpiry,
  LICENSE_GRACE_DAYS,
  type ComputedLicenseStatus,
} from "../lib/license";
import { getPlanConfig } from "../lib/plans";
import { hashPassword } from "../lib/auth";

const router: IRouter = Router();

/**
 * Message shown when a key was explicitly revoked by the platform admin.
 * Revoked keys report "cancelled" to the desktop app (which understands
 * active/paused/cancelled) so existing installs degrade gracefully.
 */
const REVOKED_KEY_MESSAGE =
  "This license key has been revoked. Ask your administrator for the current key from the customer portal.";

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

    if (license.status === "revoked") {
      res.status(403).json({
        error: REVOKED_KEY_MESSAGE,
        code: "license_cancelled",
      });
      return;
    }

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

router.post("/license/redeem-invite", async (req, res, next) => {
  try {
    const parsed = RedeemInviteBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid input (password must be at least 8 characters)",
        code: "invalid_input",
      });
      return;
    }
    const code = parsed.data.inviteCode.trim().toUpperCase();

    const [invitee] = await db
      .select()
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.inviteCode, code));
    if (
      !invitee ||
      invitee.passwordHash !== null ||
      !invitee.active
    ) {
      res.status(400).json({
        error: "This invite code is invalid or has already been used",
        code: "invalid_invite_code",
      });
      return;
    }

    if (effectiveInviteExpiry(invitee).getTime() <= Date.now()) {
      res.status(400).json({
        error:
          "This invite code has expired. Ask your administrator to generate a new one.",
        code: "invalid_invite_code",
      });
      return;
    }

    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, invitee.companyId));
    // Bind the invitee to the oldest non-revoked key for the company
    const [license] = company
      ? await db
          .select()
          .from(licenseKeysTable)
          .where(
            and(
              eq(licenseKeysTable.companyId, company.id),
              ne(licenseKeysTable.status, "revoked"),
            ),
          )
          .orderBy(asc(licenseKeysTable.createdAt))
          .limit(1)
      : [];
    if (!company || !license) {
      res.status(400).json({
        error: "This invite code is invalid or has already been used",
        code: "invalid_invite_code",
      });
      return;
    }

    const computed = await computeLicenseStatus(company);
    await syncStoredLicenseStatus(license, computed);

    if (computed.status !== "active") {
      res.status(403).json({
        error: `License is ${computed.status}: ${computed.statusReason}`,
        code: `license_${computed.status}`,
      });
      return;
    }

    const [updated] = await db
      .update(cloudUsersTable)
      .set({
        name: parsed.data.name,
        passwordHash: hashPassword(parsed.data.password),
        inviteCode: null,
        inviteCodeExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(cloudUsersTable.id, invitee.id))
      .returning();
    if (!updated) throw new Error("Failed to redeem invite code");

    // Mark the license as seen from this device without stealing the primary
    // device binding established by /license/activate.
    const now = new Date();
    await db
      .update(licenseKeysTable)
      .set({
        activatedAt: license.activatedAt ?? now,
        lastVerifiedAt: now,
        deviceId: license.deviceId ?? parsed.data.deviceId,
        deviceName:
          license.deviceName ?? parsed.data.deviceName ?? null,
        updatedAt: now,
      })
      .where(eq(licenseKeysTable.id, license.id));

    res.json({
      licenseKey: license.key,
      user: directoryUser(updated),
      license: await buildLicenseInfo(license, company, computed),
    });
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

    if (license.status === "revoked") {
      // Report as cancelled (desktop understands active/paused/cancelled)
      // without recording device activity for a dead key.
      const computed = await computeLicenseStatus(company);
      res.json(
        await buildLicenseInfo(license, company, {
          ...computed,
          status: "cancelled",
          statusReason: REVOKED_KEY_MESSAGE,
        }),
      );
      return;
    }

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
