import { Router, type IRouter } from "express";
import { and, asc, desc, eq, ne } from "drizzle-orm";
import {
  db,
  companiesTable,
  cloudUsersTable,
  licenseKeysTable,
  pendingSignupsTable,
  USER_ROLES,
} from "@workspace/db";
import type { CloudUser, Company, LicenseKey } from "@workspace/db";
import {
  AdminLoginBody,
  CreateAdminLicenseKeyBody,
  UpdateAdminLicenseKeyBody,
  UpdateAdminUserBody,
} from "@workspace/api-zod";
import {
  clearAdminSessionCookie,
  clearFailedAttempts,
  createAdminSession,
  destroyAdminSession,
  getAdminCredentials,
  getAdminSessionToken,
  isRateLimited,
  recordFailedAttempt,
  requirePlatformAdmin,
  setAdminSessionCookie,
  verifyAdminCredentials,
} from "../lib/adminAuth";
import {
  computeLicenseStatus,
  generateLicenseKey,
  type ComputedLicenseStatus,
} from "../lib/license";
import { getPlanConfig, PLAN_CONFIGS } from "../lib/plans";

const router: IRouter = Router();

// ---------------------------------------------------------------------------
// Payload helpers
// ---------------------------------------------------------------------------

function licenseKeyPayload(key: LicenseKey) {
  return {
    id: key.id,
    key: key.key,
    status: key.status,
    activatedAt: key.activatedAt?.toISOString() ?? null,
    lastVerifiedAt: key.lastVerifiedAt?.toISOString() ?? null,
    deviceId: key.deviceId,
    deviceName: key.deviceName,
    createdAt: key.createdAt.toISOString(),
  };
}

function userStatus(user: CloudUser): "active" | "invited" | "deactivated" {
  if (!user.active) return "deactivated";
  if (!user.passwordHash) return "invited";
  return "active";
}

function adminUserPayload(user: CloudUser) {
  const pending = user.active && user.passwordHash === null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    isMasterAdmin: user.isMasterAdmin,
    status: userStatus(user),
    inviteCode: pending ? user.inviteCode : null,
    inviteCodeExpiresAt:
      pending && user.inviteCode
        ? (user.inviteCodeExpiresAt?.toISOString() ?? null)
        : null,
    createdAt: user.createdAt?.toISOString() ?? null,
  };
}

interface CompanyRollup {
  company: Company;
  computed: ComputedLicenseStatus;
  users: CloudUser[];
  keys: LicenseKey[];
}

async function rollupCompany(company: Company): Promise<CompanyRollup> {
  const [computed, users, keys] = await Promise.all([
    computeLicenseStatus(company),
    db
      .select()
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.companyId, company.id))
      .orderBy(asc(cloudUsersTable.createdAt)),
    db
      .select()
      .from(licenseKeysTable)
      .where(eq(licenseKeysTable.companyId, company.id))
      .orderBy(asc(licenseKeysTable.createdAt)),
  ]);
  return { company, computed, users, keys };
}

function companySummaryPayload(rollup: CompanyRollup) {
  const { company, computed, users, keys } = rollup;
  const plan = getPlanConfig(company.tier);
  const activeUsers = users.filter((u) => u.active);
  const liveKeys = keys.filter((k) => k.status !== "revoked");
  return {
    id: company.id,
    name: company.name,
    contactEmail: company.contactEmail,
    tier: company.tier,
    tierName: plan?.name ?? company.tier,
    seats: plan?.seats ?? 0,
    seatsUsed: activeUsers.length,
    licenseStatus: computed.status,
    subscriptionStatus: computed.subscriptionStatus,
    keyCount: liveKeys.length,
    priceMonthlyCents: computed.priceMonthlyCents,
    createdAt: company.createdAt.toISOString(),
  };
}

