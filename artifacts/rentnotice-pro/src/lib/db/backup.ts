// ---------------------------------------------------------------------------
// Backup export / restore.
//
// Backup file format: a single JSON document containing metadata plus the
// full SQLite database image encoded as base64. Restoring loads the bytes
// into the live sql.js instance, re-runs migrations (in case the backup was
// produced by an older schema) and persists to IndexedDB.
// ---------------------------------------------------------------------------

import type { BackupMeta } from "../types";
import type { AppDatabase } from "./client";
import { runMigrations } from "./migrations";
import { base64ToBytes, bytesToBase64, nowIso, asStr, asNum } from "./util";

const BACKUP_FORMAT = "rentnotice-pro-backup";
const BACKUP_FORMAT_VERSION = 1;
const APP_VERSION = "1.0.0";

interface BackupFileShape {
  format: string;
  formatVersion: number;
  meta: BackupMeta;
  sqliteBase64: string;
}

/** Count rows per user table (via sqlite_master, so it never drifts from the schema). */
export function tableCounts(db: AppDatabase): Record<string, number> {
  const counts: Record<string, number> = {};
  const tables = db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'migrations' ORDER BY name",
  );
  for (const t of tables) {
    const name = asStr(t.name);
    if (!name) continue;
    const row = db.get(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`);
    counts[name] = row ? asNum(row.n) : 0;
  }
  return counts;
}

/** Serialize the entire database into a downloadable backup Blob. */
export async function exportBackup(
  db: AppDatabase,
): Promise<{ blob: Blob; meta: BackupMeta; fileName: string }> {
  await db.flush();
  const meta: BackupMeta = {
    exportedAt: nowIso(),
    appVersion: APP_VERSION,
    counts: tableCounts(db),
  };
  const payload: BackupFileShape = {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    meta,
    sqliteBase64: bytesToBase64(db.export()),
  };
  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const stamp = meta.exportedAt.slice(0, 19).replace(/[:T]/g, "-");
  return { blob, meta, fileName: `rentnotice-pro-backup-${stamp}.json` };
}

/**
 * Restore a backup file into the live database (replaces ALL current data),
 * re-runs migrations and persists the restored image.
 */
export async function importBackup(db: AppDatabase, file: File | Blob): Promise<BackupMeta> {
  const text = await file.text();
  let parsed: BackupFileShape;
  try {
    parsed = JSON.parse(text) as BackupFileShape;
  } catch {
    throw new Error("Not a valid backup file (could not parse JSON).");
  }
  if (parsed?.format !== BACKUP_FORMAT || typeof parsed.sqliteBase64 !== "string") {
    throw new Error("Not a valid RentNotice Pro backup file.");
  }
  const bytes = base64ToBytes(parsed.sqliteBase64);
  db.loadBytes(bytes);
  runMigrations(db);
  await db.flush();
  return (
    parsed.meta ?? { exportedAt: nowIso(), appVersion: "unknown", counts: tableCounts(db) }
  );
}
