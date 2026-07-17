// ---------------------------------------------------------------------------
// Per-state holiday calendars for business/court-day counting states.
//
// The pack-driven deadline engine (computePackDeadline) previously
// approximated every non-CA holiday exclusion with the federal holiday set.
// This module bundles real state calendars for the states whose rule packs
// count business or court days (or roll deadlines off closed days):
//
//  - AL: Alabama state holidays (Ala. Code §1-3-8) — includes Confederate
//    Memorial Day, Jefferson Davis' Birthday, and the combined
//    Lee/King and Washington/Jefferson observances.
//  - UT: Utah state holidays (Utah Code §63G-1-301) — includes Pioneer Day
//    (July 24).
//  - FL: Court-observed legal holidays (Fla. R. Gen. Prac. & Jud. Admin.
//    2.514(a)(6)) — includes Good Friday (computed from Easter), plus
//    Rosh Hashanah and Yom Kippur (tabulated for 2024–2030, since the Hebrew
//    calendar is not rule-computable here).
//
// All generators are pure and deterministic. Fixed-date holidays observe the
// standard weekend shift (Saturday → preceding Friday, Sunday → following
// Monday), matching the days offices/courts are actually closed.
// ---------------------------------------------------------------------------

import type { Holiday } from "../types";
import { addDays, dayOfWeek, isoDate, lastWeekdayOfMonth, nthWeekdayOfMonth } from "./dateUtils";

/** Years for which the tabulated (non-rule-computable) FL dates are bundled. */
export const STATE_HOLIDAY_TABLE_START_YEAR = 2024;
export const STATE_HOLIDAY_TABLE_END_YEAR = 2030;

const MON = 1;
const THU = 4;
const FRI = 5;

/** Shift a fixed-date holiday to the observed (closure) date. */
function observedFixed(year: number, month1: number, day: number): string {
  const iso = isoDate(year, month1, day);
  const dow = dayOfWeek(iso);
  if (dow === 6) return isoDate(year, month1, day - 1); // Saturday -> Friday
  if (dow === 0) return isoDate(year, month1, day + 1); // Sunday -> Monday
  return iso;
}

/** Easter Sunday (Gregorian) via the Meeus/Jones/Butcher algorithm. */
function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return isoDate(year, month, day);
}

function dayAfterThanksgiving(year: number): string {
  return addDays(nthWeekdayOfMonth(year, 11, THU, 4), 1);
}

interface RawHoliday {
  date: string;
  name: string;
}

// --------------------------- Alabama (Ala. Code §1-3-8) ---------------------

function generateAlHolidays(year: number): RawHoliday[] {
  return [
    { date: observedFixed(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 1, MON, 3), name: "Robert E. Lee / Martin Luther King Jr. Birthday" },
    { date: nthWeekdayOfMonth(year, 2, MON, 3), name: "George Washington / Thomas Jefferson Birthday" },
    { date: nthWeekdayOfMonth(year, 4, MON, 4), name: "Confederate Memorial Day" },
    { date: lastWeekdayOfMonth(year, 5, MON), name: "Memorial Day" },
    { date: nthWeekdayOfMonth(year, 6, MON, 1), name: "Jefferson Davis' Birthday" },
    { date: observedFixed(year, 6, 19), name: "Juneteenth" },
    { date: observedFixed(year, 7, 4), name: "Independence Day" },
    { date: nthWeekdayOfMonth(year, 9, MON, 1), name: "Labor Day" },
    { date: nthWeekdayOfMonth(year, 10, MON, 2), name: "Columbus Day / American Indian Heritage Day" },
    { date: observedFixed(year, 11, 11), name: "Veterans Day" },
    { date: nthWeekdayOfMonth(year, 11, THU, 4), name: "Thanksgiving Day" },
    { date: observedFixed(year, 12, 25), name: "Christmas Day" },
  ];
}

// ---------------------------- Utah (§63G-1-301) ------------------------------

function generateUtHolidays(year: number): RawHoliday[] {
  return [
    { date: observedFixed(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 1, MON, 3), name: "Martin Luther King Jr. Day (Human Rights Day)" },
    { date: nthWeekdayOfMonth(year, 2, MON, 3), name: "Washington & Lincoln Day" },
    { date: lastWeekdayOfMonth(year, 5, MON), name: "Memorial Day" },
    { date: observedFixed(year, 6, 19), name: "Juneteenth National Freedom Day" },
    { date: observedFixed(year, 7, 4), name: "Independence Day" },
    { date: observedFixed(year, 7, 24), name: "Pioneer Day" },
    { date: nthWeekdayOfMonth(year, 9, MON, 1), name: "Labor Day" },
    { date: nthWeekdayOfMonth(year, 10, MON, 2), name: "Columbus Day" },
    { date: observedFixed(year, 11, 11), name: "Veterans Day" },
    { date: nthWeekdayOfMonth(year, 11, THU, 4), name: "Thanksgiving Day" },
    { date: observedFixed(year, 12, 25), name: "Christmas Day" },
  ];
}

// ------------- Florida court legal holidays (Rule 2.514(a)(6)) ---------------
//
// Rosh Hashanah and Yom Kippur follow the Hebrew calendar and cannot be
// rule-computed here; the Gregorian dates (first day, as observed by the
// courts) are tabulated for the bundled year range.

const FL_ROSH_HASHANAH: Record<number, string> = {
  2024: "2024-10-03",
  2025: "2025-09-23",
  2026: "2026-09-12",
  2027: "2027-10-02",
  2028: "2028-09-21",
  2029: "2029-09-10",
  2030: "2030-09-28",
};

