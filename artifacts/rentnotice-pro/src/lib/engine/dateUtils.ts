// ---------------------------------------------------------------------------
// Shared, timezone-safe date helpers for the legal-logic engines.
// All dates are ISO strings ("YYYY-MM-DD"); all month keys are "YYYY-MM".
// Every function is pure and deterministic (UTC math, no local timezone).
// ---------------------------------------------------------------------------

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Number of days in a given month (1-based month index). Handles leap Feb. */
export function lastDayOfMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** First and last ISO date of a "YYYY-MM" month key. */
export function monthBounds(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split("-").map(Number);
  const last = lastDayOfMonth(y, m);
  return { start: `${monthKey}-01`, end: `${monthKey}-${pad2(last)}` };
}

function isoFromUtc(dt: Date): string {
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Build an ISO date string from numeric parts. */
export function isoDate(year: number, month1: number, day: number): string {
  return isoFromUtc(new Date(Date.UTC(year, month1 - 1, day)));
}

/** Add (or subtract) whole days to an ISO date, returning an ISO date. */
export function addDays(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return isoFromUtc(dt);
}

/** Day of week for an ISO date. 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(dateIso: string): number {
  const [y, m, d] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** True when the ISO date falls on Saturday or Sunday. */
export function isWeekend(dateIso: string): boolean {
  const dow = dayOfWeek(dateIso);
  return dow === 0 || dow === 6;
}

/**
 * The Nth weekday of a month, e.g. nthWeekdayOfMonth(2026, 1, 1, 3) is the
 * 3rd Monday of January 2026. weekday: 0 = Sun .. 6 = Sat.
 */
export function nthWeekdayOfMonth(
  year: number,
  month1: number,
  weekday: number,
  n: number,
): string {
  const firstDow = new Date(Date.UTC(year, month1 - 1, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return isoDate(year, month1, day);
}

/** The last given weekday of a month (e.g. last Monday of May). */
export function lastWeekdayOfMonth(year: number, month1: number, weekday: number): string {
  const last = lastDayOfMonth(year, month1);
  const lastDow = new Date(Date.UTC(year, month1 - 1, last)).getUTCDay();
  const offset = (lastDow - weekday + 7) % 7;
  return isoDate(year, month1, last - offset);
}

/** Monotonic month index (year * 12 + month) for a "YYYY-MM" key. */
export function monthKeyIndex(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Stable ISO string comparison (works because ISO dates sort lexically). */
export function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The "YYYY-MM" month key of an ISO date. */
export function monthKeyOf(dateIso: string): string {
  return dateIso.slice(0, 7);
}
