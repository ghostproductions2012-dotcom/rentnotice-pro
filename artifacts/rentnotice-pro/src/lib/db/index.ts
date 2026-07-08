// ---------------------------------------------------------------------------
// Public API barrel for the local persistence layer.
//
//   const db = await initDatabase();   // open + migrate + seed + persist
//
// Everything the service layer needs (repositories, backup, helpers) is
// re-exported from here.
// ---------------------------------------------------------------------------

import type { AppDatabase } from "./client";
import { openDatabase } from "./client";
import { runMigrations } from "./migrations";

/**
 * Open (or create) the local SQLite database, apply pending migrations, and
 * persist the result to IndexedDB.
 *
 * NOTE: demo data is intentionally NOT seeded here. A fresh database boots
 * "unset" and the first-run screen decides between demo seeding
 * (services.enterDemoMode) and license activation (services.activateWorkspace).
 */
export async function initDatabase(): Promise<AppDatabase> {
  const db = await openDatabase();
  runMigrations(db);
  await db.flush();
  return db;
}

export type { AppDatabase } from "./client";
export { openDatabase, clearPersistedDatabase, loadSqlJs } from "./client";
export { runMigrations, currentSchemaVersion, MIGRATIONS } from "./migrations";
export { seedDatabase, seedReferenceData } from "./seed";
export { exportBackup, importBackup, tableCounts } from "./backup";
export * from "./util";
export * from "./repositories";
