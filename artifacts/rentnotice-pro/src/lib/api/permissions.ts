// ---------------------------------------------------------------------------
// Role-based access control (RBAC).
//
// The single source of truth for "who may do what". Both the service layer
// (impl.ts, enforced — authoritative) and the UI (hooks/pages, for hiding or
// disabling controls) import from here so backend and frontend never drift.
//
// Roles (see UserRole in ../types):
//   admin    — full control, incl. user management and settings
//   manager  — everything staff can do, plus approve/finalize/delete notices,
//              manage templates, and change settings (but not manage users)
//   staff    — day-to-day operations: properties, tenants, ledgers, notices,
//              documents, service/status, attachments, field & mail tracking
//   readonly — may view everything but perform no state-changing action
// ---------------------------------------------------------------------------

import type { UserRole } from "../types";

export type Permission =
  | "notice.create" // create & edit notices
  | "notice.delete"
  | "notice.approve"
  | "notice.finalize"
  | "notice.status" // change status, revise, record service
  | "notice.generate" // generate documents / packets
  | "ledger.manage" // import, delete, reclassify, mapping presets
  | "property.manage"
  | "tenant.manage"
  | "template.manage"
  | "settings.manage" // app settings, company profile, holidays, backup/restore
  | "user.manage"
  | "attachment.manage"
  | "field.manage"
  | "mail.manage";

export const ALL_PERMISSIONS: Permission[] = [
  "notice.create",
  "notice.delete",
  "notice.approve",
  "notice.finalize",
  "notice.status",
  "notice.generate",
  "ledger.manage",
  "property.manage",
  "tenant.manage",
  "template.manage",
  "settings.manage",
  "user.manage",
  "attachment.manage",
  "field.manage",
  "mail.manage",
];

// Operational permissions shared by staff and up.
const STAFF_PERMISSIONS: Permission[] = [
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

// Managers add sign-off / lifecycle control and configuration, but not users.
const MANAGER_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  "notice.delete",
  "notice.approve",
  "notice.finalize",
  "template.manage",
  "settings.manage",
];

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  readonly: [],
  staff: STAFF_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  admin: ALL_PERMISSIONS,
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrator",
  manager: "Manager",
  staff: "Staff",
  readonly: "Read-only",
};

// Human-readable action names, used to build permission-denied messages.
export const PERMISSION_LABELS: Record<Permission, string> = {
  "notice.create": "create or edit notices",
  "notice.delete": "delete notices",
  "notice.approve": "approve notices",
  "notice.finalize": "finalize notices",
  "notice.status": "change notice status or record service",
  "notice.generate": "generate documents",
  "ledger.manage": "import or modify ledgers",
  "property.manage": "manage properties",
  "tenant.manage": "manage tenants",
  "template.manage": "manage templates",
  "settings.manage": "change settings or backups",
  "user.manage": "manage users",
  "attachment.manage": "manage attachments",
  "field.manage": "manage field assignments",
  "mail.manage": "manage mail tracking",
};

/** True when the given role is granted the permission. */
export function can(role: UserRole | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Thrown by the service layer when the current session lacks a permission. */
export class PermissionError extends Error {
  readonly permission: Permission;
  constructor(message: string, permission: Permission) {
    super(message);
    this.name = "PermissionError";
    this.permission = permission;
  }
}

export interface AccessContext {
  role: UserRole | null | undefined;
  locked?: boolean;
}

/**
 * Authoritative gate used by the service layer. Throws a {@link PermissionError}
 * when there is no signed-in user, the workspace is locked, or the user's role
 * does not grant `permission`. Pure and side-effect free so it is fully unit
 * testable without a database or session.
 */
export function checkPermission(ctx: AccessContext, permission: Permission): void {
  if (!ctx.role) {
    throw new PermissionError("You must be signed in to perform this action.", permission);
  }
  if (ctx.locked) {
    throw new PermissionError("The workspace is locked. Unlock it to continue.", permission);
  }
  if (!can(ctx.role, permission)) {
    throw new PermissionError(
      `${ROLE_LABELS[ctx.role]} users are not permitted to ${PERMISSION_LABELS[permission]}.`,
      permission,
    );
  }
}
