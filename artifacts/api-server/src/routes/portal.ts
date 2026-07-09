import { Router, type IRouter } from "express";
import { eq, and, ne } from "drizzle-orm";
import {
  db,
  cloudUsersTable,
  companiesTable,
  licenseKeysTable,
  USER_ROLES,
} from "@workspace/db";
import type { CloudUser } from "@workspace/db";
import {
  InviteCompanyUserBody,
  UpdateCompanyUserBody,
} from "@workspace/api-zod";
import { requireAuth, requireAdmin, type AuthedRequest } from "../lib/auth";
import {
  computeLicenseStatus,
  syncStoredLicenseStatus,
  generateLicenseKey,
  generateInviteCode,
  inviteCodeExpiry,
  effectiveInviteExpiry,
} from "../lib/license";
import { getPlanConfig } from "../lib/plans";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getPublicBaseUrl } from "../lib/stripeData";
import { sendInviteEmail } from "../lib/email";

const router: IRouter = Router();

function userStatus(user: CloudUser): "active" | "invited" | "deactivated" {
  if (!user.active) return "deactivated";
  if (!user.passwordHash) return "invited";
  return "active";
}

function companyUserPayload(user: CloudUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    username: user.username,
    role: user.role,
    active: user.active,
    isMasterAdmin: user.isMasterAdmin,
    status: userStatus(user),
    createdAt: user.createdAt?.toISOString() ?? null,
  };
}

router.get("/www/portal/overview", requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, user.companyId));
    if (!company) {
      res.status(404).json({ error: "Company not found", code: "not_found" });
      return;
    }

    let [license] = await db
      .select()
      .from(licenseKeysTable)
      .where(
        and(
          eq(licenseKeysTable.companyId, company.id),
          ne(licenseKeysTable.status, "revoked"),
        ),
      )
      .orderBy(licenseKeysTable.createdAt)
      .limit(1);
    if (!license) {
      // Self-heal: a company without a usable license key row (none at all,
      // or every key revoked by the platform admin) would strand the portal
      // on "License key not found". Provision a fresh key lazily, then
      // re-read so a concurrent request's insert wins deterministically.
      await db.insert(licenseKeysTable).values({
        companyId: company.id,
        key: generateLicenseKey(),
        status: "active",
      });
      [license] = await db
        .select()
        .from(licenseKeysTable)
        .where(
          and(
            eq(licenseKeysTable.companyId, company.id),
            ne(licenseKeysTable.status, "revoked"),
          ),
        )
        .orderBy(licenseKeysTable.createdAt)
        .limit(1);
    }
    if (!license) {
      res
        .status(404)
        .json({ error: "License key not found", code: "not_found" });
      return;
    }

    const computed = await computeLicenseStatus(company);
    await syncStoredLicenseStatus(license, computed);

    const plan = getPlanConfig(company.tier);
    const members = await db
      .select()
      .from(cloudUsersTable)
      .where(
        and(
          eq(cloudUsersTable.companyId, company.id),
          eq(cloudUsersTable.active, true),
        ),
      );

    res.json({
      company: {
        id: company.id,
        name: company.name,
        contactEmail: company.contactEmail,
      },
      license: {
        key: license.key,
        status: computed.status,
        statusReason: computed.statusReason,
        activatedAt: license.activatedAt?.toISOString() ?? null,
        lastVerifiedAt: license.lastVerifiedAt?.toISOString() ?? null,
        paidThrough: computed.paidThrough?.toISOString() ?? null,
      },
      subscription: {
        tier: company.tier,
        tierName: plan?.name ?? company.tier,
        seats: plan?.seats ?? 0,
        status: computed.subscriptionStatus,
        currentPeriodEnd: computed.currentPeriodEnd?.toISOString() ?? null,
        cancelAtPeriodEnd: computed.cancelAtPeriodEnd,
        priceMonthlyCents: computed.priceMonthlyCents,
      },
      seatsUsed: members.length,
    });
  } catch (err) {
    next(err);
  }
});

