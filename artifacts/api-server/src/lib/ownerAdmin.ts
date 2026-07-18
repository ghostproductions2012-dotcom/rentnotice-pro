import {
  db,
  companiesTable,
  cloudUsersTable,
  licenseKeysTable,
} from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { hashPassword, verifyPassword } from "./auth";
import { logger } from "./logger";

const LEGACY_TEST_EMAIL = "admin@admin.com";
const TEST_COMPANY_NAME = "Test Company";
const OWNER_COMPANY_NAME = "RentNotice Pro (Owner)";

/**
 * Idempotent self-heal that retires the seeded admin/admin test login and
 * ensures the real owner master-admin account exists.
 *
 * Runs on every api-server boot (and from the post-merge seed), so it is the
 * only write path that also reaches production data after a publish:
 *  1. Creates/updates the owner master-admin cloud user from the
 *     MASTER_ADMIN_EMAIL / MASTER_ADMIN_PASSWORD secrets.
 *  2. Deactivates the legacy admin@admin.com test account.
 *  3. Revokes any live Test Company license keys.
 *
 * Safe to run repeatedly: every step checks current state first and the
 * password hash is only rewritten when the password actually changed.
 */
export async function healOwnerAdminAccount(): Promise<void> {
  const email = process.env.MASTER_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.MASTER_ADMIN_PASSWORD;

  if (!email || !password) {
    logger.warn(
      "MASTER_ADMIN_EMAIL / MASTER_ADMIN_PASSWORD are not set — skipping owner admin account provisioning (legacy test-account cleanup still runs).",
    );
  } else {
    const [existing] = await db
      .select()
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.email, email));

    if (existing) {
      const passwordCurrent =
        existing.passwordHash !== null &&
        verifyPassword(password, existing.passwordHash);
      const needsUpdate =
        !passwordCurrent ||
        !existing.active ||
        existing.role !== "admin" ||
        !existing.isMasterAdmin;
      if (needsUpdate) {
        await db
          .update(cloudUsersTable)
          .set({
            passwordHash: passwordCurrent
              ? existing.passwordHash
              : hashPassword(password),
            role: "admin",
            isMasterAdmin: true,
            active: true,
            updatedAt: new Date(),
          })
          .where(eq(cloudUsersTable.id, existing.id));
        logger.info(
          { userId: existing.id },
          "Owner master-admin account updated from secrets",
        );
      }
    } else {
      // The owner account needs a company row; use a dedicated owner company
      // (never attach to a real customer).
      let [company] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.name, OWNER_COMPANY_NAME));
      if (!company) {
        [company] = await db
          .insert(companiesTable)
          .values({
            name: OWNER_COMPANY_NAME,
            contactEmail: email,
            tier: "enterprise",
          })
          .returning();
        if (!company) throw new Error("Failed to create owner company");
        logger.info({ companyId: company.id }, "Created owner company");
      }
      const [user] = await db
        .insert(cloudUsersTable)
        .values({
          companyId: company.id,
          email,
          name: "Owner",
          username: "owner",
          passwordHash: hashPassword(password),
          role: "admin",
          isMasterAdmin: true,
          active: true,
        })
        .returning();
      if (!user) throw new Error("Failed to create owner admin user");
      logger.info(
        { userId: user.id },
        "Created owner master-admin account from secrets",
      );
    }
  }

  // Retire the legacy admin/admin test login (never touch the owner account
  // itself if the owner happens to reuse that address).
  if (email !== LEGACY_TEST_EMAIL) {
    const [legacy] = await db
      .select()
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.email, LEGACY_TEST_EMAIL));
    if (legacy && legacy.active) {
      await db
        .update(cloudUsersTable)
        .set({ active: false, isMasterAdmin: false, updatedAt: new Date() })
        .where(eq(cloudUsersTable.id, legacy.id));
      logger.info(
        { userId: legacy.id },
        "Deactivated legacy admin@admin.com test account",
      );
    }
  }

  // Revoke any live Test Company license keys.
  const [testCompany] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.name, TEST_COMPANY_NAME));
  if (testCompany) {
    const revoked = await db
      .update(licenseKeysTable)
      .set({ status: "revoked", updatedAt: new Date() })
      .where(
        and(
          eq(licenseKeysTable.companyId, testCompany.id),
          ne(licenseKeysTable.status, "revoked"),
        ),
      )
      .returning();
    if (revoked.length > 0) {
      logger.info(
        { count: revoked.length },
        "Revoked live Test Company license keys",
      );
    }
  }
}
