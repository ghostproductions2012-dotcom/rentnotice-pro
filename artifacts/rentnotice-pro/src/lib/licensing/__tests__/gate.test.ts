import { describe, expect, it } from "vitest";
import { evaluateGraceWarning, evaluateLicenseGate, GRACE_WARNING_DAYS } from "../gate";
import type { ActivationState } from "../../types";

const NOW = new Date("2026-07-08T12:00:00Z").getTime();

function activation(overrides: Partial<ActivationState> = {}): ActivationState {
  return {
    licenseKey: "RNP-TEST-ACTIVE",
    companyId: "co-goldenstate",
    companyName: "Golden State Property Management, Inc.",
    licenseStatus: "active",
    statusReason: "Subscription in good standing",
    plan: "Team plan (10 seats)",
    activatedAt: new Date(NOW - 30 * 86400_000).toISOString(),
    lastVerifiedAt: new Date(NOW - 86400_000).toISOString(), // yesterday
    graceDays: 14,
    directorySyncedAt: new Date(NOW - 86400_000).toISOString(),
    ...overrides,
  };
}

describe("evaluateLicenseGate", () => {
  it("never gates demo or unset workspaces", () => {
    expect(evaluateLicenseGate("demo", null, NOW)).toEqual({ blocked: false, reason: null });
    expect(evaluateLicenseGate("unset", null, NOW)).toEqual({ blocked: false, reason: null });
    // Even with a stale activation record lying around, non-activated modes stay open.
    expect(
      evaluateLicenseGate("demo", activation({ licenseStatus: "cancelled" }), NOW).blocked,
    ).toBe(false);
  });

  it("does not gate an activated workspace with a missing activation record", () => {
    expect(evaluateLicenseGate("activated", null, NOW)).toEqual({ blocked: false, reason: null });
  });

  it("allows an active license verified within the grace period", () => {
    expect(evaluateLicenseGate("activated", activation(), NOW)).toEqual({
      blocked: false,
      reason: null,
    });
  });

  it("blocks paused and cancelled subscriptions immediately", () => {
    expect(evaluateLicenseGate("activated", activation({ licenseStatus: "paused" }), NOW)).toEqual({
      blocked: true,
      reason: "paused",
    });
    expect(
      evaluateLicenseGate("activated", activation({ licenseStatus: "cancelled" }), NOW),
    ).toEqual({ blocked: true, reason: "cancelled" });
  });

  it("blocks when the offline grace period is exceeded", () => {
    const stale = activation({
      lastVerifiedAt: new Date(NOW - 15 * 86400_000).toISOString(), // 15 days > 14-day grace
    });
    expect(evaluateLicenseGate("activated", stale, NOW)).toEqual({
      blocked: true,
      reason: "grace_expired",
    });
  });

  it("stays open right at the grace boundary", () => {
    const boundary = activation({
      lastVerifiedAt: new Date(NOW - 14 * 86400_000).toISOString(), // exactly 14 days
    });
    expect(evaluateLicenseGate("activated", boundary, NOW).blocked).toBe(false);
  });

  it("does not lock out on an unparseable lastVerifiedAt timestamp", () => {
    const corrupt = activation({ lastVerifiedAt: "not-a-date" });
    expect(evaluateLicenseGate("activated", corrupt, NOW).blocked).toBe(false);
  });

  it("respects a custom grace window", () => {
    const shortGrace = activation({
      graceDays: 1,
      lastVerifiedAt: new Date(NOW - 2 * 86400_000).toISOString(),
    });
    expect(evaluateLicenseGate("activated", shortGrace, NOW)).toEqual({
      blocked: true,
      reason: "grace_expired",
    });
  });
});

describe("evaluateGraceWarning", () => {
  it("never warns for demo or unset workspaces, or a missing activation record", () => {
    expect(evaluateGraceWarning("demo", null, NOW)).toBeNull();
    expect(evaluateGraceWarning("unset", null, NOW)).toBeNull();
    expect(evaluateGraceWarning("activated", null, NOW)).toBeNull();
    const nearExpiry = activation({
      lastVerifiedAt: new Date(NOW - 12 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("demo", nearExpiry, NOW)).toBeNull();
  });

  it("does not warn when plenty of grace time remains", () => {
    // Verified yesterday → 13 days remaining of a 14-day grace window.
    expect(evaluateGraceWarning("activated", activation(), NOW)).toBeNull();
    // 10 days ago → 4 days remaining, just outside the warning threshold.
    const fourLeft = activation({
      lastVerifiedAt: new Date(NOW - 10 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("activated", fourLeft, NOW)).toBeNull();
  });

  it("warns once the remaining time drops to the threshold", () => {
    // Exactly 3 days remaining.
    const threeLeft = activation({
      lastVerifiedAt: new Date(NOW - 11 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("activated", threeLeft, NOW)).toEqual({ daysRemaining: 3 });
  });

  it("rounds partial days up so users are not over-promised time", () => {
    // 12.5 days ago → 1.5 days remaining → report 2 days.
    const partial = activation({
      lastVerifiedAt: new Date(NOW - 12.5 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("activated", partial, NOW)).toEqual({ daysRemaining: 2 });
  });

  it("reports 0 days at the exact grace boundary (still unblocked)", () => {
    const boundary = activation({
      lastVerifiedAt: new Date(NOW - 14 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("activated", boundary, NOW)).toEqual({ daysRemaining: 0 });
    expect(evaluateLicenseGate("activated", boundary, NOW).blocked).toBe(false);
  });

  it("returns null once the grace period has expired — the blocked banner takes over", () => {
    const expired = activation({
      lastVerifiedAt: new Date(NOW - 15 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("activated", expired, NOW)).toBeNull();
    expect(evaluateLicenseGate("activated", expired, NOW).blocked).toBe(true);
  });

  it("does not warn for paused or cancelled subscriptions (they block immediately)", () => {
    const nearExpiry = { lastVerifiedAt: new Date(NOW - 12 * 86400_000).toISOString() };
    expect(
      evaluateGraceWarning("activated", activation({ ...nearExpiry, licenseStatus: "paused" }), NOW),
    ).toBeNull();
    expect(
      evaluateGraceWarning(
        "activated",
        activation({ ...nearExpiry, licenseStatus: "cancelled" }),
        NOW,
      ),
    ).toBeNull();
  });

  it("does not warn on an unparseable lastVerifiedAt timestamp", () => {
    expect(
      evaluateGraceWarning("activated", activation({ lastVerifiedAt: "not-a-date" }), NOW),
    ).toBeNull();
  });

  it("respects a custom grace window", () => {
    // 5-day grace, verified 3 days ago → 2 days remaining.
    const custom = activation({
      graceDays: 5,
      lastVerifiedAt: new Date(NOW - 3 * 86400_000).toISOString(),
    });
    expect(evaluateGraceWarning("activated", custom, NOW)).toEqual({ daysRemaining: 2 });
  });

  it("keeps the warning window consistent with the exported threshold", () => {
    expect(GRACE_WARNING_DAYS).toBe(3);
  });
});