function auditChecks(rollup: CompanyRollup) {
  const { company, computed, users, keys } = rollup;
  const plan = getPlanConfig(company.tier);
  const seats = plan?.seats ?? 0;
  const seatsUsed = users.filter((u) => u.active).length;
  const liveKeys = keys.filter((k) => k.status !== "revoked");
  const revokedKeys = keys.length - liveKeys.length;
  const activatedKeys = liveKeys.filter((k) => k.activatedAt !== null).length;

  const checks: Array<{
    id: string;
    label: string;
    status: "pass" | "warn" | "info";
    detail: string;
  }> = [];

  checks.push({
    id: "seat_limit",
    label: "Seat limit enforcement",
    status: seatsUsed <= seats ? "pass" : "warn",
    detail:
      seatsUsed <= seats
        ? `${seatsUsed} of ${seats} seats in use. New invites are blocked once the ${plan?.name ?? company.tier} limit is reached.`
        : `${seatsUsed} active members exceed the ${seats}-seat ${plan?.name ?? company.tier} limit (members added before a downgrade keep access; new invites are blocked).`,
  });

  checks.push({
    id: "subscription",
    label: "Subscription standing",
    status: computed.status === "active" ? "pass" : "warn",
    detail: `${computed.statusReason} (Stripe status: ${computed.subscriptionStatus}).`,
  });

  checks.push({
    id: "license_keys",
    label: "License keys",
    status: liveKeys.length > 0 ? "pass" : "warn",
    detail:
      liveKeys.length > 0
        ? `${liveKeys.length} live key${liveKeys.length === 1 ? "" : "s"} (${activatedKeys} activated on a device${revokedKeys > 0 ? `, ${revokedKeys} revoked` : ""}).`
        : `No live license keys — the desktop app cannot activate${revokedKeys > 0 ? ` (${revokedKeys} revoked)` : ""}. Generate a new key below.`,
  });

  checks.push({
    id: "device_binding",
    label: "Device binding",
    status: "info",
    detail:
      "The last device to verify is recorded for support, but installs are not limited per key — team access is controlled by seats and invite codes.",
  });

  checks.push({
    id: "tier_features",
    label: "Tier differences",
    status: "info",
    detail: `Tiers differ by seat count (Starter 3, Professional 10, Enterprise 50); desktop features are identical across tiers. This company's ${plan?.name ?? company.tier} plan allows ${seats} seats.`,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

router.post("/www/admin/login", async (req, res, next) => {
  try {
    const creds = getAdminCredentials();
    if (!creds) {
      res.status(503).json({
        error:
          "Admin panel is not configured. Set ADMIN_PANEL_EMAIL and ADMIN_PANEL_PASSWORD.",
        code: "admin_not_configured",
      });
      return;
    }
    if (isRateLimited(req)) {
      res.status(429).json({
        error: "Too many failed attempts. Try again in 15 minutes.",
        code: "rate_limited",
      });
      return;
    }
    const parsed = AdminLoginBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "invalid_input" });
      return;
    }
    if (!verifyAdminCredentials(parsed.data.email, parsed.data.password)) {
      recordFailedAttempt(req);
      res
        .status(401)
        .json({ error: "Invalid email or password", code: "bad_credentials" });
      return;
    }
    clearFailedAttempts(req);
    const session = await createAdminSession();
    setAdminSessionCookie(res, session.token, session.expiresAt);
    res.json({ email: creds.email });
  } catch (err) {
    next(err);
  }
});

