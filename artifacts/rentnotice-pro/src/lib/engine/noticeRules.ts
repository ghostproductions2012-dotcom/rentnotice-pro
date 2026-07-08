// ---------------------------------------------------------------------------
// Per-notice-type rule metadata + 50-state rules reference.
//
// NOTICE_TYPE_RULES is keyed by the NoticeType union from ../types (the shared
// contract). Additional CA notices that the spec references but that are not in
// the NoticeType union (3-day unconditional quit, 90-day termination) are
// exposed as informational data in ADDITIONAL_CA_NOTICE_REFERENCES so the
// metadata exists without violating the type contract.
//
// STATE_RULES is a StateRuleSummary[] covering all 50 states (+ DC). Every
// non-CA jurisdiction is flagged "attorney_review_required".
// Pure, deterministic data only.
// ---------------------------------------------------------------------------

import type { NoticeType, StateRuleSummary } from "../types";
import { NOTICE_TYPE_LABELS } from "../types";

/** How a notice period's days are counted. */
export type CountingMethod = "court_days" | "calendar_days" | "calendar_hours";

export interface NoticeTypeRule {
  noticeType: NoticeType;
  label: string;
  /** Number of period units (days for day-based notices, hours for 24hr). */
  periodDays: number;
  countingMethod: CountingMethod;
  /** Saturdays/Sundays excluded from counting (court_days method). */
  weekendsExcluded: boolean;
  /** Judicial holidays excluded from counting (court_days method). */
  holidaysExcluded: boolean;
  /** Notice/entity fields that must be present for this notice type. */
  requiredFields: string[];
  /** Statutory references / citations. */
  statutoryReferences: string[];
  description: string;
}

const COMMON_FIELDS = ["tenantNames", "propertyAddress", "unit"];

export const NOTICE_TYPE_RULES: Record<NoticeType, NoticeTypeRule> = {
  pay_or_quit_3day: {
    noticeType: "pay_or_quit_3day",
    label: NOTICE_TYPE_LABELS.pay_or_quit_3day,
    periodDays: 3,
    countingMethod: "court_days",
    weekendsExcluded: true,
    holidaysExcluded: true,
    requiredFields: [
      ...COMMON_FIELDS,
      "months",
      "totalAmountCents",
      "payment.payToName",
      "payment.paymentAddress",
      "payment.acceptedMethods",
    ],
    statutoryReferences: ["Cal. Code Civ. Proc. §1161(2)"],
    description:
      "Three days (excluding Saturdays, Sundays, and judicial holidays) to pay rent-only amounts due or surrender possession.",
  },
  perform_covenant_3day: {
    noticeType: "perform_covenant_3day",
    label: NOTICE_TYPE_LABELS.perform_covenant_3day,
    periodDays: 3,
    countingMethod: "court_days",
    weekendsExcluded: true,
    holidaysExcluded: true,
    requiredFields: [...COMMON_FIELDS, "covenantDescription"],
    statutoryReferences: ["Cal. Code Civ. Proc. §1161(3)"],
    description:
      "Three days (excluding Saturdays, Sundays, and judicial holidays) to cure a curable lease violation or surrender possession.",
  },
  entry_24hr: {
    noticeType: "entry_24hr",
    label: NOTICE_TYPE_LABELS.entry_24hr,
    periodDays: 24,
    countingMethod: "calendar_hours",
    weekendsExcluded: false,
    holidaysExcluded: false,
    requiredFields: [...COMMON_FIELDS, "entryDate", "entryTimeWindow", "entryReason"],
    statutoryReferences: ["Cal. Civ. Code §1954"],
    description:
      "At least 24 hours' written notice of the landlord's intent to enter the dwelling for a lawful purpose.",
  },
  termination_30day: {
    noticeType: "termination_30day",
    label: NOTICE_TYPE_LABELS.termination_30day,
    periodDays: 30,
    countingMethod: "calendar_days",
    weekendsExcluded: false,
    holidaysExcluded: false,
    requiredFields: [...COMMON_FIELDS, "terminationDate"],
    statutoryReferences: ["Cal. Code Civ. Proc. §1946", "Cal. Code Civ. Proc. §1946.1"],
    description:
      "Thirty calendar days' notice to terminate a periodic tenancy of less than one year (subject to just-cause limits under AB 1482).",
  },
  termination_60day: {
    noticeType: "termination_60day",
    label: NOTICE_TYPE_LABELS.termination_60day,
    periodDays: 60,
    countingMethod: "calendar_days",
    weekendsExcluded: false,
    holidaysExcluded: false,
    requiredFields: [...COMMON_FIELDS, "terminationDate"],
    statutoryReferences: ["Cal. Code Civ. Proc. §1946.1"],
    description:
      "Sixty calendar days' notice to terminate a periodic tenancy where a tenant has resided in the unit for one year or more.",
  },
  rent_increase: {
    noticeType: "rent_increase",
    label: NOTICE_TYPE_LABELS.rent_increase,
    periodDays: 30,
    countingMethod: "calendar_days",
    weekendsExcluded: false,
    holidaysExcluded: false,
    requiredFields: [
      ...COMMON_FIELDS,
      "rentIncreaseNewAmountCents",
      "rentIncreaseEffectiveDate",
    ],
    statutoryReferences: ["Cal. Civ. Code §827", "Cal. Civ. Code §1947.12 (AB 1482)"],
    description:
      "Thirty days' notice for rent increases of 10% or less within 12 months; ninety days' notice when the cumulative increase exceeds 10% (verify AB 1482 caps).",
  },
};

