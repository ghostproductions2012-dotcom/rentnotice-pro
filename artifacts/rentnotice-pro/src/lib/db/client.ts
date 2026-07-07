import initSqlJs from "sql.js";
import type { BindParams, Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import type { Row, SqlRunner } from "./util";

const IDB_KEY = "rentnotice-pro:sqlite";
const SAVE_DEBOUNCE_MS = 400;

type SqlDatabaseCtor = SqlJsStatic["Database"];

/**
 * The public database handle used by every repository. Wraps a sql.js
 * Database instance and layers debounced IndexedDB persistence on top.
 */
export interface AppDatabase extends SqlRunner {
  readonly sql: SqlJsDatabase;
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
  scheduleSave(): void;
  flush(): Promise<void>;
  export(): Uint8Array;
  loadBytes(bytes: Uint8Array): void;
  close(): void;
}

class AppDatabaseImpl implements AppDatabase {
  sql: SqlJsDatabase;
  private readonly ctor: SqlDatabaseCtor;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctor: SqlDatabaseCtor, db: SqlJsDatabase) {
    this.ctor = ctor;
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
    this.scheduleSave();
  }

  exec(sql: string): void {
    this.sql.exec(sql);
    this.scheduleSave();
  }

  transaction<T>(fn: () => T): T {
    this.sql.exec("BEGIN");
    try {
      const result = fn();
      this.sql.exec("COMMIT");
      this.scheduleSave();
      return result;
    } catch (err) {
      try {
        this.sql.exec("ROLLBACK");
      } catch {
        /* ignore rollback errors */
      }
      throw err;
    }
  }

  scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist();
    }, SAVE_DEBOUNCE_MS);
  }

  private async persist(): Promise<void> {
    try {
      await idbSet(IDB_KEY, this.sql.export());
    } catch (err) {
      console.error("[rentnotice-pro] Failed to persist database", err);
    }
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist();
  }

  export(): Uint8Array {
    return this.sql.export();
  }

  loadBytes(bytes: Uint8Array): void {
    this.sql.close();
    this.sql = new this.ctor(bytes);
    this.scheduleSave();
  }

  close(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.sql.close();
  }
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

/** Loads (and memoizes) the sql.js WASM runtime, fully offline via Vite asset URL. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = initSqlJs({ locateFile: () => wasmUrl });
  }
  return sqlJsPromise;
}

/** Removes the persisted database from IndexedDB (used by tests / hard reset). */
export async function clearPersistedDatabase(): Promise<void> {
  await idbDel(IDB_KEY);
}

/**
 * Opens the database handle: restores the saved bytes from IndexedDB when present,
 * otherwise creates a fresh in-memory SQLite database (first-run).
 */
export async function openDatabase(): Promise<AppDatabase> {
  const SQL = await loadSqlJs();
  const saved = await idbGet<Uint8Array>(IDB_KEY);
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  return new AppDatabaseImpl(SQL.Database, db);
}