router.post(
  "/www/portal/billing",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user;
      const [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, user.companyId));
      if (!company?.stripeCustomerId) {
        res.status(404).json({
          error: "No billing account found for this company",
          code: "no_customer",
        });
        return;
      }
      const stripe = await getUncachableStripeClient();
      const session = await stripe.billingPortal.sessions.create({
        customer: company.stripeCustomerId,
        return_url: `${getPublicBaseUrl()}/portal`,
      });
      res.json({ url: session.url });
    } catch (err) {
      next(err);
    }
  },
);

router.get("/www/portal/users", requireAuth, async (req, res, next) => {
  try {
    const user = (req as AuthedRequest).user;
    const users = await db
      .select()
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.companyId, user.companyId));
    res.json(users.map(companyUserPayload));
  } catch (err) {
    next(err);
  }
});

router.post(
  "/www/portal/users",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const parsed = InviteCompanyUserBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", code: "invalid_input" });
        return;
      }
      const admin = (req as AuthedRequest).user;
      const email = parsed.data.email.trim().toLowerCase();
      const role = parsed.data.role;

      if (!USER_ROLES.includes(role)) {
        res.status(400).json({ error: "Invalid role", code: "invalid_role" });
        return;
      }

      const [existing] = await db
        .select({ id: cloudUsersTable.id })
        .from(cloudUsersTable)
        .where(eq(cloudUsersTable.email, email));
      if (existing) {
        res.status(400).json({
          error: "A user with this email already exists",
          code: "email_taken",
        });
        return;
      }

      const [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, admin.companyId));
      if (!company) {
        res
          .status(404)
          .json({ error: "Company not found", code: "not_found" });
        return;
      }
      const plan = getPlanConfig(company.tier);
      const activeMembers = await db
        .select({ id: cloudUsersTable.id })
        .from(cloudUsersTable)
        .where(
          and(
            eq(cloudUsersTable.companyId, company.id),
            eq(cloudUsersTable.active, true),
          ),
        );
      if (plan && activeMembers.length >= plan.seats) {
        res.status(400).json({
          error: `Your ${plan.name} plan includes ${plan.seats} seats and all are in use. Upgrade to add more team members.`,
          code: "seat_limit",
        });
        return;
      }

      const inviteCode = generateInviteCode();
      const inviteCodeExpiresAt = inviteCodeExpiry();
      const [invited] = await db
        .insert(cloudUsersTable)
        .values({
          companyId: company.id,
          email,
          name: email.split("@")[0] ?? email,
          passwordHash: null,
          role,
          isMasterAdmin: false,
          active: true,
          inviteCode,
          inviteCodeExpiresAt,
        })
        .returning();
      if (!invited) throw new Error("Failed to create invited user");

      // Download link is best-effort: a missing REPLIT_DOMAINS must not
      // block invite creation (the email still carries the invite code).
      let downloadUrl: string | undefined;
      try {
        downloadUrl = `${getPublicBaseUrl()}/download`;
      } catch {
        downloadUrl = undefined;
      }

      const emailSent = await sendInviteEmail({
        to: email,
        companyName: company.name,
        role,
        invitedByName: admin.name || admin.email,
        inviteCode,
        downloadUrl,
      });

      res.status(201).json({
        user: companyUserPayload(invited),
        inviteCode,
        inviteCodeExpiresAt: inviteCodeExpiresAt.toISOString(),
        emailSent,
      });
    } catch (err) {
      next(err);
    }
  },
);

/** Loads a still-pending invitee (no password yet) belonging to the admin's company. */
async function findPendingInvitee(
  companyId: string,
  userId: string,
): Promise<CloudUser | null> {
  const [target] = await db
    .select()
    .from(cloudUsersTable)
    .where(
      and(
        eq(cloudUsersTable.id, userId),
        eq(cloudUsersTable.companyId, companyId),
      ),
    );
  if (!target || target.passwordHash !== null || !target.active) return null;
  return target;
}

