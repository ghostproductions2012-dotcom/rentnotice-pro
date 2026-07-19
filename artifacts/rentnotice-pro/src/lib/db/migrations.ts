import type { AppDatabase } from "./client";
import { SCHEMA_SQL } from "./schema";
import { nowIso } from "./util";
import { PAY_OR_QUIT_BODY } from "../templates-data/ca";
import { extractMergeFields } from "../documents/merge";
import type { TemplateVersion } from "../types";

export interface Migration {
  version: number;
  name: string;
  up: (db: AppDatabase) => void;
}

/**
 * Ordered list of migrations. Each is applied exactly once (tracked in the
 * `migrations` table) and every step uses `CREATE TABLE IF NOT EXISTS`, so the
 * runner is fully idempotent.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: (db) => {
      db.exec(SCHEMA_SQL);
    },
  },
  {
    version: 2,
    name: "notice_rent_only_attestation",
    up: (db) => {
      db.exec(`
        ALTER TABLE notices ADD COLUMN rent_only_attested_by TEXT;
        ALTER TABLE notices ADD COLUMN rent_only_attested_at TEXT;
      `);
    },
  },
  {
    version: 3,
    name: "user_login_identifiers",
    up: (db) => {
      db.exec(`
        ALTER TABLE users ADD COLUMN username TEXT;
        ALTER TABLE users ADD COLUMN email TEXT;
      `);
      // Backfill a deterministic username for existing users: first initial +
      // last name, lowercased ("Alex Rivera" -> "arivera"), de-duplicated with
      // a numeric suffix.
      const rows = db.all<{ id: string; name: string }>(
        "SELECT id, name FROM users ORDER BY created_at, id",
      );
      const taken = new Set<string>();
      for (const row of rows) {
        const parts = String(row.name ?? "")
          .trim()
          .toLowerCase()
          .split(/\s+/)
          .filter(Boolean);
        const raw =
          parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1]}` : (parts[0] ?? "user");
        const base = raw.replace(/[^a-z0-9]/g, "") || "user";
        let candidate = base;
        let i = 2;
        while (taken.has(candidate)) candidate = `${base}${i++}`;
        taken.add(candidate);
        db.run("UPDATE users SET username = ? WHERE id = ?", [candidate, row.id]);
      }
    },
  },
  {
    version: 4,
    name: "workspace_activation",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS activation (
          id TEXT PRIMARY KEY CHECK (id = 'activation'),
          license_key TEXT NOT NULL,
          company_id TEXT NOT NULL,
          company_name TEXT NOT NULL,
          license_status TEXT NOT NULL,
          plan TEXT,
          activated_at TEXT NOT NULL,
          last_verified_at TEXT NOT NULL,
          grace_days INTEGER NOT NULL DEFAULT 14,
          directory_synced_at TEXT
        );
        ALTER TABLE users ADD COLUMN cloud_user_id TEXT;
      `);
      // Existing databases were auto-seeded with demo content before the
      // first-run screen existed; classify them as demo workspaces so they
      // keep working unchanged. Fresh databases stay "unset".
      const row = db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users");
      if ((row?.c ?? 0) > 0) {
        db.run("INSERT OR IGNORE INTO app_meta (key, value) VALUES ('workspace_mode', 'demo')");
      }
    },
  },
  {
    version: 5,
    name: "activation_status_reason",
    up: (db) => {
      db.exec("ALTER TABLE activation ADD COLUMN status_reason TEXT;");
    },
  },
  {
    version: 6,
    name: "property_bedrooms_and_pay_or_quit_parity_template",
    up: (db) => {
      // Fresh databases already get the column from SCHEMA_SQL (migration 1).
      const hasBedrooms = db
        .all<{ name: string }>("PRAGMA table_info(properties)")
        .some((c) => c.name === "bedrooms");
      if (!hasBedrooms) {
        db.exec("ALTER TABLE properties ADD COLUMN bedrooms INTEGER;");
      }
      // Upgrade the built-in CA 3-day pay-or-quit template to the reference
      // notice format (new version appended; older versions preserved).
      const row = db.get<{ versions: string; current_version: number }>(
        "SELECT versions, current_version FROM templates WHERE id = 'tpl-ca-3day-pay'",
      );
      if (row) {
        let versions: TemplateVersion[] = [];
        try {
          versions = JSON.parse(row.versions) as TemplateVersion[];
        } catch {
          versions = [];
        }
        const nextVersion =
          versions.reduce((max, v) => Math.max(max, v.version), 0) + 1;
        versions.push({
          version: nextVersion,
          body: PAY_OR_QUIT_BODY,
          changedBy: null,
          changedAt: nowIso(),
          changeNote:
            "Upgraded to the California reference notice format (CCP §1161(2)).",
        });
        db.run(
          "UPDATE templates SET versions = ?, current_version = ?, merge_fields = ?, updated_at = ? WHERE id = 'tpl-ca-3day-pay'",
          [
            JSON.stringify(versions),
            nextVersion,
            JSON.stringify(extractMergeFields(PAY_OR_QUIT_BODY)),
            nowIso(),
          ],
        );
      }
    },
  },
  {
    version: 7,
    name: "vendor_relabel_tenant_statement",
    up: (db) => {
      // The "first_light" vendor label referenced a specific customer's
      // property-management company; relabel it to the neutral
      // "tenant_statement" everywhere it was stored.
      db.run("UPDATE ledgers SET vendor = 'tenant_statement' WHERE vendor = 'first_light'");
      db.run(
        "UPDATE mapping_presets SET vendor = 'tenant_statement' WHERE vendor = 'first_light'",
      );
      db.run("UPDATE mapping_presets SET name = REPLACE(name, 'First Light PM — Tenant Statement', 'Tenant Statement (PDF)')");
      db.run("UPDATE mapping_presets SET name = REPLACE(name, 'First Light', 'Tenant Statement')");
      // Template version history notes stored the old wording — rewrite them.
      const templates = db.all<{ id: string; versions: string }>(
        "SELECT id, versions FROM templates WHERE versions LIKE '%First Light%'",
      );
      for (const tpl of templates) {
        try {
          const versions = JSON.parse(tpl.versions) as TemplateVersion[];
          for (const v of versions) {
            if (v.changeNote) {
              v.changeNote = v.changeNote.replace(
                /the First Light PM reference notice format/g,
                "the California reference notice format",
              );
            }
          }
          db.run("UPDATE templates SET versions = ? WHERE id = ?", [
            JSON.stringify(versions),
            tpl.id,
          ]);
        } catch {
          // Unparseable versions JSON — leave untouched.
        }
      }
    },
  },
  {
    version: 8,
    name: "buildium_integration",
    up: (db) => {
      // Fresh databases already get these columns from SCHEMA_SQL (migration 1).
      const addColumnIfMissing = (table: string, column: string, ddl: string) => {
        const exists = db
          .all<{ name: string }>(`PRAGMA table_info(${table})`)
          .some((c) => c.name === column);
        if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
      };
      addColumnIfMissing("properties", "external_source", "TEXT");
      addColumnIfMissing("properties", "external_id", "TEXT");
      addColumnIfMissing("tenants", "external_source", "TEXT");
      addColumnIfMissing("tenants", "external_id", "TEXT");
      addColumnIfMissing("settings", "buildium_client_id", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing("settings", "buildium_client_secret", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing("settings", "buildium_connected_at", "TEXT");
      addColumnIfMissing("settings", "buildium_last_sync_at", "TEXT");
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_properties_external ON properties (external_source, external_id);",
      );
      db.exec(
        "CREATE INDEX IF NOT EXISTS idx_tenants_external ON tenants (external_source, external_id);",
      );
    },
  },
  {
    version: 9,
    name: "state_rule_engine_fields",
    up: (db) => {
      const addColumnIfMissing = (table: string, column: string, ddl: string) => {
        const exists = db
          .all<{ name: string }>(`PRAGMA table_info(${table})`)
          .some((c) => c.name === column);
        if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
      };
      // Pre-filing prerequisite checklist (JSON map, e.g. {"notice_of_intent":true}).
      addColumnIfMissing("notices", "prereq_completed", "TEXT NOT NULL DEFAULT '{}'");
      // Rule card chosen for lease-sensitive states.
      addColumnIfMissing("notices", "rule_card_key", "TEXT");
      // Tenant agreed in writing to electronic service (email/text/portal).
      addColumnIfMissing("notices", "electronic_service_consent", "INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    version: 10,
    name: "state_rule_attorney_reviews",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS state_rule_reviews (
          state TEXT PRIMARY KEY,
          reviewer_name TEXT NOT NULL,
          reviewed_at TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          recorded_by TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 11,
    name: "maintenance_work_orders",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS work_orders (
          id TEXT PRIMARY KEY,
          property_id TEXT NOT NULL,
          tenant_id TEXT,
          unit TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          category TEXT NOT NULL DEFAULT 'general',
          priority TEXT NOT NULL DEFAULT 'normal',
          status TEXT NOT NULL DEFAULT 'new',
          due_date TEXT,
          assignee_name TEXT NOT NULL DEFAULT '',
          vendor_name TEXT NOT NULL DEFAULT '',
          vendor_contact TEXT NOT NULL DEFAULT '',
          cost_estimate_cents INTEGER,
          cost_actual_cents INTEGER,
          internal_notes TEXT NOT NULL DEFAULT '',
          completed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_work_orders_property ON work_orders (property_id);
        CREATE INDEX IF NOT EXISTS idx_work_orders_tenant ON work_orders (tenant_id);
        CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders (status);

        CREATE TABLE IF NOT EXISTS work_order_status_history (
          id TEXT PRIMARY KEY,
          work_order_id TEXT NOT NULL,
          from_status TEXT,
          to_status TEXT NOT NULL,
          changed_by TEXT,
          changed_by_name TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          changed_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wo_status_history_wo ON work_order_status_history (work_order_id);
      `);
    },
  },
  {
    version: 12,
    name: "user_chat_token",
    up: (db) => {
      // Per-member token proving chat identity to the communications hub.
      db.exec("ALTER TABLE users ADD COLUMN chat_token TEXT;");
    },
  },
  {
    version: 13,
    name: "attorney_referrals",
    up: (db) => {
      // Fresh databases already get these columns from SCHEMA_SQL (migration 1).
      const addColumnIfMissing = (table: string, column: string, ddl: string) => {
        const exists = db
          .all<{ name: string }>(`PRAGMA table_info(${table})`)
          .some((c) => c.name === column);
        if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
      };
      // Court date recorded by the referred attorney (synced from the relay).
      addColumnIfMissing("notices", "court_date", "TEXT");
      addColumnIfMissing("notices", "court_case_number", "TEXT NOT NULL DEFAULT ''");
      addColumnIfMissing("notices", "court_notes", "TEXT NOT NULL DEFAULT ''");
      // Attorney uploads can be images, not just PDFs.
      addColumnIfMissing(
        "documents",
        "mime_type",
        "TEXT NOT NULL DEFAULT 'application/pdf'",
      );
      db.exec(`
        CREATE TABLE IF NOT EXISTS attorney_referral_links (
          referral_id TEXT PRIMARY KEY,
          notice_id TEXT NOT NULL,
          link TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_attorney_links_notice ON attorney_referral_links (notice_id);
      `);
    },
  },
  {
    version: 14,
    name: "attorney_contacts",
    up: (db) => {
      // Saved attorney address book for the secure-link send dialog.
      db.exec(`
        CREATE TABLE IF NOT EXISTS attorney_contacts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    version: 15,
    name: "local_overlay_verification",
    up: (db) => {
      // Fresh databases already get these columns from SCHEMA_SQL (migration 1).
      const addColumnIfMissing = (table: string, column: string, ddl: string) => {
        const exists = db
          .all<{ name: string }>(`PRAGMA table_info(${table})`)
          .some((c) => c.name === column);
        if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl};`);
      };
      // Per-notice confirmation that local ordinances were verified for the
      // property's matched overlay jurisdiction(s).
      addColumnIfMissing("notices", "local_overlay_verified_by", "TEXT");
      addColumnIfMissing("notices", "local_overlay_verified_at", "TEXT");
    },
  },
];

function ensureMigrationsTable(db: AppDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

/** Runs every not-yet-applied migration in order, inside a transaction each. */
export function runMigrations(db: AppDatabase): void {
  ensureMigrationsTable(db);
  const applied = new Set(
    db.all<{ version: number }>("SELECT version FROM migrations").map((r) => r.version),
  );
  const ordered = [...MIGRATIONS].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    db.transaction(() => {
      migration.up(db);
      db.run("INSERT OR REPLACE INTO migrations (version, name, applied_at) VALUES (?, ?, ?)", [
        migration.version,
        migration.name,
        nowIso(),
      ]);
    });
  }
}

/** Current schema version = highest applied migration (0 if none). */
export function currentSchemaVersion(db: AppDatabase): number {
  const row = db.get<{ v: number | null }>("SELECT MAX(version) AS v FROM migrations");
  return row?.v ?? 0;
}