export function getNoticeTypeRule(noticeType: NoticeType): NoticeTypeRule {
  return NOTICE_TYPE_RULES[noticeType];
}

/**
 * Cal. Civ. Code §827(b)(2): a rent increase greater than 10% (cumulative
 * within 12 months) requires at least 90 days' notice instead of 30.
 */
export const RENT_INCREASE_LARGE_PERIOD_DAYS = 90;

/**
 * True when a proposed new rent exceeds a 10% increase over the tenant's
 * scheduled rent, triggering the 90-day notice period under §827(b)(2).
 * Returns false when either amount is missing or the current rent is not
 * positive (the standard 30-day rule then applies).
 */
export function isLargeRentIncrease(
  newRentCents: number | null | undefined,
  currentRentCents: number | null | undefined,
): boolean {
  // Integer-safe "new > current * 1.1" — avoids float/rounding errors on
  // non-round cent values (e.g. 1999 → 2199 is over 10% and must qualify).
  return (
    newRentCents != null &&
    currentRentCents != null &&
    currentRentCents > 0 &&
    newRentCents * 10 > currentRentCents * 11
  );
}

/**
 * CA notices referenced by the spec that are outside the NoticeType contract.
 * Provided as informational metadata only.
 */
export interface ReferenceNoticeRule {
  key: string;
  label: string;
  periodDays: number;
  countingMethod: CountingMethod;
  statutoryReferences: string[];
  description: string;
}

export const ADDITIONAL_CA_NOTICE_REFERENCES: ReferenceNoticeRule[] = [
  {
    key: "unconditional_quit_3day",
    label: "3-Day Notice to Quit (Unconditional)",
    periodDays: 3,
    countingMethod: "court_days",
    statutoryReferences: ["Cal. Code Civ. Proc. §1161(4)"],
    description:
      "Three days to surrender possession for incurable violations (nuisance, waste, unlawful use, or subletting); no opportunity to cure.",
  },
  {
    key: "termination_90day",
    label: "90-Day Notice of Termination",
    periodDays: 90,
    countingMethod: "calendar_days",
    statutoryReferences: ["Cal. Code Civ. Proc. §1161b", "42 U.S.C. §1437f (Section 8)"],
    description:
      "Ninety calendar days' notice used for certain subsidized (e.g., Section 8) tenancies and post-foreclosure situations.",
  },
];

// ------------------------------- 50-state data ------------------------------

function stateRule(
  stateCode: string,
  stateName: string,
  payOrQuitDays: number,
  cite: string,
  notes: string,
): StateRuleSummary {
  return {
    stateCode,
    stateName,
    payOrQuitDays,
    countingRule: `${payOrQuitDays} day(s)' notice for nonpayment (calendar days unless the statute provides otherwise). ${cite}`,
    weekendsExcluded: false,
    holidaysExcluded: false,
    templateStatus: "attorney_review_required",
    notes: `${notes} Verify current statute; attorney review required before use.`,
  };
}

