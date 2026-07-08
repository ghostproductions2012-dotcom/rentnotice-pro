import type { ActivationState, LicenseBlockReason, WorkspaceMode } from "../types";

export interface LicenseGate {
  blocked: boolean;
  reason: LicenseBlockReason | null;
}

const UNBLOCKED: LicenseGate = { blocked: false, reason: null };

const DAY_MS = 24 * 60 * 60 * 1000;

/** Start warning when this many days (or fewer) remain in the offline grace window. */
export const GRACE_WARNING_DAYS = 3;

export interface GraceWarning {
  /** Whole days until the grace period expires (rounded up; 0 means it expires today). */
  daysRemaining: number;
}

/**
 * Pure decision: should we warn that the offline grace period is about to
 * expire? Returns null when no warning applies — including when the gate is
 * already blocked (the blocked banner takes over at expiry).
 */
export function evaluateGraceWarning(
  mode: WorkspaceMode,
  activation: ActivationState | null,
  now: number = Date.now(),
): GraceWarning | null {
  if (mode !== "activated" || !activation) return null;
  if (activation.licenseStatus === "paused" || activation.licenseStatus === "cancelled") {
    return null;
  }
  const lastVerified = new Date(activation.lastVerifiedAt).getTime();
  if (!Number.isFinite(lastVerified)) return null;
  const remainingMs = activation.graceDays * DAY_MS - (now - lastVerified);
  if (remainingMs < 0) return null; // expired — the blocked banner handles this
  if (remainingMs > GRACE_WARNING_DAYS * DAY_MS) return null;
  return { daysRemaining: Math.ceil(remainingMs / DAY_MS) };
}

/**
 * Pure decision: is editing blocked by the company license?
 * - Demo/unset workspaces are never gated.
 * - Paused/cancelled subscriptions block immediately.
 * - Otherwise the offline grace period applies: if the device has not
 *   verified the license online within `graceDays`, editing locks until it can.
 * Blocking is view-only: reads stay available, writes throw.
 */
export function evaluateLicenseGate(
  mode: WorkspaceMode,
  activation: ActivationState | null,
  now: number = Date.now(),
): LicenseGate {
  if (mode !== "activated" || !activation) return UNBLOCKED;
  if (activation.licenseStatus === "paused" || activation.licenseStatus === "cancelled") {
    return { blocked: true, reason: activation.licenseStatus };
  }
  const graceMs = activation.graceDays * 24 * 60 * 60 * 1000;
  const lastVerified = new Date(activation.lastVerifiedAt).getTime();
  if (Number.isFinite(lastVerified) && now - lastVerified > graceMs) {
    return { blocked: true, reason: "grace_expired" };
  }
  return UNBLOCKED;
}
