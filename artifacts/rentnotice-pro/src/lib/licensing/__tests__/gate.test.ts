import { describe, expect, it } from "vitest";
import { evaluateLicenseGate } from "../gate";
import type { ActivationState } from "../../types";

const NOW = new Date("2026-07-08T12:00:00Z").getTime();

function activation(overrides: Partial<ActivationState> = {}): ActivationState {
  return {
    licenseKey: "RNP-TEST-ACTIVE",
    companyId: "co-goldenstate",
    companyName: "Golden State Property Management, Inc.",
    licenseStatus: "active",
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
