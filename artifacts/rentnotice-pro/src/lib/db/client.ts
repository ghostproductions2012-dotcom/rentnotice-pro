import initSqlJs from "sql.js";
import type { BindParams, Database as SqlJsDatabase, SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { get as idbGet, set as idbSet, del as idbDel } from "idb-keyval";
import type { Row, SqlRunner } from "./util";

const IDB_KEY = "rentnotice-pro:sqlite";
/**
 * Monotonic save-generation counter stored alongside the blob. Every window
 * remembers the generation it loaded; a stored generation newer than the
 * loaded one means another window saved since — writing would clobber it.
 */
const IDB_GEN_KEY = "rentnotice-pro:sqlite-gen";
const SAVE_DEBOUNCE_MS = 400;
const CHANNEL_NAME = "rentnotice-pro:db";
const WRITE_LOCK_NAME = "rentnotice-pro:db-write";

/**
 * Dispatched on `window` after this window adopted a database state saved by
 * another window. The app layer should re-fetch everything it has cached.
 */
export const DB_EXTERNAL_CHANGE_EVENT = "rentnotice-pro:db-external-change";

export interface DbExternalChangeDetail {
  /**
   * True when this window had unsaved local changes that were discarded in
   * favor of the other window's newer state (near-simultaneous writes within
   * the debounce window). Rare; worth surfacing to the user.
   */
  droppedPendingWrite: boolean;
}

type DbChannelMessage = { type: "db-updated"; gen: number };

/**
 * Serializes blob+generation reads/writes across windows via the Web Locks
 * API. Falls back to unserialized execution where locks are unavailable
 * (Node tests, very old runtimes) — matching today's single-window behavior.
 */
async function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks =
    typeof navigator !== "undefined"
      ? (navigator as { locks?: LockManager }).locks
      : undefined;
  if (locks?.request) {
    return locks.request(WRITE_LOCK_NAME, fn) as Promise<T>;
  }
  return fn();
}

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
  /** Save generation this window's in-memory database is based on. */
  private loadedGen: number;
  private channel: BroadcastChannel | null = null;
  private closed = false;

  /** Flush pending writes when the window loses focus or is closing, so the
   *  400ms debounce window can't swallow the last edit before a switch to
   *  another window (or a quit). */
  private readonly flushOnHide = (): void => {
    if (this.saveTimer) void this.flush();
  };

  private readonly onChannelMessage = (event: MessageEvent): void => {
    const data = event.data as Partial<DbChannelMessage> | null;
    if (!data || data.type !== "db-updated" || typeof data.gen !== "number") return;
    if (data.gen <= this.loadedGen) return;
    void withWriteLock(async () => {
      if (this.closed) return;
      const storedGen = (await idbGet<number>(IDB_GEN_KEY)) ?? 0;
      if (storedGen <= this.loadedGen) return; // already caught up
      await this.adoptStoredDatabase(storedGen, this.saveTimer !== null);
    }).catch((err) => {
      console.error("[rentnotice-pro] Failed to adopt database from another window", err);
    });
  };

  constructor(ctor: SqlDatabaseCtor, db: SqlJsDatabase, loadedGen: number) {
    this.ctor = ctor;
    this.sql = db;
    this.loadedGen = loadedGen;
    // Cross-window coordination only exists in real browser windows; Node
    // test runs (no `window`) keep the original single-instance behavior.
    if (typeof window !== "undefined") {
      if (typeof BroadcastChannel !== "undefined") {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.addEventListener("message", this.onChannelMessage);
      }
      window.addEventListener("blur", this.flushOnHide);
      window.addEventListener("pagehide", this.flushOnHide);
    }
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
      await withWriteLock(async () => {
        if (this.closed) return;
        const storedGen = (await idbGet<number>(IDB_GEN_KEY)) ?? 0;
        if (storedGen > this.loadedGen) {
          // Another window saved a newer database since this one loaded its
          // state. Writing now would silently destroy that window's data —
          // drop this write and adopt the newer state instead.
          await this.adoptStoredDatabase(storedGen, true);
          return;
        }
        const nextGen = storedGen + 1;
        await idbSet(IDB_KEY, this.sql.export());
        await idbSet(IDB_GEN_KEY, nextGen);
        this.loadedGen = nextGen;
        this.channel?.postMessage({ type: "db-updated", gen: nextGen } satisfies DbChannelMessage);
      });
    } catch (err) {
      console.error("[rentnotice-pro] Failed to persist database", err);
    }
  }

  /**
   * Replaces the in-memory database with the persisted snapshot saved by
   * another window. Deliberately does NOT schedule a save: re-persisting an
   * adopted snapshot would bump the generation and ping-pong reloads across
   * windows forever. Callers must hold the write lock.
   */
  private async adoptStoredDatabase(storedGen: number, droppedPendingWrite: boolean): Promise<void> {
    const bytes = await idbGet<Uint8Array>(IDB_KEY);
    if (!bytes) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.sql.close();
    this.sql = new this.ctor(bytes);
    this.loadedGen = storedGen;
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent<DbExternalChangeDetail>(DB_EXTERNAL_CHANGE_EVENT, {
          detail: { droppedPendingWrite },
        }),
      );
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
    this.closed = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.channel) {
      this.channel.removeEventListener("message", this.onChannelMessage);
      this.channel.close();
      this.channel = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("blur", this.flushOnHide);
      window.removeEventListener("pagehide", this.flushOnHide);
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
  await idbDel(IDB_GEN_KEY);
}

/**
 * Opens the database handle: restores the saved bytes from IndexedDB when present,
 * otherwise creates a fresh in-memory SQLite database (first-run).
 */
export async function openDatabase(): Promise<AppDatabase> {
  const SQL = await loadSqlJs();
  // Read blob + generation under the same write lock used by persist(): if
  // another window saves between the two reads, we could otherwise boot with
  // an OLD blob paired with the NEW generation, and our next persist would
  // silently clobber that window's save.
  const { saved, gen } = await withWriteLock(async () => {
    const [saved, gen] = await Promise.all([
      idbGet<Uint8Array>(IDB_KEY),
      idbGet<number>(IDB_GEN_KEY),
    ]);
    return { saved, gen };
  });
  const db = saved ? new SQL.Database(saved) : new SQL.Database();
  return new AppDatabaseImpl(SQL.Database, db, gen ?? 0);
}
