// Exploratory: build databases exactly as each prior app version would have
// (old schema + old migrations + old seed code extracted from git), then run
// the CURRENT migration path against those bytes and exercise the repos.
import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import type { BindParams, Database as SqlJsDatabase } from "sql.js";
import { createRequire } from "node:module";
import { MIGRATIONS, runMigrations, currentSchemaVersion } from "./migrations";
import type { AppDatabase } from "./client";
import * as repos from "./repositories";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");

type Row = Record<string, unknown>;

class TestDb implements AppDatabase {
  sql: SqlJsDatabase;
  constructor(db: SqlJsDatabase) {
    this.sql = db;
  }
  all<T = Row>(sql: string, params?: BindParams): T[] {
    const stmt = this.sql.prepare(sql);
    try {
      if (params != null) stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }
  get<T = Row>(sql: string, params?: BindParams): T | null {
    return this.all<T>(sql, params)[0] ?? null;
  }
  run(sql: string, params?: BindParams): void {
    this.sql.run(sql, params);
  }
  exec(sql: string): void {
    this.sql.exec(sql);
  }
  transaction<T>(fn: () => T): T {
    this.sql.exec("BEGIN");
    try {
      const result = fn();
      this.sql.exec("COMMIT");
      return result;
    } catch (err) {
      try {
        this.sql.exec("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    }
  }
  scheduleSave(): void {}
  async flush(): Promise<void> {}
  export(): Uint8Array {
    return this.sql.export();
  }
  loadBytes(): void {
    throw new Error("not needed");
  }
  close(): void {
    this.sql.close();
  }
}

async function newDb(bytes?: Uint8Array): Promise<TestDb> {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  return new TestDb(bytes ? new SQL.Database(bytes) : new SQL.Database());
}

const COMMITS = [
  { commit: "3f6c26f", hasActivation: false },
  { commit: "3eb7c27", hasActivation: false },
  { commit: "171ed7c", hasActivation: false },
  { commit: "d4a3a94", hasActivation: true },
  { commit: "7675ceb", hasActivation: true },
  { commit: "3e9df91", hasActivation: true },
];

function oldLib(commit: string, mod: string) {
  return import(
    /* @vite-ignore */ `/tmp/oldvers/${commit}/artifacts/rentnotice-pro/src/lib/db/${mod}.ts`
  );
}

async function buildOldDemoDb(commit: string): Promise<Uint8Array> {
  const oldMigrations = await oldLib(commit, "migrations");
  const oldSeed = await oldLib(commit, "seed");
  const db = await newDb();
  oldMigrations.runMigrations(db);
  await oldSeed.seedDatabase(db);
  // demo mode marker exists only from d4a3a94 on; older versions had no
  // workspace_mode at all (implicit demo).
  try {
    db.run(
      "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('workspace_mode', 'demo')",
    );
  } catch {
    /* app_meta always exists, mode key semantics arrived later; ignore */
  }
  const bytes = db.export();
  db.close();
  return bytes;
}

async function buildOldActivatedDb(commit: string): Promise<Uint8Array> {
  const oldMigrations = await oldLib(commit, "migrations");
  const oldSeed = await oldLib(commit, "seed");
  const oldRepos = await oldLib(commit, "repositories");
  const db = await newDb();
  oldMigrations.runMigrations(db);
  oldSeed.seedReferenceData(db);
  oldRepos.setWorkspaceMode(db, "activated");
  oldRepos.activationRepo.set(db, {
    licenseKey: "RNP-TEST-KEY-1234",
    companyId: "co_1",
    companyName: "Golden Gate PM",
    licenseStatus: "active",
    statusReason: null,
    plan: "team",
    activatedAt: "2026-05-01T10:00:00.000Z",
    lastVerifiedAt: "2026-07-01T10:00:00.000Z",
    graceDays: 14,
    directorySyncedAt: "2026-07-01T10:00:00.000Z",
  });
  oldRepos.usersRepo.create(db, {
    id: "user-cloud-1",
    name: "Jordan Chen",
    initials: "JC",
    username: "jchen",
    email: "jchen@company.com",
    role: "admin",
    pin: "a".repeat(64),
    active: true,
    createdAt: "2026-05-01T10:00:00.000Z",
    cloudUserId: "cu_1",
  });
  const bytes = db.export();
  db.close();
  return bytes;
}

async function upgradeAndExercise(bytes: Uint8Array) {
  const db = await newDb(bytes);
  runMigrations(db);
  // Exercise the same reads the app shell + pages depend on.
  const mode = repos.getWorkspaceMode(db);
  const activation = repos.activationRepo.get(db);
  const users = repos.usersRepo.list(db);
  const notices = repos.noticesRepo.list(db);
  const properties = repos.propertiesRepo.list(db);
  const tenants = repos.tenantsRepo.list(db);
  const templates = repos.templatesRepo.list(db);
  const settings = repos.settingsRepo.get(db);
  const version = currentSchemaVersion(db);
  db.close();
  return { mode, activation, users, notices, properties, tenants, templates, settings, version };
}

describe("upgrade from each historical schema version", () => {
  for (const { commit, hasActivation } of COMMITS) {
    it(`demo workspace saved at ${commit} upgrades cleanly`, async () => {
      const bytes = await buildOldDemoDb(commit);
      const out = await upgradeAndExercise(bytes);
      expect(out.version).toBe(MIGRATIONS.length);
      expect(out.users.length).toBeGreaterThan(0);
    });
    if (hasActivation) {
      it(`activated workspace saved at ${commit} upgrades cleanly`, async () => {
        const bytes = await buildOldActivatedDb(commit);
        const out = await upgradeAndExercise(bytes);
        expect(out.version).toBe(MIGRATIONS.length);
        expect(out.mode).toBe("activated");
        expect(out.users.length).toBeGreaterThan(0);
      });
    }
  }
});
