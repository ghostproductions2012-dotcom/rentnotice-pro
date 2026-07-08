import { describe, expect, it } from "vitest";
import type { Holiday } from "../../types";
import { computeDeadline } from "../deadlines";

// 2026-06-01 is a Monday; no CA judicial holidays fall in that week.
const customHoliday = (date: string, name = "Test Holiday"): Holiday => ({
  id: `h-${date}`,
  date,
  name,
  jurisdiction: "CA",
  courtHoliday: true,
  builtIn: false,
});

describe("deadline calculator", () => {
  it("counts 3 court days for a pay-or-quit served on a clean Monday", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "CA");
    expect(r.countedDays).toBe(3);
    expect(r.expirationDate).toBe("2026-06-04");
    expect(r.excludedDates).toHaveLength(0);
    expect(r.disclaimer).toMatch(/not legal advice/i);
  });

  it("skips weekends when counting court days", () => {
    // Served Thu 2026-06-04: Fri=1, Sat/Sun skipped, Mon=2, Tue=3.
    const r = computeDeadline("2026-06-04", "pay_or_quit_3day", "CA");
    expect(r.expirationDate).toBe("2026-06-09");
    expect(r.excludedDates.filter((d) => d.reason === "weekend")).toHaveLength(2);
  });

  it("skips custom judicial holidays", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "CA", {
      holidays: [customHoliday("2026-06-02")],
    });
    expect(r.expirationDate).toBe("2026-06-05");
    expect(r.excludedDates.some((d) => d.reason === "holiday" && d.name === "Test Holiday")).toBe(
      true,
    );
  });

  it("skips built-in CA judicial holidays (Independence Day 2025)", () => {
    // Served Thu 2025-07-03: Fri Jul 4 = holiday, Sat/Sun skipped,
    // Mon=1, Tue=2, Wed=3.
    const r = computeDeadline("2025-07-03", "pay_or_quit_3day", "CA");
    expect(r.expirationDate).toBe("2025-07-09");
    expect(r.excludedDates.some((d) => d.reason === "holiday")).toBe(true);
  });

  it("counts calendar days for 30-day terminations without weekend skipping", () => {
    // Served Mon 2026-06-01: +30 calendar days = Wed 2026-07-01 (court day).
    const r = computeDeadline("2026-06-01", "termination_30day", "CA");
    expect(r.countedDays).toBe(30);
    expect(r.expirationDate).toBe("2026-07-01");
  });

  it("rolls a calendar-day deadline forward off a holiday", () => {
    const r = computeDeadline("2026-06-01", "termination_30day", "CA", {
      holidays: [customHoliday("2026-07-01")],
    });
    expect(r.expirationDate).toBe("2026-07-02");
    expect(r.excludedDates.some((d) => d.reason === "holiday")).toBe(true);
  });

  it("computes a 60-day termination deadline", () => {
    const r = computeDeadline("2026-06-01", "termination_60day", "CA");
    expect(r.countedDays).toBe(60);
    // +60 days = Fri 2026-07-31 (court day, no roll).
    expect(r.expirationDate).toBe("2026-07-31");
  });

  it("uses 30 calendar days for a rent increase of 10% or less", () => {
    // $2,000 → $2,150 = +7.5%. Served Mon 2026-06-01: +30 days = Wed 2026-07-01.
    const r = computeDeadline("2026-06-01", "rent_increase", "CA", {
      rentIncrease: { newRentCents: 215000, currentRentCents: 200000 },
    });
    expect(r.countedDays).toBe(30);
    expect(r.expirationDate).toBe("2026-07-01");
  });

  it("uses 90 calendar days for a rent increase over 10% (§827(b)(2))", () => {
    // $2,000 → $2,300 = +15%. Served Mon 2026-06-01: +90 days = Sun 2026-08-30,
    // rolls forward off the weekend to Mon 2026-08-31.
    const r = computeDeadline("2026-06-01", "rent_increase", "CA", {
      rentIncrease: { newRentCents: 230000, currentRentCents: 200000 },
    });
    expect(r.countedDays).toBe(90);
    expect(r.expirationDate).toBe("2026-08-31");
    expect(r.explanation.join(" ")).toMatch(/827\(b\)\(2\)/);
  });

  it("uses exactly-10% boundary as the 30-day path", () => {
    // $2,000 → $2,200 = exactly +10% — not "over 10%", so 30 days.
    const r = computeDeadline("2026-06-01", "rent_increase", "CA", {
      rentIncrease: { newRentCents: 220000, currentRentCents: 200000 },
    });
    expect(r.countedDays).toBe(30);
    expect(r.expirationDate).toBe("2026-07-01");
  });

  it("handles non-round cent boundaries without float error (just over 10%)", () => {
    // Current $19.99 (1999¢): 10% threshold is 2198.9¢. 2199¢ is over 10% → 90 days.
    const r = computeDeadline("2026-06-01", "rent_increase", "CA", {
      rentIncrease: { newRentCents: 2199, currentRentCents: 1999 },
    });
    expect(r.countedDays).toBe(90);
  });

  it("handles non-round cent boundaries without float error (under 10%)", () => {
    // 2198¢ over 1999¢ is below the 10% threshold (2198.9¢) → 30 days.
    const r = computeDeadline("2026-06-01", "rent_increase", "CA", {
      rentIncrease: { newRentCents: 2198, currentRentCents: 1999 },
    });
    expect(r.countedDays).toBe(30);
  });

  it("falls back to 30 days when rent-increase context is missing", () => {
    const r = computeDeadline("2026-06-01", "rent_increase", "CA");
    expect(r.countedDays).toBe(30);
    expect(r.expirationDate).toBe("2026-07-01");
  });

  it("falls back to 30 days when the current rent is unknown", () => {
    const r = computeDeadline("2026-06-01", "rent_increase", "CA", {
      rentIncrease: { newRentCents: 230000, currentRentCents: null },
    });
    expect(r.countedDays).toBe(30);
    expect(r.expirationDate).toBe("2026-07-01");
  });

  it("treats a 24-hour entry notice as one calendar day", () => {
    const r = computeDeadline("2026-06-01", "entry_24hr", "CA");
    expect(r.expirationDate).toBe("2026-06-02");
  });

  it("produces a step-by-step explanation", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "CA");
    expect(r.explanation[0]).toMatch(/day 0/);
    expect(r.explanation.some((l) => l.includes("day 3 of 3"))).toBe(true);
  });

  it("emits no dataset warning for in-range service dates", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "CA");
    expect(r.warnings).toHaveLength(0);
  });

  it("computes holidays on demand outside the built-in dataset, with a warning", () => {
    // Served Fri 2034-12-29: Sat/Sun skipped, Mon 2035-01-01 = New Year's Day
    // (computed on demand), then Tue=1, Wed=2, Thu=3.
    const r = computeDeadline("2034-12-29", "pay_or_quit_3day", "CA");
    expect(r.expirationDate).toBe("2035-01-04");
    expect(r.excludedDates.some((d) => d.reason === "holiday" && d.date === "2035-01-01")).toBe(
      true,
    );
    expect(r.warnings.join(" ")).toMatch(/computed on demand/);
  });
});
