/**
 * Provision the secure owner master-admin account (and retire the legacy
 * admin/admin test login) in the development database.
 *
 * Delegates to the same idempotent self-heal the api-server runs on boot:
 *  - creates/updates the owner master-admin cloud user from the
 *    MASTER_ADMIN_EMAIL / MASTER_ADMIN_PASSWORD secrets,
 *  - deactivates admin@admin.com,
 *  - revokes any live "Test Company" license keys.
 *
 * Skips owner provisioning with a clear log line if the secrets are unset.
 *
 * Run with: node scripts/seed-admin.ts   (Node >= 22.18 type stripping)
 * Uses DATABASE_URL from the environment.
 */
import { pool } from "@workspace/db";
import { healOwnerAdminAccount } from "../src/lib/ownerAdmin.ts";

async function main(): Promise<void> {
  await healOwnerAdminAccount();
  console.log("Owner admin self-heal complete.");
  await pool.end();
}

main().catch((err) => {
  console.error("Owner admin seed failed:", err);
  process.exit(1);
});
