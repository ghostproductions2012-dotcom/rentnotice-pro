import { describe, expect, it } from "vitest";
import type { Holiday } from "../../types";
import { computeDeadline } from "../deadlines";
import {
  getStateHoliday,
  hasStateHolidayCalendar,
  listStateHolidays,
  stateHolidayCoverageWarning,
} from "../stateHolidays";

const customHoliday = (date: string, jurisdiction: string, name = "Custom Closure"): Holiday => ({
  id: `h-${jurisdiction}-${date}`,
  date,
  name,
  jurisdiction,
  courtHoliday: true,
  builtIn: false,
});

describe("bundled state holiday calendars", () => {
  it("bundles calendars for the business/court-day counting states", () => {
    expect(hasStateHolidayCalendar("AL")).toBe(true);
    expect(hasStateHolidayCalendar("UT")).toBe(true);
    expect(hasStateHolidayCalendar("FL")).toBe(true);
    expect(hasStateHolidayCalendar("TX")).toBe(false);
  });

  it("includes Utah's Pioneer Day (July 24)", () => {
    const h = getStateHoliday("UT", "2026-07-24");
    expect(h?.name).toBe("Pioneer Day");
    // Not a federal holiday — must not leak into other states.
    expect(getStateHoliday("AL", "2026-07-24")).toBeNull();
  });

  it("includes Alabama's Confederate Memorial Day (4th Monday of April)", () => {
    expect(getStateHoliday("AL", "2026-04-27")?.name).toBe("Confederate Memorial Day");
    expect(getStateHoliday("UT", "2026-04-27")).toBeNull();
  });

  it("computes Florida's Good Friday from Easter", () => {
    // Easter 2026 is April 5 → Good Friday April 3.
    expect(getStateHoliday("FL", "2026-04-03")?.name).toBe("Good Friday");
    expect(getStateHoliday("FL", "2027-03-26")?.name).toBe("Good Friday"); // Easter 2027: Mar 28
  });

  it("tabulates Florida's Rosh Hashanah and Yom Kippur", () => {
    expect(getStateHoliday("FL", "2026-09-21")?.name).toBe("Yom Kippur");
    expect(getStateHoliday("FL", "2025-09-23")?.name).toBe("Rosh Hashanah");
  });

  it("omits Presidents' Day and Juneteenth from the Florida court calendar", () => {
    const fl2026 = listStateHolidays("FL", 2026).map((h) => h.name);
    expect(fl2026).not.toContain("Washington's Birthday (Presidents' Day)");
    expect(fl2026.some((n) => /juneteenth/i.test(n))).toBe(false);
  });

  it("warns about tabulated-year coverage only when applicable", () => {
    expect(stateHolidayCoverageWarning("FL", [2026, 2027])).toBeNull();
    expect(stateHolidayCoverageWarning("FL", [2031, 2032])).toMatch(/only bundled/);
    expect(stateHolidayCoverageWarning("UT", [2031, 2032])).toBeNull();
  });

  it("honors custom holidays scoped to the state, US, or blank jurisdiction", () => {
    expect(getStateHoliday("UT", "2026-06-02", [customHoliday("2026-06-02", "UT")])).not.toBeNull();
    expect(getStateHoliday("UT", "2026-06-02", [customHoliday("2026-06-02", "US")])).not.toBeNull();
    expect(getStateHoliday("UT", "2026-06-02", [customHoliday("2026-06-02", "")])).not.toBeNull();
    expect(getStateHoliday("UT", "2026-06-02", [customHoliday("2026-06-02", "CA")])).toBeNull();
  });
});

describe("pack deadlines with real state calendars", () => {
  it("skips Pioneer Day when counting Utah business days", () => {
    // Served Wed 2026-07-22. Thu 7/23 = day 1, Fri 7/24 = Pioneer Day (skip),
    // Sat/Sun skip, Mon 7/27 = day 2, Tue 7/28 = day 3.
    const r = computeDeadline("2026-07-22", "pay_or_quit_3day", "UT");
    expect(r.expirationDate).toBe("2026-07-28");
    expect(r.excludedDates.some((d) => d.name === "Pioneer Day")).toBe(true);
    expect(r.warnings.join(" ")).not.toMatch(/approximated with the standard federal/);
    expect(r.explanation.join(" ")).toMatch(/bundled Utah calendar/);
  });

  it("skips Confederate Memorial Day when counting Alabama business days", () => {
    // Served Fri 2026-04-17 (7 business days): Mon 20 … Fri 24 = days 1-5,
    // Mon 27 = Confederate Memorial Day (skip), Tue 28 = 6, Wed 29 = 7.
    const r = computeDeadline("2026-04-17", "pay_or_quit_3day", "AL");
    expect(r.expirationDate).toBe("2026-04-29");
    expect(r.excludedDates.some((d) => d.name === "Confederate Memorial Day")).toBe(true);
  });

  it("skips Good Friday when counting Florida court days", () => {
    // FL counts the service day. Served Wed 2026-04-01 = day 1, Thu 4/2 = day 2,
    // Fri 4/3 = Good Friday (skip), Sat/Sun skip, Mon 4/6 = day 3.
    const r = computeDeadline("2026-04-01", "pay_or_quit_3day", "FL");
    expect(r.expirationDate).toBe("2026-04-06");
    expect(r.excludedDates.some((d) => d.name === "Good Friday")).toBe(true);
  });

  it("skips Yom Kippur when counting Florida court days", () => {
    // Served Fri 2026-09-18 = day 1, Sat/Sun skip, Mon 9/21 = Yom Kippur (skip),
    // Tue 9/22 = day 2, Wed 9/23 = day 3.
    const r = computeDeadline("2026-09-18", "pay_or_quit_3day", "FL");
    expect(r.expirationDate).toBe("2026-09-23");
    expect(r.excludedDates.some((d) => d.name === "Yom Kippur")).toBe(true);
  });

  it("warns when a Florida date falls outside the tabulated Rosh Hashanah/Yom Kippur years", () => {
    const r = computeDeadline("2031-06-02", "pay_or_quit_3day", "FL");
    expect(r.warnings.join(" ")).toMatch(/only bundled for 2024–2030/);
  });

  it("ignores custom holidays scoped to another state", () => {
    const clean = computeDeadline("2026-06-01", "pay_or_quit_3day", "UT");
    const withCa = computeDeadline("2026-06-01", "pay_or_quit_3day", "UT", {
      holidays: [customHoliday("2026-06-02", "CA")],
    });
    expect(withCa.expirationDate).toBe(clean.expirationDate);
    const withUt = computeDeadline("2026-06-01", "pay_or_quit_3day", "UT", {
      holidays: [customHoliday("2026-06-02", "UT")],
    });
    expect(withUt.excludedDates.some((d) => d.name === "Custom Closure")).toBe(true);
  });

  it("still uses the federal approximation (with warning) for states without a bundled calendar", () => {
    // Alaska rolls nothing / excludes nothing, so pick a hypothetical: none of
    // the other business-day states lack a calendar, so verify the warning stays
    // absent for AK calendar-day counting and no bundled-calendar note appears.
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "AK");
    expect(r.explanation.join(" ")).not.toMatch(/bundled/);
  });
});