const CALIFORNIA_RULE: StateRuleSummary = {
  stateCode: "CA",
  stateName: "California",
  payOrQuitDays: 3,
  countingRule:
    "3 days excluding Saturdays, Sundays, and judicial holidays (Cal. Code Civ. Proc. §1161(2)); the day after service is day 1.",
  weekendsExcluded: true,
  holidaysExcluded: true,
  templateStatus: "reviewed",
  notes:
    "Termination: 30 days (<1 yr) / 60 days (>=1 yr) under CCP §1946.1. Just-cause and local ordinances (e.g., Los Angeles LARSO/LAHD) may add requirements.",
};

/** All 50 states + DC. CA is attorney-reviewed; everything else requires review. */
export const STATE_RULES: StateRuleSummary[] = [
  stateRule("AL", "Alabama", 7, "Ala. Code §35-9A-421.", "Termination: 30 days month-to-month."),
  stateRule("AK", "Alaska", 7, "Alaska Stat. §34.03.220.", "Termination: 30 days month-to-month."),
  stateRule("AZ", "Arizona", 5, "Ariz. Rev. Stat. §33-1368.", "Termination: 30 days month-to-month."),
  stateRule("AR", "Arkansas", 3, "Ark. Code §18-17-701.", "Termination: 30 days (10 days week-to-week)."),
  CALIFORNIA_RULE,
  stateRule("CO", "Colorado", 10, "Colo. Rev. Stat. §13-40-104.", "Termination: 21-91 days by tenancy length."),
  stateRule("CT", "Connecticut", 3, "Conn. Gen. Stat. §47a-23.", "Termination: 3 days notice to quit."),
  stateRule("DE", "Delaware", 5, "Del. Code tit. 25 §5502.", "Termination: 60 days month-to-month."),
  stateRule("FL", "Florida", 3, "Fla. Stat. §83.56(3) (excludes weekends/holidays).", "Termination: 30 days month-to-month."),
  stateRule("GA", "Georgia", 0, "Ga. Code §44-7-50 (demand for possession).", "No statutory cure period; 60 days termination by landlord."),
  stateRule("HI", "Hawaii", 5, "Haw. Rev. Stat. §521-68.", "Termination: 45 days (landlord) month-to-month."),
  stateRule("ID", "Idaho", 3, "Idaho Code §6-303.", "Termination: 30 days month-to-month."),
  stateRule("IL", "Illinois", 5, "735 ILCS 5/9-209.", "Termination: 30 days month-to-month."),
  stateRule("IN", "Indiana", 10, "Ind. Code §32-31-1-6.", "Termination: 30 days month-to-month."),
  stateRule("IA", "Iowa", 3, "Iowa Code §562A.27.", "Termination: 30 days month-to-month."),
  stateRule("KS", "Kansas", 3, "Kan. Stat. §58-2564.", "Termination: 30 days month-to-month."),
  stateRule("KY", "Kentucky", 7, "Ky. Rev. Stat. §383.660 (URLTA counties).", "Termination: 30 days month-to-month."),
  stateRule("LA", "Louisiana", 5, "La. Code Civ. Proc. art. 4701.", "Termination: 10 days month-to-month."),
  stateRule("ME", "Maine", 7, "Me. Rev. Stat. tit. 14 §6002.", "Termination: 30 days month-to-month."),
  stateRule("MD", "Maryland", 10, "Md. Real Prop. §8-401.", "Termination: 60 days month-to-month."),
  stateRule("MA", "Massachusetts", 14, "Mass. Gen. Laws ch. 186 §11.", "Termination: rental-period notice (>=30 days)."),
  stateRule("MI", "Michigan", 7, "Mich. Comp. Laws §554.134.", "Termination: 30 days month-to-month."),
  stateRule("MN", "Minnesota", 14, "Minn. Stat. §504B.135, §504B.291.", "Termination: rental-period notice."),
  stateRule("MS", "Mississippi", 3, "Miss. Code §89-8-13.", "Termination: 30 days month-to-month."),
  stateRule("MO", "Missouri", 0, "Mo. Rev. Stat. §535.010 (immediate demand).", "Termination: 30 days (one rental period)."),
  stateRule("MT", "Montana", 3, "Mont. Code §70-24-422.", "Termination: 30 days month-to-month."),
  stateRule("NE", "Nebraska", 7, "Neb. Rev. Stat. §76-1431.", "Termination: 30 days month-to-month."),
  stateRule("NV", "Nevada", 7, "Nev. Rev. Stat. §40.253 (excludes weekends/holidays).", "Termination: 30 days month-to-month."),
  stateRule("NH", "New Hampshire", 7, "N.H. Rev. Stat. §540:3, §540:9.", "Termination: 30 days for cause."),
  stateRule("NJ", "New Jersey", 0, "N.J. Stat. §2A:18-61.1 et seq. (Anti-Eviction Act).", "No cure period for nonpayment; cause-based termination."),
  stateRule("NM", "New Mexico", 3, "N.M. Stat. §47-8-33.", "Termination: 30 days month-to-month."),
  stateRule("NY", "New York", 14, "N.Y. Real Prop. Acts Law §711.", "Termination: 30-90 days by occupancy length."),
  stateRule("NC", "North Carolina", 10, "N.C. Gen. Stat. §42-3.", "Termination: 7 days month-to-month."),
  stateRule("ND", "North Dakota", 3, "N.D. Cent. Code §47-32-01.", "Termination: 30 days month-to-month."),
  stateRule("OH", "Ohio", 3, "Ohio Rev. Code §1923.04, §5321.17.", "Termination: 30 days month-to-month."),
  stateRule("OK", "Oklahoma", 5, "Okla. Stat. tit. 41 §131.", "Termination: 30 days month-to-month."),
  stateRule("OR", "Oregon", 3, "Or. Rev. Stat. §90.394 (72-hour / 144-hour).", "Termination: 30-90 days (just cause)."),
  stateRule("PA", "Pennsylvania", 10, "68 Pa. Stat. §250.501.", "Termination: 15-30 days by lease length."),
  stateRule("RI", "Rhode Island", 5, "R.I. Gen. Laws §34-18-35.", "Termination: 30 days month-to-month."),
  stateRule("SC", "South Carolina", 5, "S.C. Code §27-40-710.", "Termination: 30 days month-to-month."),
  stateRule("SD", "South Dakota", 3, "S.D. Codified Laws §21-16-2.", "Termination: 30 days month-to-month."),
  stateRule("TN", "Tennessee", 14, "Tenn. Code §66-28-505 (URLTA counties).", "Termination: 30 days month-to-month."),
  stateRule("TX", "Texas", 3, "Tex. Prop. Code §24.005.", "Notice to vacate; lease may modify the period."),
  stateRule("UT", "Utah", 3, "Utah Code §78B-6-802.", "Termination: 15 days month-to-month."),
  stateRule("VT", "Vermont", 14, "Vt. Stat. tit. 9 §4467.", "Termination: 60-90 days by occupancy length."),
  stateRule("VA", "Virginia", 5, "Va. Code §55.1-1245.", "Termination: 30 days month-to-month."),
  stateRule("WA", "Washington", 14, "Wash. Rev. Code §59.12.030(3).", "Termination: 20 days month-to-month (just cause)."),
  stateRule("WV", "West Virginia", 0, "W. Va. Code §55-3A-1 (no cure period).", "Termination: one rental period notice."),
  stateRule("WI", "Wisconsin", 5, "Wis. Stat. §704.17.", "Termination: 28 days month-to-month."),
  stateRule("WY", "Wyoming", 3, "Wyo. Stat. §1-21-1002 to 1003.", "Termination: reasonable notice (commonly 30 days)."),
  stateRule("DC", "District of Columbia", 30, "D.C. Code §42-3505.01.", "Cause-based; 30-day cure for nonpayment; 30-90 days termination."),
];

export function getStateRule(stateCode: string): StateRuleSummary | null {
  const code = stateCode.toUpperCase();
  return STATE_RULES.find((r) => r.stateCode === code) ?? null;
}