router.get(
  "/www/portal/users/:userId/invite-code",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const admin = (req as AuthedRequest).user;
      const target = await findPendingInvitee(
        admin.companyId,
        String(req.params["userId"]),
      );
      if (!target || !target.inviteCode) {
        res.status(404).json({
          error: "No pending invite code for this user",
          code: "not_found",
        });
        return;
      }
      res.json({
        inviteCode: target.inviteCode,
        // Legacy codes without a stored expiry fall back to createdAt + TTL,
        // matching what the redeem endpoint enforces.
        inviteCodeExpiresAt: effectiveInviteExpiry(target).toISOString(),
        email: target.email,
        role: target.role,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/www/portal/users/:userId/invite-code",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const admin = (req as AuthedRequest).user;
      const target = await findPendingInvitee(
        admin.companyId,
        String(req.params["userId"]),
      );
      if (!target) {
        res.status(404).json({
          error: "This user is not a pending invitee",
          code: "not_found",
        });
        return;
      }
      const inviteCode = generateInviteCode();
      const inviteCodeExpiresAt = inviteCodeExpiry();
      const [updated] = await db
        .update(cloudUsersTable)
        .set({ inviteCode, inviteCodeExpiresAt, updatedAt: new Date() })
        .where(eq(cloudUsersTable.id, target.id))
        .returning();
      if (!updated) throw new Error("Failed to regenerate invite code");
      res.json({
        inviteCode,
        inviteCodeExpiresAt: inviteCodeExpiresAt.toISOString(),
        email: updated.email,
        role: updated.role,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/www/portal/users/:userId",
  requireAuth,
  requireAdmin,
  async (req, res, next) => {
    try {
      const parsed = UpdateCompanyUserBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid input", code: "invalid_input" });
        return;
      }
      const admin = (req as AuthedRequest).user;
      const userId = String(req.params["userId"]);

      const [target] = await db
        .select()
        .from(cloudUsersTable)
        .where(
          and(
            eq(cloudUsersTable.id, userId),
            eq(cloudUsersTable.companyId, admin.companyId),
          ),
        );
      if (!target) {
        res.status(404).json({ error: "User not found", code: "not_found" });
        return;
      }

      const { role, active, username } = parsed.data;
      if (target.isMasterAdmin) {
        if (role !== undefined && role !== "admin") {
          res.status(400).json({
            error: "The master admin cannot be demoted",
            code: "master_admin_protected",
          });
          return;
        }
        if (active === false) {
          res.status(400).json({
            error: "The master admin cannot be deactivated",
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
        username: string | null;
        updatedAt: Date;
      }> = { updatedAt: new Date() };
      if (role !== undefined) updates.role = role;
      if (active !== undefined) updates.active = active;
      if (username !== undefined) {
        const normalized = username === null ? null : username.trim().toLowerCase();
        if (normalized === null || normalized === "") {
          updates.username = null;
        } else {
          if (!/^[a-z0-9._-]{1,32}$/.test(normalized)) {
            res.status(400).json({
              error:
                "Usernames may only contain lowercase letters, numbers, dots, underscores and hyphens (max 32 characters)",
              code: "invalid_username",
            });
            return;
          }
          const [taken] = await db
            .select({ id: cloudUsersTable.id })
            .from(cloudUsersTable)
            .where(
              and(
                eq(cloudUsersTable.companyId, admin.companyId),
                eq(cloudUsersTable.username, normalized),
              ),
            );
          if (taken && taken.id !== target.id) {
            res.status(400).json({
              error: "Another team member already uses this username",
              code: "username_taken",
            });
            return;
          }
          updates.username = normalized;
        }
      }

      const [updated] = await db
        .update(cloudUsersTable)
        .set(updates)
        .where(eq(cloudUsersTable.id, target.id))
        .returning();
      if (!updated) throw new Error("Failed to update user");

      res.json(companyUserPayload(updated));
    } catch (err) {
      next(err);
    }
  },
);

export default router;
