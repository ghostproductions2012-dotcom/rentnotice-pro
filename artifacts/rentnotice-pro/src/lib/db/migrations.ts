import type { AppDatabase } from "./client";
import { SCHEMA_SQL } from "./schema";
import { nowIso } from "./util";

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
