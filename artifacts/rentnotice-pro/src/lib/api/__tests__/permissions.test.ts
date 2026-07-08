import { describe, expect, it } from "vitest";
import type { UserRole } from "../../types";
import {
  ALL_PERMISSIONS,
  type Permission,
  PermissionError,
  ROLE_PERMISSIONS,
  can,
  checkPermission,
} from "../permissions";

const ROLES: UserRole[] = ["admin", "manager", "staff", "readonly"];

// The behavioural contract each role is expected to satisfy. Kept explicit
// (rather than derived from the matrix) so the test fails loudly if the matrix
// is changed without a deliberate decision.
const STAFF_ALLOWED: Permission[] = [
  "notice.create",
  "notice.status",
  "notice.generate",
  "ledger.manage",
  "property.manage",
  "tenant.manage",
  "attachment.manage",
  "field.manage",
  "mail.manage",
];
const STAFF_DENIED: Permission[] = [
  "notice.delete",
  "notice.approve",
  "notice.finalize",
  "template.manage",
  "settings.manage",
  "user.manage",
];
const MANAGER_DENIED: Permission[] = ["user.manage"];

describe("RBAC permission matrix", () => {
  it("admin can do everything", () => {
    for (const p of ALL_PERMISSIONS) expect(can("admin", p)).toBe(true);
  });

  it("readonly can do nothing", () => {
    expect(ROLE_PERMISSIONS.readonly).toHaveLength(0);
    for (const p of ALL_PERMISSIONS) expect(can("readonly", p)).toBe(false);
  });

  it("staff has exactly the operational permissions", () => {
    for (const p of STAFF_ALLOWED) expect(can("staff", p)).toBe(true);
    for (const p of STAFF_DENIED) expect(can("staff", p)).toBe(false);
  });

  it("manager can approve/finalize/delete and configure, but not manage users", () => {
    for (const p of ["notice.approve", "notice.finalize", "notice.delete", "template.manage", "settings.manage"] as Permission[])
      expect(can("manager", p)).toBe(true);
    for (const p of MANAGER_DENIED) expect(can("manager", p)).toBe(false);
  });

  it("manager is a strict superset of staff", () => {
    for (const p of ROLE_PERMISSIONS.staff) expect(can("manager", p)).toBe(true);
  });

  it("only admin may manage users", () => {
    expect(can("admin", "user.manage")).toBe(true);
    expect(can("manager", "user.manage")).toBe(false);
    expect(can("staff", "user.manage")).toBe(false);
    expect(can("readonly", "user.manage")).toBe(false);
  });

  it("treats a missing role as no access", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(can(null, p)).toBe(false);
      expect(can(undefined, p)).toBe(false);
    }
  });
});

describe("checkPermission gate", () => {
  it("throws PermissionError when no user is signed in", () => {
    expect(() => checkPermission({ role: null }, "notice.create")).toThrow(PermissionError);
  });

  it("throws when the workspace is locked, even for an admin", () => {
    expect(() => checkPermission({ role: "admin", locked: true }, "notice.finalize")).toThrow(
      /locked/i,
    );
  });

  it("blocks every mutation for a read-only user", () => {
    for (const p of ALL_PERMISSIONS) {
      expect(() => checkPermission({ role: "readonly" }, p)).toThrow(PermissionError);
    }
  });

  it("blocks staff from approve/finalize/delete/settings/users with a helpful message", () => {
    for (const p of STAFF_DENIED) {
      expect(() => checkPermission({ role: "staff" }, p)).toThrow(/not permitted/i);
    }
  });

  it("blocks a manager from managing users but allows finalizing", () => {
    expect(() => checkPermission({ role: "manager" }, "user.manage")).toThrow(PermissionError);
    expect(() => checkPermission({ role: "manager" }, "notice.finalize")).not.toThrow();
  });

  it("allows granted actions to pass", () => {
    expect(() => checkPermission({ role: "staff" }, "notice.create")).not.toThrow();
    expect(() => checkPermission({ role: "admin" }, "user.manage")).not.toThrow();
  });

  it("carries the offending permission on the error", () => {
    try {
      checkPermission({ role: "readonly" }, "notice.delete");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(PermissionError);
      expect((err as PermissionError).permission).toBe("notice.delete");
    }
  });
});

describe("matrix integrity", () => {
  it("every role maps to a known subset of ALL_PERMISSIONS", () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
    }
  });
});
