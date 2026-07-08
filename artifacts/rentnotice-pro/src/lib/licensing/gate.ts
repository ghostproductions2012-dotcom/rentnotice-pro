import type { ActivationState, LicenseBlockReason, WorkspaceMode } from "../types";

export interface LicenseGate {
  blocked: boolean;
  reason: LicenseBlockReason | null;
}

const UNBLOCKED: LicenseGate = { blocked: false, reason: null };

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
