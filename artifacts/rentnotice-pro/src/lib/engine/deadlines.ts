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

import type { DeadlineResult, Holiday, NoticeType, ServiceMethod } from "../types";
import { addDays, isWeekend } from "./dateUtils";
import {
  CA_HOLIDAY_END_YEAR,
  CA_HOLIDAY_START_YEAR,
  generateCaHolidays,
  getCourtHoliday,
  getFederalHoliday,
} from "./holidays";
import {
  RENT_INCREASE_LARGE_PERIOD_DAYS,
  getNoticeTypeRule,
  isLargeRentIncrease,
} from "./noticeRules";
import {
  customHolidayApplies,
  getStateHoliday,
  hasStateHolidayCalendar,
  stateHolidayCoverageWarning,
  stateHolidaySource,
} from "./stateHolidays";
import { getRulePack, PERIOD_UNIT_LABELS, type StateRulePack } from "./rulepacks";

const DISCLAIMER =
  "This calculator is informational only and is not legal advice. Deadlines must be confirmed by a qualified California attorney.";

const GENERIC_DISCLAIMER =
  "This calculator is informational only and is not legal advice. Deadlines must be confirmed by a qualified attorney licensed in the notice's jurisdiction.";

export interface RentIncreaseContext {
  /** Proposed new monthly rent, in cents. */
  newRentCents: number | null;
  /** Tenant's current scheduled monthly rent, in cents. */
  currentRentCents: number | null;
}

export interface DeadlineOptions {
  /** Custom holidays merged with the built-in CA judicial holiday dataset. */
  holidays?: Holiday[];
  /**
   * Amount context for rent-increase notices. When the new rent exceeds a 10%
   * increase over the current scheduled rent, Cal. Civ. Code §827(b)(2)
   * requires 90 days' notice instead of the standard 30.
   */
  rentIncrease?: RentIncreaseContext;
  /**
   * Service method used (or planned). Enables state mail-extension rules
   * (e.g. Alaska adds 3 days for certified/registered mail).
   */
  serviceMethod?: ServiceMethod | null;
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

  // ---- Non-CA pay-or-quit notices: use the state rule pack when it carries a
  // verified nonpayment period. California keeps the original engine path
  // below (byte-identical output).
  const jurisdictionCode = jurisdiction.toUpperCase();
  if (jurisdictionCode !== "CA" && noticeType === "pay_or_quit_3day") {
    const pack = getRulePack(jurisdictionCode);
    if (pack && pack.nonpayment.periodLength != null && pack.nonpayment.periodUnit != null) {
      return computePackDeadline(serviceDate, noticeType, jurisdictionCode, pack, options);
    }
    warnings.push(
      pack
        ? `The ${pack.stateName} rule pack does not specify a verified nonpayment notice period (${pack.leaseSensitive ? "lease/ground-sensitive state" : "verification required"}). The deadline below uses California counting rules as a placeholder and must NOT be relied on.`
        : `No rule pack exists for jurisdiction "${jurisdiction}". The deadline below uses California counting rules as a placeholder and must NOT be relied on.`,
    );
  } else if (jurisdictionCode !== "CA") {
    warnings.push(
      `Deadlines for ${jurisdictionCode} ${rule.label.toLowerCase()} notices are computed with California counting rules as a placeholder. Attorney review is required before relying on this date.`,
    );
  }

  // Cal. Civ. Code §827(b)(2): rent increases over 10% of scheduled rent
  // require 90 days' notice instead of the standard 30.
  const largeRentIncrease =
    noticeType === "rent_increase" &&
    isLargeRentIncrease(
      options.rentIncrease?.newRentCents,
      options.rentIncrease?.currentRentCents,
    );
  const periodDays = largeRentIncrease ? RENT_INCREASE_LARGE_PERIOD_DAYS : rule.periodDays;

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
  if (largeRentIncrease) {
    explanation.push(
      `Rent increase exceeds 10% of the tenant's scheduled rent — ${RENT_INCREASE_LARGE_PERIOD_DAYS} days' notice required (Cal. Civ. Code §827(b)(2)).`,
    );
  }