router.post("/www/admin/logout", async (req, res, next) => {
  try {
    const token = getAdminSessionToken(req);
    if (token) await destroyAdminSession(token);
    clearAdminSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/www/admin/me", requirePlatformAdmin, async (_req, res, next) => {
  try {
    const creds = getAdminCredentials();
    res.json({ email: creds?.email ?? "" });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

router.get(
  "/www/admin/metrics",
  requirePlatformAdmin,
  async (_req, res, next) => {
    try {
      const [companies, users, keys, pending] = await Promise.all([
        db.select().from(companiesTable),
        db.select().from(cloudUsersTable),
        db.select().from(licenseKeysTable),
        db
          .select()
          .from(pendingSignupsTable)
          .where(ne(pendingSignupsTable.status, "completed")),
      ]);

      const computedAll = await Promise.all(
        companies.map((c) => computeLicenseStatus(c)),
      );

      let activeSubscriptions = 0;
      let mrrCents = 0;
      computedAll.forEach((computed) => {
        if (computed.status === "active") {
          activeSubscriptions += 1;
          mrrCents += computed.priceMonthlyCents ?? 0;
        }
      });

      const tierCounts = new Map<string, number>();
      companies.forEach((c) => {
        tierCounts.set(c.tier, (tierCounts.get(c.tier) ?? 0) + 1);
      });
      const byTier = PLAN_CONFIGS.map((plan) => ({
        tier: plan.tier,
        tierName: plan.name,
        companies: tierCounts.get(plan.tier) ?? 0,
      }));
      // Surface unexpected tiers rather than hiding them
      tierCounts.forEach((count, tier) => {
        if (!PLAN_CONFIGS.some((p) => p.tier === tier)) {
          byTier.push({ tier, tierName: tier, companies: count });
        }
      });

      const liveKeys = keys.filter((k) => k.status !== "revoked");
      res.json({
        totalCompanies: companies.length,
        activeSubscriptions,
        mrrCents,
        totalUsers: users.length,
        activeUsers: users.filter((u) => u.active).length,
        totalLicenseKeys: liveKeys.length,
        activatedLicenseKeys: liveKeys.filter((k) => k.activatedAt !== null)
          .length,
        pendingSignups: pending.length,
        byTier,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------------

router.get(
  "/www/admin/companies",
  requirePlatformAdmin,
  async (_req, res, next) => {
    try {
      const companies = await db
        .select()
        .from(companiesTable)
        .orderBy(desc(companiesTable.createdAt));
      const rollups = await Promise.all(companies.map(rollupCompany));
      res.json(rollups.map(companySummaryPayload));
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/www/admin/companies/:companyId",
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, String(req.params["companyId"])));
      if (!company) {
        res
          .status(404)
          .json({ error: "Company not found", code: "not_found" });
        return;
      }
      const rollup = await rollupCompany(company);
      const plan = getPlanConfig(company.tier);
      res.json({
        company: {
          id: company.id,
          name: company.name,
          contactEmail: company.contactEmail,
          tier: company.tier,
          createdAt: company.createdAt.toISOString(),
          stripeCustomerId: company.stripeCustomerId,
          stripeSubscriptionId: company.stripeSubscriptionId,
        },
        subscription: {
          tier: company.tier,
          tierName: plan?.name ?? company.tier,
          seats: plan?.seats ?? 0,
          status: rollup.computed.subscriptionStatus,
          currentPeriodEnd:
            rollup.computed.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: rollup.computed.cancelAtPeriodEnd,
          priceMonthlyCents: rollup.computed.priceMonthlyCents,
        },
        license: {
          status: rollup.computed.status,
          statusReason: rollup.computed.statusReason,
          paidThrough: rollup.computed.paidThrough?.toISOString() ?? null,
        },
        licenses: rollup.keys.map(licenseKeyPayload),
        users: rollup.users.map(adminUserPayload),
        audit: auditChecks(rollup),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// License key management
// ---------------------------------------------------------------------------

router.post(
  "/www/admin/companies/:companyId/license-keys",
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const parsed = CreateAdminLicenseKeyBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", code: "invalid_input" });
        return;
      }
      const [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, String(req.params["companyId"])));
      if (!company) {
        res
          .status(404)
          .json({ error: "Company not found", code: "not_found" });
        return;
      }

      if (parsed.data.rotate) {
        await db
          .update(licenseKeysTable)
          .set({ status: "revoked", updatedAt: new Date() })
          .where(
            and(
              eq(licenseKeysTable.companyId, company.id),
              ne(licenseKeysTable.status, "revoked"),
            ),
          );
      }

      const [created] = await db
        .insert(licenseKeysTable)
        .values({
          companyId: company.id,
          key: generateLicenseKey(),
          status: "active",
        })
        .returning();
      if (!created) throw new Error("Failed to create license key");

      res.status(201).json(licenseKeyPayload(created));
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/www/admin/license-keys/:keyId",
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const parsed = UpdateAdminLicenseKeyBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", code: "invalid_input" });
        return;
      }
      const [key] = await db
        .select()
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.id, String(req.params["keyId"])));
      if (!key) {
        res
          .status(404)
          .json({ error: "License key not found", code: "not_found" });
        return;
      }
      const [updated] = await db
        .update(licenseKeysTable)
        .set({ status: parsed.data.status, updatedAt: new Date() })
        .where(eq(licenseKeysTable.id, key.id))
        .returning();
      if (!updated) throw new Error("Failed to update license key");
      res.json(licenseKeyPayload(updated));
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/www/admin/license-keys/:keyId/reset-device",
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const [key] = await db
        .select()
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.id, String(req.params["keyId"])));
      if (!key) {
        res
          .status(404)
          .json({ error: "License key not found", code: "not_found" });
        return;
      }
      const [updated] = await db
        .update(licenseKeysTable)
        .set({ deviceId: null, deviceName: null, updatedAt: new Date() })
        .where(eq(licenseKeysTable.id, key.id))
        .returning();
      if (!updated) throw new Error("Failed to reset device binding");
      res.json(licenseKeyPayload(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// User management (platform level)
// ---------------------------------------------------------------------------

router.patch(
  "/www/admin/users/:userId",
  requirePlatformAdmin,
  async (req, res, next) => {
    try {
      const parsed = UpdateAdminUserBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", code: "invalid_input" });
        return;
      }
      const [target] = await db
        .select()
        .from(cloudUsersTable)
        .where(eq(cloudUsersTable.id, String(req.params["userId"])));
      if (!target) {
        res.status(404).json({ error: "User not found", code: "not_found" });
        return;
      }

      const { role, active } = parsed.data;
      if (target.isMasterAdmin) {
        if (role !== undefined && role !== "admin") {
          res.status(400).json({
            error:
              "The master admin cannot be demoted — the company would lose its billing owner",
            code: "master_admin_protected",
          });
          return;
        }
        if (active === false) {
          res.status(400).json({
            error:
              "The master admin cannot be deactivated — the company would lose its billing owner",
            code: "master_admin_protected",
          });
          return;
        }
      }
      if (role !== undefined && !USER_ROLES.includes(role)) {
        res.status(400).json({ error: "Invalid role", code: "invalid_role" });
        return;
      }

      const updates: Partial<{
        role: string;
        active: boolean;
        updatedAt: Date;
      }> = { updatedAt: new Date() };
      if (role !== undefined) updates.role = role;
      if (active !== undefined) updates.active = active;

      const [updated] = await db
        .update(cloudUsersTable)
        .set(updates)
        .where(eq(cloudUsersTable.id, target.id))
        .returning();
      if (!updated) throw new Error("Failed to update user");
      res.json(adminUserPayload(updated));
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// Pending signups
// ---------------------------------------------------------------------------

router.get(
  "/www/admin/pending-signups",
  requirePlatformAdmin,
  async (_req, res, next) => {
    try {
      const rows = await db
        .select()
        .from(pendingSignupsTable)
        .where(ne(pendingSignupsTable.status, "completed"))
        .orderBy(desc(pendingSignupsTable.createdAt));
      res.json(
        rows.map((row) => ({
          id: row.id,
          companyName: row.companyName,
          adminName: row.adminName,
          email: row.email,
          tier: row.tier,
          status: row.status,
          createdAt: row.createdAt.toISOString(),
        })),
      );
    } catch (err) {
      next(err);
    }
  },
);

export default router;
