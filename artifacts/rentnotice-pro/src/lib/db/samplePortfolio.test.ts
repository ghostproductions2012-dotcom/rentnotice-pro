// Verifies the sample-portfolio generator honors custom options and that any
// partially-filled option set falls back to defaults for the rest.
import { describe, expect, it } from "vitest";
import { planSamplePortfolio, resolveSampleOptions, SAMPLE_DEFAULTS } from "./samplePortfolio";

describe("resolveSampleOptions", () => {
  it("uses defaults when no options are given", () => {
    const r = resolveSampleOptions();
    expect(r.totalDoors).toBe(SAMPLE_DEFAULTS.totalDoors);
    expect(r.singleFamilyPct).toBe(SAMPLE_DEFAULTS.singleFamilyPct);
    expect(r.avgUnitsPerBuilding).toBe(SAMPLE_DEFAULTS.avgUnitsPerBuilding);
    expect(r.vacancyPct).toBe(SAMPLE_DEFAULTS.vacancyPct);
    expect(r.latePayerPct).toBe(SAMPLE_DEFAULTS.latePayerPct);
    expect(r.monthsOfHistory).toBe(SAMPLE_DEFAULTS.monthsOfHistory);
    expect(r.avgRentCents).toBeNull();
  });

  it("fills defaults for unset fields in a partial form", () => {
    const r = resolveSampleOptions({ totalDoors: 250, latePayerPct: null });
    expect(r.totalDoors).toBe(250);
    expect(r.latePayerPct).toBe(SAMPLE_DEFAULTS.latePayerPct);
    expect(r.monthsOfHistory).toBe(SAMPLE_DEFAULTS.monthsOfHistory);
  });

  it("clamps out-of-range and ignores non-finite values", () => {
    const r = resolveSampleOptions({
      totalDoors: 999999,
      avgUnitsPerBuilding: 10,
      monthsOfHistory: -5,
      avgRentDollars: 50,
      vacancyPct: Number.NaN,
    });
    expect(r.totalDoors).toBe(5000);
    expect(r.avgUnitsPerBuilding).toBe(4);
    expect(r.monthsOfHistory).toBe(1);
    expect(r.avgRentCents).toBe(30000); // $300 floor
    expect(r.vacancyPct).toBe(SAMPLE_DEFAULTS.vacancyPct);
  });
});

describe("planSamplePortfolio", () => {
  it("hits the requested door count and history length", () => {
    const { properties, months } = planSamplePortfolio({ totalDoors: 200, monthsOfHistory: 12 });
    const doors = properties.reduce((s, p) => s + Math.max(1, p.units.length), 0);
    expect(doors).toBeGreaterThanOrEqual(200);
    expect(doors).toBeLessThan(204); // may overshoot by at most one building
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-07");
    expect(months[11]).toBe("2026-06");
  });

  it("honors 100% single-family and 0% vacancy", () => {
    const { properties, plans } = planSamplePortfolio({
      totalDoors: 100,
      singleFamilyPct: 100,
      vacancyPct: 0,
    });
    expect(properties).toHaveLength(100);
    expect(properties.every((p) => p.units.length === 0)).toBe(true);
    expect(plans).toHaveLength(100); // no vacancies → one tenant per door
  });

  it("makes every tenant delinquent at 100% late payers", () => {
    const { plans } = planSamplePortfolio({ totalDoors: 100, latePayerPct: 100 });
    expect(plans.length).toBeGreaterThan(0);
    expect(plans.every((p) => p.monthsBehind >= 1)).toBe(true);
  });

  it("makes no tenant delinquent at 0% late payers", () => {
    const { plans } = planSamplePortfolio({ totalDoors: 100, latePayerPct: 0 });
    expect(plans.every((p) => p.monthsBehind === 0)).toBe(true);
  });

  it("scales rents toward the requested average", () => {
    const { plans } = planSamplePortfolio({ totalDoors: 500, avgRentDollars: 1000 });
    const rents = plans.map((p) => p.tenant.monthlyRentCents ?? 0);
    const avg = rents.reduce((s, r) => s + r, 0) / rents.length;
    // City-band noise means the portfolio average lands near, not exactly on,
    // the target. ±15% is plenty tight to prove scaling is applied.
    expect(avg).toBeGreaterThan(85000);
    expect(avg).toBeLessThan(115000);
  });

  it("caps months behind at the available history", () => {
    const { plans } = planSamplePortfolio({
      totalDoors: 100,
      latePayerPct: 100,
      monthsOfHistory: 1,
    });
    expect(plans.every((p) => p.monthsBehind === 1)).toBe(true);
  });
});
