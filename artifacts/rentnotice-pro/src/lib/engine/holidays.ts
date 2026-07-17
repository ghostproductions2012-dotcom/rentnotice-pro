// ---------------------------------------------------------------------------
// California judicial holiday dataset + helpers (2024-2030).
//
// Holidays are computed from rules where possible (Gov. Code §§6700-6701,
// CCP §135). Fixed-date holidays observe the standard weekend shift: a holiday
// that lands on Saturday is observed the preceding Friday, and one that lands
// on Sunday is observed the following Monday — this is the date the courts are
// actually closed and therefore the date excluded from 3-day counts.
//
// Pure and deterministic. Custom (user-added) holidays can be passed into the
// lookup helpers so office-specific closures are honored.
// ---------------------------------------------------------------------------

import type { Holiday, Id } from "../types";
import {
  dayOfWeek,
  isoDate,
  lastWeekdayOfMonth,
  nthWeekdayOfMonth,
} from "./dateUtils";

export const CA_HOLIDAY_START_YEAR = 2024;
export const CA_HOLIDAY_END_YEAR = 2030;

const MON = 1;
const THU = 4;
const FRI = 5;

/** Shift a fixed-date holiday to the observed (court-closure) date. */
function observedFixed(year: number, month1: number, day: number): string {
  const iso = isoDate(year, month1, day);
  const dow = dayOfWeek(iso);
  if (dow === 6) return isoDate(year, month1, day - 1); // Saturday -> Friday
  if (dow === 0) return isoDate(year, month1, day + 1); // Sunday -> Monday
  return iso;
}

interface RawHoliday {
  date: string;
  name: string;
}

/** Compute the full set of CA judicial holidays for a single calendar year. */
export function generateCaHolidays(year: number): Holiday[] {
  const raw: RawHoliday[] = [
    { date: observedFixed(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 1, MON, 3), name: "Martin Luther King Jr. Day" },
    { date: nthWeekdayOfMonth(year, 2, MON, 3), name: "Washington's Birthday (Presidents' Day)" },
    { date: observedFixed(year, 3, 31), name: "César Chávez Day" },
    { date: lastWeekdayOfMonth(year, 5, MON), name: "Memorial Day" },
    { date: observedFixed(year, 6, 19), name: "Juneteenth" },
    { date: observedFixed(year, 7, 4), name: "Independence Day" },
    { date: nthWeekdayOfMonth(year, 9, MON, 1), name: "Labor Day" },
    { date: nthWeekdayOfMonth(year, 9, FRI, 4), name: "Native American Day" },
    { date: observedFixed(year, 11, 11), name: "Veterans Day" },
    { date: nthWeekdayOfMonth(year, 11, THU, 4), name: "Thanksgiving Day" },
    { date: dayAfterThanksgiving(year), name: "Day after Thanksgiving" },
    { date: observedFixed(year, 12, 25), name: "Christmas Day" },
  ];
  return raw.map((h, i) => makeHoliday(h.date, h.name, `ca-${year}-${i}`));
}

function dayAfterThanksgiving(year: number): string {
  const thanksgiving = nthWeekdayOfMonth(year, 11, THU, 4);
  const [y, m, d] = thanksgiving.split("-").map(Number);
  return isoDate(y, m, d + 1);
}

function makeHoliday(date: string, name: string, id: Id): Holiday {
  return { id, date, name, jurisdiction: "CA", courtHoliday: true, builtIn: true };
}

function buildRange(startYear: number, endYear: number): Holiday[] {
  const out: Holiday[] = [];
  const seen = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    for (const h of generateCaHolidays(y)) {
      if (seen.has(h.date)) continue; // dedupe observed-shift collisions
      seen.add(h.date);
      out.push(h);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Full built-in CA judicial holiday dataset for 2024-2030. */
export const CA_HOLIDAYS_2024_2030: Holiday[] = buildRange(
  CA_HOLIDAY_START_YEAR,
  CA_HOLIDAY_END_YEAR,
);

const BUILT_IN_BY_DATE: Map<string, Holiday> = new Map(
  CA_HOLIDAYS_2024_2030.map((h) => [h.date, h]),
);

/** Built-in holidays for a specific year (or the full set when omitted). */
export function listCaHolidays(year?: number): Holiday[] {
  if (year == null) return [...CA_HOLIDAYS_2024_2030];
  if (year >= CA_HOLIDAY_START_YEAR && year <= CA_HOLIDAY_END_YEAR)
    return CA_HOLIDAYS_2024_2030.filter((h) => h.date.startsWith(`${year}-`));
  // Outside the pre-computed range: still compute on demand.
  return generateCaHolidays(year);
}

function indexHolidays(custom?: Holiday[]): Map<string, Holiday> {
  if (!custom || custom.length === 0) return BUILT_IN_BY_DATE;
  const map = new Map(BUILT_IN_BY_DATE);
  for (const h of custom) {
    if (h.courtHoliday) map.set(h.date, h);
  }
  return map;
}

// ------------------------- Non-CA (federal) holidays -------------------------
//
// For non-California jurisdictions the engine does not ship a per-state court
// calendar. When a state's counting basis excludes holidays, the standard
// federal holiday set is used as a conservative approximation and a warning is
// surfaced telling the operator to verify against the state's official court
// calendar.

/** Compute the standard federal holidays (observed dates) for one year. */
export function generateFederalHolidays(year: number): Holiday[] {
  const raw: RawHoliday[] = [
    { date: observedFixed(year, 1, 1), name: "New Year's Day" },
    { date: nthWeekdayOfMonth(year, 1, MON, 3), name: "Martin Luther King Jr. Day" },
    { date: nthWeekdayOfMonth(year, 2, MON, 3), name: "Washington's Birthday (Presidents' Day)" },
    { date: lastWeekdayOfMonth(year, 5, MON), name: "Memorial Day" },
    { date: observedFixed(year, 6, 19), name: "Juneteenth" },
    { date: observedFixed(year, 7, 4), name: "Independence Day" },
    { date: nthWeekdayOfMonth(year, 9, MON, 1), name: "Labor Day" },
    { date: nthWeekdayOfMonth(year, 10, MON, 2), name: "Columbus Day / Indigenous Peoples' Day" },
    { date: observedFixed(year, 11, 11), name: "Veterans Day" },
    { date: nthWeekdayOfMonth(year, 11, THU, 4), name: "Thanksgiving Day" },
    { date: observedFixed(year, 12, 25), name: "Christmas Day" },
  ];
  return raw.map((h, i) => ({
    id: `fed-${year}-${i}`,
    date: h.date,
    name: h.name,
    jurisdiction: "US",
    courtHoliday: true,
    builtIn: true,
  }));
}

/** Federal holiday lookup for a set of years (plus optional custom holidays). */
export function getFederalHoliday(
  dateIso: string,
  customHolidays?: Holiday[],
): Holiday | null {
  const year = Number(dateIso.slice(0, 4));
  for (const h of generateFederalHolidays(year)) {
    if (h.date === dateIso) return h;
  }
  for (const h of customHolidays ?? []) {
    if (h.courtHoliday && h.date === dateIso) return h;
  }
  return null;
}

/** True when the ISO date is a CA court holiday (optionally incl. custom ones). */
export function isCourtHoliday(dateIso: string, customHolidays?: Holiday[]): boolean {
  return indexHolidays(customHolidays).has(dateIso);
}

/** Return the holiday landing on the date, if any (optionally incl. custom ones). */
export function getCourtHoliday(
  dateIso: string,
  customHolidays?: Holiday[],
): Holiday | null {
  return indexHolidays(customHolidays).get(dateIso) ?? null;
}
