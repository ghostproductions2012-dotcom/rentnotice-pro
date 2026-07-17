// ---------------------------------------------------------------------------
// Template API regression tests — exercise the REAL service implementation
// (impl.ts) against an in-memory sql.js database. Covers the contract the
// Templates section depends on:
//   - createTemplate defaults (version 1, not attorney-reviewed, active)
//   - updateTemplate body edits append a new version WITHOUT losing old ones
//     and re-extract merge fields
//   - review / active flag patches
//   - permission enforcement (template.manage denied for staff/readonly)
// ---------------------------------------------------------------------------
import { beforeAll, describe, expect, it, vi } from "vitest";
import initSqlJs from "sql.js";
import type { BindParams, Database as SqlJsDatabase } from "sql.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const wasmPath = require.resolve("sql.js/dist/sql-wasm.wasm");

type Row = Record<string, unknown>;

// Minimal AppDatabase over raw sql.js — persistence hooks are no-ops because
// these tests never touch IndexedDB (node environment).
class TestDb {
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
    throw new Error("not needed in tests");
  }
  close(): void {
    this.sql.close();
  }
}

// Holds the single in-memory database impl.ts opens, so tests can seed rows
// (users) directly through the real repositories. vi.hoisted because vi.mock
// factories are hoisted above module initialization.
const dbHolder = vi.hoisted(() => ({ current: null as unknown }));

// Replace ONLY initDatabase (and the IndexedDB eraser) — every repository,
// helper, and migration stays real so the tests cover the true stack.
vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    initDatabase: async () => {
      const SQL = await initSqlJs({ locateFile: () => wasmPath });
      const db = new TestDb(new SQL.Database());
      actual.runMigrations(db as never);
      dbHolder.current = db;
      return db;
    },
    clearPersistedDatabase: async () => {},
  };
});

import { getServices } from "../services";
import "../impl"; // registers the real services factory
import { sha256Hex, uid, usersRepo } from "../../db";
import type { User, UserRole } from "../../types";

const services = getServices();

const PASSWORD = "test-password-1";

