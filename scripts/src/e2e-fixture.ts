/**
 * Shared self-provisioning e2e fixture for checks that need an activated
 * company with an admin cloud user (the old seeded admin@admin.com /
 * Test Company account was retired and its license keys revoked).
 *
 * A company without a Stripe subscription computes as license-active,
 * which is all the checks need. Everything is idempotent.
 */

import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import pg from "pg";

export interface FixtureSpec {
  companyName: string;
  email: string;
  password: string;
  userName: string;
  username: string;
  /** Optional license key to keep active for the company. */
  licenseKey?: string;
}

/** Same scrypt salt:hash format as the api-server's hashPassword helper. */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function ensureFixture(spec: FixtureSpec): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    let companyId: string;
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM companies WHERE name = $1",
      [spec.companyName],
    );
    if (existing.rowCount) {
      companyId = existing.rows[0].id;
    } else {
      companyId = randomUUID();
      await client.query(
        "INSERT INTO companies (id, name, contact_email, tier) VALUES ($1, $2, $3, 'starter')",
        [companyId, spec.companyName, spec.email],
      );
    }
    if (spec.licenseKey) {
      await client.query(
        `INSERT INTO license_keys (id, company_id, key, status) VALUES ($1, $2, $3, 'active')
         ON CONFLICT (key) DO UPDATE SET status = 'active', company_id = $2, updated_at = now()`,
        [randomUUID(), companyId, spec.licenseKey],
      );
    }
    const user = await client.query<{ id: string }>(
      "SELECT id FROM cloud_users WHERE email = $1",
      [spec.email],
    );
    if (user.rowCount) {
      await client.query(
        "UPDATE cloud_users SET company_id = $2, password_hash = $3, role = 'admin', active = true, updated_at = now() WHERE id = $1",
        [user.rows[0].id, companyId, hashPassword(spec.password)],
      );
    } else {
      await client.query(
        `INSERT INTO cloud_users (id, company_id, email, name, username, password_hash, role, active)
         VALUES ($1, $2, $3, $4, $5, $6, 'admin', true)`,
        [randomUUID(), companyId, spec.email, spec.userName, spec.username, hashPassword(spec.password)],
      );
    }
  } finally {
    await client.end();
  }
}