  let expirationDate: string;
  let countedDays: number;

  if (rule.countingMethod === "court_days") {
    countedDays = periodDays;
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
    countedDays = periodDays;
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

// ---------------------------------------------------------------------------
// Rule-pack-driven deadline (non-CA pay-or-quit notices).
//
// Counting behavior comes from the state's rule pack:
//  - court_day / business_day units: skip weekends (and holidays where the
//    pack excludes them) while counting — the deadline lands on an open day.
//  - calendar_day units: count straight days, then roll forward off weekends /
//    holidays only when the pack says the deadline moves when courts are
//    closed.
//  - Mail extensions (e.g. AK +3 for certified/registered mail) are applied
//    when the service method matches the pack's extension list.
//  - Non-CA holiday exclusions use the standard federal holiday set as a
//    conservative approximation, with a warning to verify the state calendar.
// ---------------------------------------------------------------------------

/** Map an app ServiceMethod onto the rule-pack service vocabulary. */
function toPackMethod(method: ServiceMethod): string {
  switch (method) {
    case "substitute":
      return "substituted_and_mail";
    case "post_and_mail":
      return "posting_and_mail";
    default:
      return method;
  }
}

function computePackDeadline(
  serviceDate: string,
  noticeType: NoticeType,
  jurisdiction: string,
  pack: StateRulePack,
  options: DeadlineOptions,
): DeadlineResult {
  const np = pack.nonpayment;
  const basis = np.countingBasis;
  const unit = np.periodUnit!;
  const warnings: string[] = [];
  const excludedDates: DeadlineResult["excludedDates"] = [];
  const startsDayAfter = pack.dateCount.countStartsDayAfterService;
  const explanation: string[] = [
    `Jurisdiction: ${pack.stateName} (rule pack v${pack.versionDate}).`,
    startsDayAfter
      ? `Service date: ${serviceDate} (day 0 — not counted).`
      : `Service date: ${serviceDate} (counting starts on the service day in ${pack.stateName}).`,
    `Statutory period: ${np.periodLength} ${PERIOD_UNIT_LABELS[unit]}. ${np.summary}`,
  ];

  if (pack.verificationStatus !== "approved") {
    warnings.push(
      `The ${pack.stateName} rule pack is marked "${pack.verificationStatus.replace(/_/g, " ")}" — this deadline must be verified by a licensed attorney before it is relied on.`,
    );
  }

  let periodDays = np.periodLength!;
  const method = options.serviceMethod ?? null;
  if (
    method &&
    basis.mailExtensionDays > 0 &&
    basis.mailExtensionMethods.includes(toPackMethod(method) as never)
  ) {
    periodDays += basis.mailExtensionDays;
    explanation.push(
      `Service by ${method.replace(/_/g, " ")} adds ${basis.mailExtensionDays} day(s) (mail extension) — total ${periodDays} days.`,
    );
  }

  const excludeHolidays = basis.excludeStateHolidays || basis.excludeCourtHolidays;
  const needsHolidayLookup =
    excludeHolidays || pack.dateCount.movesToNextOpenCourtDayIfDeadlineClosed;
  const bundledCalendar = hasStateHolidayCalendar(jurisdiction);
  const stateCustom = (options.holidays ?? []).filter((h) =>
    customHolidayApplies(jurisdiction, h),
  );
  const holidayFor = (dateIso: string) => {
    if (!needsHolidayLookup) return null;
    return bundledCalendar
      ? getStateHoliday(jurisdiction, dateIso, stateCustom)
      : getFederalHoliday(dateIso, stateCustom);
  };
  if (needsHolidayLookup && bundledCalendar) {
    explanation.push(
      `Holidays checked against the bundled ${pack.stateName} calendar: ${stateHolidaySource(jurisdiction)}.`,
    );
    const serviceYear = Number(serviceDate.slice(0, 4));
    const coverage = stateHolidayCoverageWarning(jurisdiction, [serviceYear, serviceYear + 1]);
    if (coverage) warnings.push(coverage);
  } else if (excludeHolidays) {
    warnings.push(
      `${pack.stateName} holiday exclusions were approximated with the standard federal holiday set. Verify the state's official court calendar (${pack.holidaySource.notes}).`,
    );
  }

  let expirationDate: string;

  if (unit === "court_day" || unit === "business_day") {
    let cursor = serviceDate;
    let counted = 0;
    if (!startsDayAfter) {
      // Counting starts on the service day itself (if it is a countable day).
      const weekendOnService = basis.excludeWeekends && isWeekend(cursor);
      const holidayOnService = excludeHolidays ? holidayFor(cursor) : null;
      if (weekendOnService) {
        excludedDates.push({ date: cursor, reason: "weekend" });
        explanation.push(`${cursor}: weekend — not counted.`);
      } else if (holidayOnService) {
        excludedDates.push({ date: cursor, reason: "holiday", name: holidayOnService.name });
        explanation.push(`${cursor}: holiday (${holidayOnService.name}) — not counted.`);
      } else {
        counted = 1;
        explanation.push(`${cursor}: service day counted as day 1 of ${periodDays}.`);
      }
    }
    while (counted < periodDays) {
      cursor = addDays(cursor, 1);
      if (basis.excludeWeekends && isWeekend(cursor)) {
        excludedDates.push({ date: cursor, reason: "weekend" });
        explanation.push(`${cursor}: weekend — not counted.`);
        continue;
      }
      const holiday = excludeHolidays ? holidayFor(cursor) : null;
      if (holiday) {
        excludedDates.push({ date: cursor, reason: "holiday", name: holiday.name });
        explanation.push(`${cursor}: holiday (${holiday.name}) — not counted.`);
        continue;
      }
      counted += 1;
      explanation.push(`${cursor}: counted as day ${counted} of ${periodDays}.`);
    }
    expirationDate = cursor;
  } else {
    // calendar_day
    let cursor = addDays(serviceDate, startsDayAfter ? periodDays : periodDays - 1);
    explanation.push(
      startsDayAfter
        ? `${cursor}: ${periodDays} calendar days after service (day after service is day 1).`
        : `${cursor}: ${periodDays} calendar days counting the service day as day 1.`,
    );
    if (pack.dateCount.movesToNextOpenCourtDayIfDeadlineClosed) {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (isWeekend(cursor)) {
          excludedDates.push({ date: cursor, reason: "weekend" });
          explanation.push(`${cursor}: weekend — deadline rolls forward.`);
          cursor = addDays(cursor, 1);
          continue;
        }
        const holiday = holidayFor(cursor);
        if (holiday) {
          excludedDates.push({ date: cursor, reason: "holiday", name: holiday.name });
          explanation.push(`${cursor}: holiday (${holiday.name}) — deadline rolls forward.`);
          cursor = addDays(cursor, 1);
          continue;
        }
        break;
      }
    } else if (
      isWeekend(cursor) ||
      (bundledCalendar
        ? getStateHoliday(jurisdiction, cursor, stateCustom)
        : getFederalHoliday(cursor, stateCustom))
    ) {
      warnings.push(
        `The deadline (${cursor}) lands on a weekend or holiday and the ${pack.stateName} rule pack does not confirm whether it moves to the next open day. Verify with the statute or a licensed attorney.`,
      );
    }
    expirationDate = cursor;
  }

  explanation.push(`Deadline: end of day ${expirationDate}.`);
  if (np.prerequisites.length > 0) {
    explanation.push(
      `Pre-filing prerequisites apply in ${pack.stateName}: ${np.prerequisites.map((p) => p.replace(/_/g, " ")).join("; ")}.`,
    );
  }

  return {
    serviceDate,
    noticeType,
    jurisdiction,
    countedDays: periodDays,
    excludedDates,
    expirationDate,
    explanation,
    warnings,
    disclaimer: GENERIC_DISCLAIMER,
  };
}
