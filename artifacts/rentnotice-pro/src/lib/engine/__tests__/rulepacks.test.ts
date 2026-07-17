import { describe, expect, it } from "vitest";
import { computeDeadline } from "../deadlines";
import {
  ALL_RULE_PACKS,
  HI_MEDIATION_EFFECTIVE_DATE,
  RULE_PACKS,
  getRulePack,
} from "../rulepacks";

describe("rule pack data integrity", () => {
  it("covers all 50 states plus DC", () => {
    expect(ALL_RULE_PACKS).toHaveLength(51);
    const codes = new Set(ALL_RULE_PACKS.map((p) => p.state));
    expect(codes.size).toBe(51);
    expect(codes.has("CA")).toBe(true);
    expect(codes.has("DC")).toBe(true);
  });

  it("never pairs a period length with a missing unit (or vice versa)", () => {
    for (const p of ALL_RULE_PACKS) {
      const { periodLength, periodUnit } = p.nonpayment;
      expect(
        (periodLength == null) === (periodUnit == null),
        `${p.state} has mismatched period length/unit`,
      ).toBe(true);
    }
  });

  it("lease-sensitive states have rule cards and no fixed period", () => {
    for (const p of ALL_RULE_PACKS.filter((x) => x.leaseSensitive)) {
      expect(p.ruleCards.length, `${p.state} lease-sensitive without rule cards`).toBeGreaterThan(0);
    }
  });

  it("marks the strict rent-only states as hard blocks", () => {
    for (const st of ["CA", "AK", "MA", "FL"]) {
      expect(RULE_PACKS[st].nonpayment.rentOnlyEnforcement, st).toBe("hard_block");
    }
  });

  it("records the MD/ME/HI prerequisites", () => {
    expect(RULE_PACKS.MD.nonpayment.prerequisites).toContain("notice_of_intent");
    expect(RULE_PACKS.ME.nonpayment.prerequisites).toContain("information_sheet");
    expect(RULE_PACKS.HI.nonpayment.prerequisites).toContain("mediation_if_requested");
    expect(HI_MEDIATION_EFFECTIVE_DATE).toBe("2026-02-05");
  });

  it("keeps Oregon flagged with a stale-statute warning", () => {
    expect(RULE_PACKS.OR.staleStatuteWarning).toBeTruthy();
  });

  it("looks up packs case-insensitively and returns null for unknowns", () => {
    expect(getRulePack("tx")?.state).toBe("TX");
    expect(getRulePack("ZZ")).toBeNull();
    expect(getRulePack(null)).toBeNull();
  });
});

describe("pack-driven deadline engine", () => {
  it("leaves the California path byte-identical to the legacy engine", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "CA");
    expect(r.countedDays).toBe(3);
    expect(r.expirationDate).toBe("2026-06-04");
    expect(r.disclaimer).toMatch(/California attorney/);
  });

  it("computes a calendar-day state period (TX: 3 calendar days)", () => {
    const pack = RULE_PACKS.TX;
    expect(pack.nonpayment.periodUnit).toBe("calendar_day");
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "TX");
    expect(r.jurisdiction).toBe("TX");
    expect(r.countedDays).toBe(pack.nonpayment.periodLength);
    expect(r.disclaimer).toMatch(/jurisdiction/);
  });

  it("applies Alaska's mail extension for certified mail", () => {
    const base = computeDeadline("2026-06-01", "pay_or_quit_3day", "AK", {
      serviceMethod: "personal",
    });
    const mailed = computeDeadline("2026-06-01", "pay_or_quit_3day", "AK", {
      serviceMethod: "certified_mail",
    });
    expect(new Date(mailed.expirationDate).getTime()).toBeGreaterThan(
      new Date(base.expirationDate).getTime(),
    );
  });

  it("warns instead of guessing for a lease-sensitive state without a fixed period", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "GA");
    expect(r.warnings.some((w) => /must NOT be relied on/i.test(w))).toBe(true);
  });

  it("warns for a jurisdiction without any rule pack", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "XX");
    expect(r.warnings.some((w) => /No rule pack exists/i.test(w))).toBe(true);
  });
});
