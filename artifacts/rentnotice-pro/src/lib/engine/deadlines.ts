// ---------------------------------------------------------------------------
// Notice deadline calculator.
//
// Counting rules (spec §11):
//  - The day AFTER service is day 1.
//  - 3-day notices (pay-or-quit / perform-covenant): count court days only —
//    Saturdays, Sundays, and judicial holidays are skipped, never counted
//    (Cal. Code Civ. Proc. §1161(2)). The deadline therefore always lands on a
//    court day.
//  - 30/60/90-day notices: count calendar days, but if the expiration lands on
//    a weekend or holiday it rolls forward to the next court day.
//  - 24-hour entry notices: a single calendar day (informational).
//
// Returns the DeadlineResult structure from ../types with a step-by-step
// breakdown. Pure and deterministic; custom holidays may be supplied.
// ---------------------------------------------------------------------------

import type { DeadlineResult, Holiday, NoticeType } from "../types";
import { addDays, isWeekend } from "./dateUtils";
import {
  CA_HOLIDAY_END_YEAR,
  CA_HOLIDAY_START_YEAR,
  generateCaHolidays,
  getCourtHoliday,
} from "./holidays";
import { getNoticeTypeRule } from "./noticeRules";

const DISCLAIMER =
  "This calculator is informational only and is not legal advice. Deadlines must be confirmed by a qualified California attorney.";

export interface DeadlineOptions {
  /** Custom holidays merged with the built-in CA judicial holiday dataset. */
  holidays?: Holiday[];
}

/**
 * Compute the expiration deadline for a notice served on `serviceDate`.
 */
export function computeDeadline(
  serviceDate: string,
  noticeType: NoticeType,
  jurisdiction: string,
  options: DeadlineOptions = {},
): DeadlineResult {
  const rule = getNoticeTypeRule(noticeType);
  const warnings: string[] = [];

  // The built-in CA judicial holiday dataset covers a fixed year range. If the
  // counting window falls outside it, compute those years' holidays on demand
  // so weekends/holidays are still skipped correctly, and surface a warning.
  const serviceYear = Number(serviceDate.slice(0, 4));
  const outOfRangeYears = [serviceYear, serviceYear + 1].filter(
    (y) => y < CA_HOLIDAY_START_YEAR || y > CA_HOLIDAY_END_YEAR,
  );
  let custom = options.holidays;
  if (outOfRangeYears.length > 0) {
    custom = [...outOfRangeYears.flatMap((y) => generateCaHolidays(y)), ...(options.holidays ?? [])];
    warnings.push(
      `The service date falls outside the built-in ${CA_HOLIDAY_START_YEAR}–${CA_HOLIDAY_END_YEAR} CA judicial holiday dataset. Holidays for ${outOfRangeYears.join(", ")} were computed on demand and should be verified against the official court calendar.`,
    );
  }

  const excludedDates: DeadlineResult["excludedDates"] = [];
  const explanation: string[] = [`Service date: ${serviceDate} (day 0 — not counted).`];

  let expirationDate: string;
  let countedDays: number;

  if (rule.countingMethod === "court_days") {
    countedDays = rule.periodDays;
    let cursor = serviceDate;
    let counted = 0;
    while (counted < countedDays) {
      cursor = addDays(cursor, 1);
      if (isWeekend(cursor)) {
        excludedDates.push({ date: cursor, reason: "weekend" });
        explanation.push(`${cursor}: weekend — not counted.`);
        continue;
      }
      const holiday = getCourtHoliday(cursor, custom);
      if (holiday) {
        excludedDates.push({ date: cursor, reason: "holiday", name: holiday.name });
        explanation.push(`${cursor}: judicial holiday (${holiday.name}) — not counted.`);
        continue;
      }
      counted += 1;
      explanation.push(`${cursor}: counted as day ${counted} of ${countedDays}.`);
    }
    expirationDate = cursor;
    explanation.push(`Deadline: end of day ${expirationDate}.`);
  } else if (rule.countingMethod === "calendar_hours") {
    // 24-hour entry notice: one calendar day after service.
    countedDays = 1;
    expirationDate = addDays(serviceDate, 1);
    explanation.push(`${expirationDate}: at least 24 hours after service.`);
    explanation.push(`Deadline: ${expirationDate}.`);
  } else {
    // calendar_days: count straight calendar days, then roll forward off
    // weekends/holidays so the tenant is not forced to act on a closed day.
    countedDays = rule.periodDays;
    let cursor = addDays(serviceDate, countedDays);
    explanation.push(
      `${cursor}: ${countedDays} calendar days after service (day after service is day 1).`,
    );
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (isWeekend(cursor)) {
        excludedDates.push({ date: cursor, reason: "weekend" });
        explanation.push(`${cursor}: weekend — deadline rolls forward.`);
        cursor = addDays(cursor, 1);
        continue;
      }
      const holiday = getCourtHoliday(cursor, custom);
      if (holiday) {
        excludedDates.push({ date: cursor, reason: "holiday", name: holiday.name });
        explanation.push(`${cursor}: judicial holiday (${holiday.name}) — deadline rolls forward.`);
        cursor = addDays(cursor, 1);
        continue;
      }
      break;
    }
    expirationDate = cursor;
    explanation.push(`Deadline: end of day ${expirationDate}.`);
  }

  return {
    serviceDate,
    noticeType,
    jurisdiction,
    countedDays,
    excludedDates,
    expirationDate,
    explanation,
    warnings,
    disclaimer: DISCLAIMER,
  };
}