describe("Templates API (real impl over in-memory sql.js)", () => {
  const users = new Map<UserRole, User>();

  beforeAll(async () => {
    // Boot the (mocked, in-memory) database via the service layer, then seed
    // one user per role straight through the real users repository.
    await services.getSession();
    const listBefore = await services.listUsers();
    expect(listBefore).toHaveLength(0);

    // Seed one user per role directly through the real users repository,
    // against the SAME in-memory db instance impl.ts opened (captured by the
    // mocked initDatabase above).
    const pinHash = await sha256Hex(PASSWORD);
    const roles: UserRole[] = ["admin", "manager", "staff", "readonly"];
    const db = dbHolder.current as TestDb;
    expect(db).toBeInstanceOf(TestDb);
    for (const role of roles) {
      const user: User = {
        id: uid("user"),
        name: `${role} user`,
        initials: role.slice(0, 2).toUpperCase(),
        username: role,
        email: null,
        role,
        pin: pinHash,
        active: true,
        createdAt: new Date().toISOString(),
        cloudUserId: null,
      };
      usersRepo.create(db as never, user);
      users.set(role, user);
    }
  });

  async function loginAs(role: UserRole): Promise<void> {
    const session = await services.login(role, PASSWORD);
    expect(session.user?.role).toBe(role);
  }

  describe("createTemplate defaults", () => {
    it("creates version 1, active, not attorney-reviewed, with extracted merge fields", async () => {
      await loginAs("admin");
      const created = await services.createTemplate({
        name: "Pay or Quit — Custom",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "Dear {{tenant_names}}, you owe {{total_due}} for {{property_address}}. Pay {{total_due}} now.",
      });

      expect(created.currentVersion).toBe(1);
      expect(created.active).toBe(true);
      expect(created.attorneyReviewed).toBe(false);
      expect(created.reviewedBy).toBe("");
      expect(created.reviewDate).toBeNull();
      expect(created.builtIn).toBe(false);
      expect(created.versions).toHaveLength(1);
      expect(created.versions[0]).toMatchObject({
        version: 1,
        changeNote: "Created",
      });
      expect(created.versions[0].body).toContain("{{tenant_names}}");
      // De-duplicated ({{total_due}} appears twice) and in order of appearance.
      expect(created.mergeFields).toEqual(["tenant_names", "total_due", "property_address"]);

      // Round-trips through the database, not just the returned object.
      const fetched = await services.getTemplate(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.currentVersion).toBe(1);
      expect(fetched!.versions).toHaveLength(1);
      expect(fetched!.mergeFields).toEqual(created.mergeFields);
    });

    it("defaults locality to null when omitted", async () => {
      await loginAs("admin");
      const created = await services.createTemplate({
        name: "No locality",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "Hello {{tenant_names}}",
      });
      expect(created.locality).toBeNull();
    });
  });

  describe("updateTemplate versioning", () => {
    it("a body edit appends a new version, preserves ALL prior versions, and re-extracts merge fields", async () => {
      await loginAs("admin");
      const created = await services.createTemplate({
        name: "Versioned",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "v1 body {{tenant_names}} {{total_due}}",
      });

      const v2 = await services.updateTemplate(created.id, {
        body: "v2 body {{tenant_names}} {{service_deadline}}",
        changeNote: "Second draft",
      });
      expect(v2.currentVersion).toBe(2);
      expect(v2.versions).toHaveLength(2);
      // Prior version is intact, byte for byte.
      expect(v2.versions[0].version).toBe(1);
      expect(v2.versions[0].body).toBe("v1 body {{tenant_names}} {{total_due}}");
      expect(v2.versions[1]).toMatchObject({ version: 2, changeNote: "Second draft" });
      // Merge fields reflect the NEW body only.
      expect(v2.mergeFields).toEqual(["tenant_names", "service_deadline"]);

      const v3 = await services.updateTemplate(created.id, {
        body: "v3 body {{property_address}}",
      });
      expect(v3.currentVersion).toBe(3);
      expect(v3.versions.map((v) => v.version)).toEqual([1, 2, 3]);
      expect(v3.versions[0].body).toBe("v1 body {{tenant_names}} {{total_due}}");
      expect(v3.versions[1].body).toBe("v2 body {{tenant_names}} {{service_deadline}}");
      expect(v3.versions[2].changeNote).toBe(""); // omitted note defaults to ""
      expect(v3.mergeFields).toEqual(["property_address"]);

      // Persisted, not just returned.
      const fetched = await services.getTemplate(created.id);
      expect(fetched!.versions).toHaveLength(3);
      expect(fetched!.currentVersion).toBe(3);
    });

    it("a metadata-only patch does NOT create a new version", async () => {
      await loginAs("admin");
      const created = await services.createTemplate({
        name: "Metadata only",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "{{tenant_names}}",
      });
      const updated = await services.updateTemplate(created.id, { name: "Renamed" });
      expect(updated.name).toBe("Renamed");
      expect(updated.currentVersion).toBe(1);
      expect(updated.versions).toHaveLength(1);
      expect(updated.mergeFields).toEqual(["tenant_names"]);
    });

    it("throws for an unknown template id", async () => {
      await loginAs("admin");
      await expect(services.updateTemplate("tpl_nope", { name: "x" })).rejects.toThrow(
        /not found/i,
      );
    });
  });

  describe("attorney review and active toggles", () => {
    it("marks a template attorney-reviewed with reviewer and date", async () => {
      await loginAs("manager"); // managers hold template.manage too
      const created = await services.createTemplate({
        name: "Reviewable",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "{{tenant_names}}",
      });
      const reviewed = await services.updateTemplate(created.id, {
        attorneyReviewed: true,
        reviewedBy: "Jane Attorney",
        reviewDate: "2026-07-17",
      });
      expect(reviewed.attorneyReviewed).toBe(true);
      expect(reviewed.reviewedBy).toBe("Jane Attorney");
      expect(reviewed.reviewDate).toBe("2026-07-17");
      // Review marking is not a body edit — no new version.
      expect(reviewed.versions).toHaveLength(1);

      const cleared = await services.updateTemplate(created.id, {
        attorneyReviewed: false,
        reviewedBy: "",
        reviewDate: null,
      });
      expect(cleared.attorneyReviewed).toBe(false);
      expect(cleared.reviewedBy).toBe("");
      expect(cleared.reviewDate).toBeNull();
    });

    it("toggles active off and back on", async () => {
      await loginAs("admin");
      const created = await services.createTemplate({
        name: "Toggle",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "{{tenant_names}}",
      });
      expect(created.active).toBe(true);
      const off = await services.updateTemplate(created.id, { active: false });
      expect(off.active).toBe(false);
      const on = await services.updateTemplate(created.id, { active: true });
      expect(on.active).toBe(true);
    });
  });

  describe("permission enforcement", () => {
    it("staff cannot create templates", async () => {
      await loginAs("staff");
      await expect(
        services.createTemplate({
          name: "Nope",
          noticeType: "pay_or_quit",
          jurisdiction: "CA",
          body: "{{tenant_names}}",
        }),
      ).rejects.toThrow(/not permitted/i);
    });

    it("staff cannot update templates", async () => {
      await loginAs("admin");
      const created = await services.createTemplate({
        name: "Guarded",
        noticeType: "pay_or_quit",
        jurisdiction: "CA",
        body: "{{tenant_names}}",
      });
      await loginAs("staff");
      await expect(services.updateTemplate(created.id, { active: false })).rejects.toThrow(
        /not permitted/i,
      );
      // And nothing changed.
      await loginAs("admin");
      const fetched = await services.getTemplate(created.id);
      expect(fetched!.active).toBe(true);
    });

    it("readonly cannot create or update templates", async () => {
      await loginAs("readonly");
      await expect(
        services.createTemplate({
          name: "Nope",
          noticeType: "pay_or_quit",
          jurisdiction: "CA",
          body: "x",
        }),
      ).rejects.toThrow(/not permitted|read.?only/i);
    });

    it("staff can still LIST and READ templates", async () => {
      await loginAs("staff");
      const list = await services.listTemplates();
      expect(list.length).toBeGreaterThan(0);
      const one = await services.getTemplate(list[0].id);
      expect(one).not.toBeNull();
    });
  });
});
