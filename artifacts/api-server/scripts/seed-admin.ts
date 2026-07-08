/**
 * Seed an admin/admin test account for owner testing.
 *
 * Creates (or updates) a dedicated "Test Company" and the cloud user
 * admin@admin.com with password "admin", role admin, master admin, active,
 * and desktop username "admin". Idempotent: keyed on the user email and
 * the test company name; re-running updates in place.
 *
 * Run with: node scripts/seed-admin.ts   (Node >= 22.18 type stripping)
 * Uses DATABASE_URL from the environment.
 */
import {
  db,
  pool,
  companiesTable,
  cloudUsersTable,
  licenseKeysTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "../src/lib/auth.ts";
import { generateLicenseKey } from "../src/lib/license.ts";

const TEST_COMPANY_NAME = "Test Company";
const ADMIN_EMAIL = "admin@admin.com";
const ADMIN_PASSWORD = "admin";

async function main(): Promise<void> {
  // 1. Upsert the dedicated test company (never attach to a real customer).
  let [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.name, TEST_COMPANY_NAME));

  if (company) {
    console.log(`Test company exists: ${company.id}`);
    if (company.tier !== "enterprise") {
      [company] = await db
        .update(companiesTable)
        .set({ tier: "enterprise", updatedAt: new Date() })
        .where(eq(companiesTable.id, company.id))
        .returning();
      console.log("Updated test company tier to enterprise");
    }
  } else {
    [company] = await db
      .insert(companiesTable)
      .values({
        name: TEST_COMPANY_NAME,
        contactEmail: ADMIN_EMAIL,
        tier: "enterprise",
      })
      .returning();
    console.log(`Created test company: ${company.id}`);
  }

  // 2. Upsert the admin cloud user keyed on email.
  const passwordHash = hashPassword(ADMIN_PASSWORD);
  const [existing] = await db
    .select()
    .from(cloudUsersTable)
    .where(eq(cloudUsersTable.email, ADMIN_EMAIL));

  if (existing) {
    if (existing.companyId !== company.id) {
      throw new Error(
        `Refusing to update: ${ADMIN_EMAIL} belongs to company ${existing.companyId}, not the test company. Delete it manually first.`,
      );
    }
    await db
      .update(cloudUsersTable)
      .set({
        name: "Test Admin",
        username: "admin",
        passwordHash,
        role: "admin",
        isMasterAdmin: true,
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(cloudUsersTable.id, existing.id));
    console.log(`Updated existing test admin user: ${existing.id}`);
  } else {
    const [user] = await db
      .insert(cloudUsersTable)
      .values({
        companyId: company.id,
        email: ADMIN_EMAIL,
        name: "Test Admin",
        username: "admin",
        passwordHash,
        role: "admin",
        isMasterAdmin: true,
        active: true,
      })
      .returning();
    console.log(`Created test admin user: ${user.id}`);
  }

  // 3. Ensure the test company has a license key. Never rotate an existing
  // key or touch its device activation: an already-activated desktop install
  // must keep working across re-runs.
  const [existingKey] = await db
    .select()
    .from(licenseKeysTable)
    .where(eq(licenseKeysTable.companyId, company.id));

  if (existingKey) {
    console.log(
      `License key exists (kept, not rotated): ${existingKey.key} [status: ${existingKey.status}]`,
    );
  } else {
    const [created] = await db
      .insert(licenseKeysTable)
      .values({
        companyId: company.id,
        key: generateLicenseKey(),
        status: "active",
      })
      .returning();
    console.log(`Created license key: ${created.key} [status: active]`);
  }

  console.log(
    `Done. Portal login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}; desktop username: admin`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