const FL_YOM_KIPPUR: Record<number, string> = {
  2024: "2024-10-12",
  2025: "2025-10-02",
  2026: "2026-09-21",
  2027: "2027-10-11",
  2028: "2028-09-30",
  2029: "2029-09-19",
  2030: "2030-10-07",
};

function generateFlHolidays(year: number): RawHoliday[] {
  const raw: RawHoliday[] = [
    { date: observedFixed(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 1, MON, 3), name: "Martin Luther King Jr. Day" },
    { date: addDays(easterSunday(year), -2), name: "Good Friday" },
    { date: lastWeekdayOfMonth(year, 5, MON), name: "Memorial Day" },
    { date: observedFixed(year, 7, 4), name: "Independence Day" },
    { date: nthWeekdayOfMonth(year, 9, MON, 1), name: "Labor Day" },
    { date: observedFixed(year, 11, 11), name: "Veterans Day" },
    { date: nthWeekdayOfMonth(year, 11, THU, 4), name: "Thanksgiving Day" },
    { date: dayAfterThanksgiving(year), name: "Friday after Thanksgiving" },
    { date: observedFixed(year, 12, 25), name: "Christmas Day" },
  ];
  if (FL_ROSH_HASHANAH[year]) raw.push({ date: FL_ROSH_HASHANAH[year], name: "Rosh Hashanah" });
  if (FL_YOM_KIPPUR[year]) raw.push({ date: FL_YOM_KIPPUR[year], name: "Yom Kippur" });
  return raw;
}

// --------------------------------- Registry ----------------------------------

interface StateCalendar {
  generate: (year: number) => RawHoliday[];
  /** Human label for the calendar's legal source. */
  source: string;
  /** True when some holidays are tabulated and only cover the bundled range. */
  tabulatedYearsOnly: boolean;
}

const STATE_CALENDARS: Record<string, StateCalendar> = {
  AL: { generate: generateAlHolidays, source: "Alabama state holidays (Ala. Code §1-3-8)", tabulatedYearsOnly: false },
  UT: { generate: generateUtHolidays, source: "Utah state holidays (Utah Code §63G-1-301)", tabulatedYearsOnly: false },
  FL: {
    generate: generateFlHolidays,
    source: "Florida court legal holidays (Fla. R. Gen. Prac. & Jud. Admin. 2.514)",
    tabulatedYearsOnly: true,
  },
};

/** States with a bundled holiday calendar. */
export const STATE_HOLIDAY_STATES: string[] = Object.keys(STATE_CALENDARS);

/** True when a bundled calendar exists for the 2-letter state code. */
export function hasStateHolidayCalendar(stateCode: string | null | undefined): boolean {
  return !!stateCode && stateCode.toUpperCase() in STATE_CALENDARS;
}

/** Human label of the bundled calendar's legal source (null when none). */
export function stateHolidaySource(stateCode: string): string | null {
  return STATE_CALENDARS[stateCode.toUpperCase()]?.source ?? null;
}

/** Bundled holidays for one state and year (empty when no calendar exists). */
export function listStateHolidays(stateCode: string, year: number): Holiday[] {
  const cal = STATE_CALENDARS[stateCode.toUpperCase()];
  if (!cal) return [];
  return cal.generate(year).map((h, i) => ({
    id: `${stateCode.toLowerCase()}-${year}-${i}`,
    date: h.date,
    name: h.name,
    jurisdiction: stateCode.toUpperCase(),
    courtHoliday: true,
    builtIn: true,
  }));
}

/**
 * True when a custom (user-added) holiday applies to the given state:
 * jurisdiction matches the state, is "US", or is blank (applies everywhere).
 */
export function customHolidayApplies(stateCode: string, h: Holiday): boolean {
  if (!h.courtHoliday) return false;
  const j = (h.jurisdiction ?? "").trim().toUpperCase();
  return j === "" || j === "US" || j === stateCode.toUpperCase();
}

/**
 * Bundled state-holiday lookup for a single date, honoring custom holidays
 * whose jurisdiction applies to the state. Returns null when the date is not
 * a holiday (or when no bundled calendar exists and no custom holiday hits).
 */
export function getStateHoliday(
  stateCode: string,
  dateIso: string,
  customHolidays?: Holiday[],
): Holiday | null {
  const year = Number(dateIso.slice(0, 4));
  for (const h of listStateHolidays(stateCode, year)) {
    if (h.date === dateIso) return h;
  }
  for (const h of customHolidays ?? []) {
    if (customHolidayApplies(stateCode, h) && h.date === dateIso) return h;
  }
  return null;
}

/**
 * Warning text when part of the state's calendar is tabulated and the given
 * years fall outside the bundled table (null when full coverage exists).
 */
export function stateHolidayCoverageWarning(stateCode: string, years: number[]): string | null {
  const cal = STATE_CALENDARS[stateCode.toUpperCase()];
  if (!cal || !cal.tabulatedYearsOnly) return null;
  const outside = years.filter(
    (y) => y < STATE_HOLIDAY_TABLE_START_YEAR || y > STATE_HOLIDAY_TABLE_END_YEAR,
  );
  if (outside.length === 0) return null;
  return `Some ${stateCode.toUpperCase()} court holidays (Rosh Hashanah, Yom Kippur) are only bundled for ${STATE_HOLIDAY_TABLE_START_YEAR}–${STATE_HOLIDAY_TABLE_END_YEAR}; dates in ${outside.join(", ")} could not be checked against them. Verify the court's official calendar.`;
}
