// ---------------------------------------------------------------------------
// 50-state (+ DC) legal rule packs — static, versioned reference data.
//
// Seeded from the state-by-state legal research report (version_date
// 2026-07-16). Every value the research marked "unspecified" is stored as
// null with the pack left at "attorney-review-required" — the engine never
// guesses a number. Rule packs are the source of truth for:
//   - nonpayment notice period (length + unit + counting basis)
//   - mail-extension days by service method
//   - rent-only enforcement level (hard block vs. attestation default)
//   - pre-filing prerequisites (MD notice of intent, ME info sheet,
//     HI mediation branch)
//   - allowed service methods + required proof-of-service fields
//   - required notice content fields
//   - date-count behavior (count starts day after service; roll-forward)
//   - local overlays matched against the property's city/county
//   - verification status + statutory citations for future attorney review
//
// Pure, deterministic data. Not user data — ships in the app bundle.
// ---------------------------------------------------------------------------

export type VerificationStatus =
  | "draft"
  | "source_pack_complete"
  | "attorney_review_required"
  | "approved";

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  draft: "Draft",
  source_pack_complete: "Source pack complete",
  attorney_review_required: "Attorney review required",
  approved: "Approved",
};

export type PeriodUnit = "calendar_day" | "business_day" | "court_day";

export const PERIOD_UNIT_LABELS: Record<PeriodUnit, string> = {
  calendar_day: "calendar days",
  business_day: "business days",
  court_day: "court days",
};

export interface CountingBasis {
  excludeWeekends: boolean;
  excludeStateHolidays: boolean;
  excludeCourtHolidays: boolean;
  /** Extra days added when served by mail (e.g. AK +3 certified/registered). */
  mailExtensionDays: number;
  /** Service methods (rule-pack vocabulary) that trigger the mail extension. */
  mailExtensionMethods: RulePackServiceMethod[];
}

export type Prerequisite =
  | "notice_of_intent"
  | "information_sheet"
  | "mediation_if_requested";

export const PREREQUISITE_LABELS: Record<Prerequisite, string> = {
  notice_of_intent:
    "Notice of Intent to File was sent (Maryland form DC-CV-115; 10 days to pay)",
  information_sheet:
    "Eviction Information Sheet & Mediation Request (Maine form CV-256) is attached",
  mediation_if_requested:
    "Mediation branch completed — tenant was informed and mediation occurred if the tenant requested it (Hawaii, filings on/after Feb 5, 2026)",
};

/** Research-document service-method vocabulary. */
export type RulePackServiceMethod =
  | "personal"
  | "substituted_and_mail"
  | "posting_and_mail"
  | "leave_at_residence"
  | "certified_mail"
  | "registered_mail"
  | "first_class_mail"
  | "email_if_agreed"
  | "text_if_agreed"
  | "portal_if_agreed"
  | "state_marshal"
  | "process_server"
  | "sheriff";

export type ProofField =
  | "server_name"
  | "server_age_18_plus"
  | "date_of_service"
  | "time_of_service"
  | "method_of_service"
  | "mailing_date"
  | "posting_date"
  | "recipient_name_or_description"
  | "penalty_of_perjury_statement"
  | "signature"
  | "tracking_number"
  | "attached_affidavit";

export const PROOF_FIELD_LABELS: Record<ProofField, string> = {
  server_name: "Server's name",
  server_age_18_plus: "Server age 18+ statement",
  date_of_service: "Date of service",
  time_of_service: "Time of service",
  method_of_service: "Method of service",
  mailing_date: "Mailing date",
  posting_date: "Posting date",
  recipient_name_or_description: "Recipient name or description",
  penalty_of_perjury_statement: "Penalty-of-perjury statement",
  signature: "Signature",
  tracking_number: "Tracking number",
  attached_affidavit: "Attached affidavit",
};

export type ContentField =
  | "tenant_names"
  | "property_address"
  | "unit_number"
  | "landlord_name"
  | "rent_periods"
  | "rent_amount_due"
  | "payment_address"
  | "payment_methods"
  | "office_days_hours"
  | "deadline_date"
  | "right_to_cure_statement"
  | "mediation_statement"
  | "signature"
  | "date_signed";

export interface RuleCitation {
  cite: string;
  note: string;
}

export type LocalOverlayStatus = "none_identified" | "review_required" | "implemented";

export interface LocalOverlay {
  jurisdiction: string;
  status: LocalOverlayStatus;
  features: string[];
  /** Lower-cased city names to match against the property's city. */
  matchCities: string[];
  /** Lower-cased county names to match against the property's county. */
  matchCounties: string[];
  /** True when the overlay applies to every property in the state (e.g. CT RTC). */
  statewide?: boolean;
}

/** Rule cards for lease-sensitive states (user must pick one to finalize). */
export interface RuleCard {
  key: string;
  label: string;
  description: string;
}

export const DEFAULT_RULE_CARDS: RuleCard[] = [
  {
    key: "lease_controlled_nonpayment",
    label: "Lease-controlled nonpayment",
    description:
      "The lease sets the nonpayment notice/demand terms. Verify the lease clause and use its period and form.",
  },
  {
    key: "month_to_month_nonrenewal",
    label: "Month-to-month nonrenewal",
    description:
      "Terminating a periodic tenancy on notice rather than demanding rent. Verify the statutory nonrenewal period.",
  },
  {
    key: "curable_violation",
    label: "Curable lease violation",
    description:
      "A cure-or-quit style notice for a lease violation other than nonpayment. Verify cure rights and period.",
  },
  {
    key: "statutory_just_cause",
    label: "Statutory just-cause ground",
    description:
      "A statutory ground (e.g. under an anti-eviction act) with its own notice taxonomy. Verify the ground-specific rule.",
  },
];

export interface NonpaymentRule {
  /** null = unspecified in the research; a verification flag, never a guess. */
  periodLength: number | null;
  /** null when the period itself is unspecified. */
  periodUnit: PeriodUnit | null;
  countingBasis: CountingBasis;
  rentOnly: boolean;
  /**
   * "hard_block": non-rent in the demand blocks finalization outright
   * (CA, AK, MA, FL per the research). "attest": the existing rent-only
   * default + preparer attestation flow applies.
   */
  rentOnlyEnforcement: "hard_block" | "attest";
  requiresCure: boolean;
  prerequisites: Prerequisite[];
  /** Plain-English summary of the period straight from the research matrix. */
  summary: string;
}

export interface DateCountRule {
  countStartsDayAfterService: boolean;
  movesToNextOpenCourtDayIfDeadlineClosed: boolean;
}

export interface ServiceRulePack {
  /** Methods the research confirms are allowed pre-suit. Empty = unverified. */
  allowedMethods: RulePackServiceMethod[];
  proofRequired: ProofField[];
  /** False when the research could not confirm the service rule. */
  verified: boolean;
}

export interface StateRulePack {
  state: string;
  stateName: string;
  versionDate: string;
  verificationStatus: VerificationStatus;
  nonpayment: NonpaymentRule;
  dateCount: DateCountRule;
  service: ServiceRulePack;
  requiredContentFields: ContentField[];
  /**
   * True for GA, NC, NJ, MO, TN, OR, WI, MN — no hard-coded statewide period;
   * the user must pick a rule card before finalizing.
   */
  leaseSensitive: boolean;
  ruleCards: RuleCard[];
  /** Extra engineer warning (Oregon stale-statute). */
  staleStatuteWarning: string | null;
  holidaySource: {
    strategy: "state_judiciary_calendar" | "court_admin_calendar" | "manual_annual_review";
    notes: string;
  };
  citations: RuleCitation[];
  localOverlays: LocalOverlay[];
  notes: string;
}

const VERSION_DATE = "2026-07-16";

/** Effective date of Hawaii's nonpayment mediation prerequisite. */
export const HI_MEDIATION_EFFECTIVE_DATE = "2026-02-05";

const NO_EXCLUSIONS: CountingBasis = {
  excludeWeekends: false,
  excludeStateHolidays: false,
  excludeCourtHolidays: false,
  mailExtensionDays: 0,
  mailExtensionMethods: [],
};

const BASE_CONTENT: ContentField[] = [
  "tenant_names",
  "property_address",
  "rent_amount_due",
  "deadline_date",
  "signature",
  "date_signed",
];

const BASE_PROOF: ProofField[] = [
  "server_name",
  "date_of_service",
  "method_of_service",
  "signature",
];

interface PackOverrides {
  verificationStatus?: VerificationStatus;
  nonpayment?: Partial<NonpaymentRule>;
  dateCount?: Partial<DateCountRule>;
  service?: Partial<ServiceRulePack>;
  requiredContentFields?: ContentField[];
  leaseSensitive?: boolean;
  ruleCards?: RuleCard[];
  staleStatuteWarning?: string | null;
  holidaySource?: StateRulePack["holidaySource"];
  citations?: RuleCitation[];
  localOverlays?: LocalOverlay[];
  notes?: string;
}

/** Conservative default: everything unspecified, attorney review required. */
function pack(state: string, stateName: string, o: PackOverrides): StateRulePack {
  return {
    state,
    stateName,
    versionDate: VERSION_DATE,
    verificationStatus: o.verificationStatus ?? "attorney_review_required",
    nonpayment: {
      periodLength: null,
      periodUnit: null,
      countingBasis: { ...NO_EXCLUSIONS, ...(o.nonpayment?.countingBasis ?? {}) },
      rentOnly: true,
      rentOnlyEnforcement: "attest",
      requiresCure: true,
      prerequisites: [],
      summary: "Unspecified in the sources reviewed — verify before release.",
      ...o.nonpayment,
      // countingBasis merged above; re-apply so a partial spread doesn't clobber
      ...(o.nonpayment?.countingBasis
        ? { countingBasis: { ...NO_EXCLUSIONS, ...o.nonpayment.countingBasis } }
        : {}),
    },
    dateCount: {
      countStartsDayAfterService: true,
      movesToNextOpenCourtDayIfDeadlineClosed: false,
      ...o.dateCount,
    },
    service: {
      allowedMethods: [],
      proofRequired: BASE_PROOF,
      verified: false,
      ...o.service,
    },
    requiredContentFields: o.requiredContentFields ?? BASE_CONTENT,
    leaseSensitive: o.leaseSensitive ?? false,
    ruleCards: o.ruleCards ?? (o.leaseSensitive ? DEFAULT_RULE_CARDS : []),
    staleStatuteWarning: o.staleStatuteWarning ?? null,
    holidaySource:
      o.holidaySource ?? {
        strategy: "manual_annual_review",
        notes: "Verify against the official court calendar annually.",
      },
    citations: o.citations ?? [],
    localOverlays: o.localOverlays ?? [],
    notes: o.notes ?? "",
  };
}

export const RULE_PACKS: Record<string, StateRulePack> = {
  AL: pack("AL", "Alabama", {
    nonpayment: {
      periodLength: 7,
      periodUnit: "business_day",
      countingBasis: { ...NO_EXCLUSIONS, excludeWeekends: true, excludeStateHolidays: true },
      summary: "7 business days for nonpayment.",
    },
    citations: [
      { cite: "Ala. Code §35-9A-421 (URLTA)", note: "Alabama URLTA package; verify statutory service details before release." },
    ],
    notes: "Written notice; business-day counting. Verify service details from the statute before release.",
  }),
  AK: pack("AK", "Alaska", {
    verificationStatus: "source_pack_complete",
    nonpayment: {
      periodLength: 7,
      periodUnit: "calendar_day",
      countingBasis: {
        ...NO_EXCLUSIONS,
        mailExtensionDays: 3,
        mailExtensionMethods: ["certified_mail", "registered_mail"],
      },
      rentOnlyEnforcement: "hard_block",
      summary: "7 days; add 3 days when served by registered or certified mail.",
    },
    service: {
      allowedMethods: ["personal", "posting_and_mail", "certified_mail", "registered_mail"],
      proofRequired: [...BASE_PROOF, "mailing_date", "tracking_number"],
      verified: true,
    },
    citations: [
      { cite: "Alaska Stat. §34.03.220; Alaska DOL landlord-tenant handbook", note: "Handbook gives the sample form, proof-of-service boxes, rent-only limitation (no late fees), and the 3-day mail extension." },
    ],
    notes: "Rent-only strict: the nonpayment form must state rent only — the amount does not include late fees.",
  }),
  AZ: pack("AZ", "Arizona", {
    citations: [{ cite: "Ariz. Rev. Stat. §33-1368; Arizona eviction act + court packet", note: "Period unspecified in this session; use the court packet before release." }],
  }),
  AR: pack("AR", "Arkansas", {
    citations: [{ cite: "Ark. Code §18-17-701; Arkansas AG handbook", note: "Period unspecified in this session; use AG handbook + code before release." }],
  }),
  CA: pack("CA", "California", {
    nonpayment: {
      periodLength: 3,
      periodUnit: "court_day",
      countingBasis: { ...NO_EXCLUSIONS, excludeWeekends: true, excludeCourtHolidays: true },
      rentOnlyEnforcement: "hard_block",
      summary: "3 court days, excluding Saturdays, Sundays, and judicial holidays.",
    },
    dateCount: { countStartsDayAfterService: true, movesToNextOpenCourtDayIfDeadlineClosed: true },
    service: {
      allowedMethods: ["personal", "substituted_and_mail", "posting_and_mail", "process_server"],
      proofRequired: [
        "server_name",
        "server_age_18_plus",
        "date_of_service",
        "method_of_service",
        "mailing_date",
        "recipient_name_or_description",
        "penalty_of_perjury_statement",
        "signature",
      ],
      verified: true,
    },
    requiredContentFields: [
      "tenant_names",
      "property_address",
      "unit_number",
      "rent_periods",
      "rent_amount_due",
      "payment_address",
      "payment_methods",
      "office_days_hours",
      "deadline_date",
      "signature",
      "date_signed",
    ],
    holidaySource: { strategy: "state_judiciary_calendar", notes: "Use California court holidays annually." },
    citations: [
      { cite: "Cal. Code Civ. Proc. §1161(2); California courts self-help", note: "Notice must state exact rent owed and how/where to pay; cannot ask for late fees, utilities, or damages. Proof includes penalty-of-perjury statement." },
    ],
    localOverlays: [
      {
        jurisdiction: "Los Angeles City",
        status: "review_required",
        features: ["just_cause", "no_fault_declaration", "relocation", "additional_forms"],
        matchCities: ["los angeles"],
        matchCounties: [],
      },
      {
        jurisdiction: "Los Angeles County",
        status: "review_required",
        features: ["tenant_notice_guidance", "right_to_counsel_referral"],
        matchCities: [],
        matchCounties: ["los angeles"],
      },
    ],
    notes: "Rent-only strict: the demand cannot include late fees, utilities, or damages. Many cities/counties require more detail than the statewide minimum.",
  }),
  CO: pack("CO", "Colorado", {
    citations: [{ cite: "Colorado Judicial Branch JDF forms", note: "Verify exact day count from current JDF/statute before release; mediation overlays exist." }],
    localOverlays: [
      { jurisdiction: "Denver / Boulder", status: "review_required", features: ["local_ordinance_review"], matchCities: ["denver", "boulder"], matchCounties: ["denver", "boulder"] },
    ],
  }),
  CT: pack("CT", "Connecticut", {
    nonpayment: {
      periodLength: 3,
      periodUnit: "calendar_day",
      summary: "3 full days to quit after the notice to quit.",
    },
    service: { allowedMethods: ["state_marshal"], proofRequired: BASE_PROOF, verified: true },
    citations: [
      { cite: "Conn. Gen. Stat. §47a-23; CT marshal manual", note: "Notice to quit is served formally by a state marshal. Statewide eviction Right to Counsel program." },
    ],
    localOverlays: [
      {
        jurisdiction: "Connecticut (statewide)",
        status: "review_required",
        features: ["right_to_counsel_notice"],
        matchCities: [],
        matchCounties: [],
        statewide: true,
      },
    ],
    notes: "Statewide Right to Counsel: operator screens should surface counsel/referral materials.",
  }),
  DE: pack("DE", "Delaware", {
    citations: [{ cite: "Del. Code tit. 25 §5502; JP Court landlord/tenant code", note: "Period unspecified in this session; use the JP Court package before release." }],
  }),
  DC: pack("DC", "District of Columbia", {
    citations: [{ cite: "D.C. Code §42-3505.01", note: "Not covered by the research report reviewed; existing seed indicated a 30-day cure for nonpayment. Verify before release." }],
    notes: "Not covered by the ingested research report — treated as fully unspecified pending attorney review.",
  }),
  FL: pack("FL", "Florida", {
    verificationStatus: "source_pack_complete",
    nonpayment: {
      periodLength: 3,
      periodUnit: "court_day",
      countingBasis: { ...NO_EXCLUSIONS, excludeWeekends: true, excludeCourtHolidays: true },
      rentOnlyEnforcement: "hard_block",
      summary: "3 days, excluding Saturday, Sunday, and court-observed holidays.",
    },
    dateCount: { countStartsDayAfterService: false, movesToNextOpenCourtDayIfDeadlineClosed: true },
    service: {
      allowedMethods: ["personal", "leave_at_residence", "first_class_mail", "email_if_agreed"],
      proofRequired: BASE_PROOF,
      verified: true,
    },
    requiredContentFields: [
      "tenant_names",
      "property_address",
      "rent_amount_due",
      "payment_address",
      "deadline_date",
      "signature",
      "date_signed",
    ],
    holidaySource: { strategy: "court_admin_calendar", notes: "Florida statute refers to court-observed holidays." },
    citations: [
      { cite: "Fla. Stat. §83.56(3)", note: "Explicit weekend/court-holiday exclusion; email service only if agreed under statute; partial-rent handling requires a new notice." },
    ],
    notes: "Partial payment accepted after notice requires new balance handling and sometimes a new notice.",
  }),
  GA: pack("GA", "Georgia", {
    leaseSensitive: true,
    citations: [
      { cite: "Ga. Code §44-7-50; Georgia courts + DCA handbook", note: "No universal statewide pre-suit period confidently confirmed; demand/dispossessory workflow is lease- and county-sensitive." },
    ],
    notes: "Treat as lease/demand sensitive — verify by lease and county practice.",
  }),
  HI: pack("HI", "Hawaii", {
    nonpayment: {
      periodLength: 10,
      periodUnit: "calendar_day",
      prerequisites: ["mediation_if_requested"],
      summary: "10 days' written notice; mediation prerequisite for nonpayment cases filed on/after Feb 5, 2026.",
    },
    service: {
      allowedMethods: ["personal", "certified_mail", "first_class_mail"],
      proofRequired: [...BASE_PROOF, "tracking_number"],
      verified: true,
    },
    requiredContentFields: [...BASE_CONTENT, "mediation_statement"],
    holidaySource: {
      strategy: "state_judiciary_calendar",
      notes: "Mediation prerequisite effective for nonpayment actions filed on or after 2026-02-05.",
    },
    citations: [
      { cite: "Haw. Rev. Stat. (Act eff. 2026-02-05); Hawaii Judiciary/DCCA", note: "10-day written notice plus pre-filing mediation if the tenant requests it." },
    ],
  }),
  ID: pack("ID", "Idaho", {
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days." },
    citations: [{ cite: "Idaho Code §6-303; Idaho court-assistance forms", note: "Use the court-assistance forms and service checklist." }],
  }),
  IL: pack("IL", "Illinois", {
    nonpayment: { periodLength: 5, periodUnit: "calendar_day", summary: "5 days (common statewide nonpayment form period)." },
    citations: [{ cite: "735 ILCS 5/9-209; Illinois Supreme Court forms", note: "Use approved statewide forms and retain service proof." }],
    localOverlays: [
      { jurisdiction: "Chicago area", status: "review_required", features: ["local_ordinance_review"], matchCities: ["chicago"], matchCounties: ["cook"] },
    ],
  }),
  IN: pack("IN", "Indiana", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 10, periodUnit: "calendar_day", summary: "10 days unless the parties agreed otherwise; tenant cures by full payment within the period." },
    citations: [{ cite: "Ind. Code §32-31-1-6", note: "Count the full notice period before filing." }],
  }),
  IA: pack("IA", "Iowa", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days." },
    citations: [{ cite: "Iowa Code §562A.27(2)", note: "Written notice under the cited section." }],
  }),
  KS: pack("KS", "Kansas", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days." },
    service: { allowedMethods: ["personal", "first_class_mail"], proofRequired: BASE_PROOF, verified: true },
    citations: [{ cite: "Kan. Stat. §58-2564; Kansas Judicial Council forms", note: "In-person or mail delivery forms supplied by the Judicial Council." }],
  }),
  KY: pack("KY", "Kentucky", {
    nonpayment: { periodLength: 7, periodUnit: "calendar_day", summary: "7 days." },
    citations: [{ cite: "KRS 383.660(2) (URLTA counties)", note: "Verify service under statute/local practice." }],
  }),
  LA: pack("LA", "Louisiana", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 5, periodUnit: "calendar_day", summary: "5 days to vacate after delivery of the notice to vacate; starts from delivery date." },
    dateCount: { countStartsDayAfterService: true, movesToNextOpenCourtDayIfDeadlineClosed: false },
    citations: [{ cite: "La. Code Civ. Proc. art. 4701", note: "Written notice to vacate." }],
  }),
  ME: pack("ME", "Maine", {
    verificationStatus: "source_pack_complete",
    nonpayment: {
      periodLength: 7,
      periodUnit: "calendar_day",
      prerequisites: ["information_sheet"],
      summary: "Usually 7-day (or 30-day depending on ground); residential cases must attach the court information sheet.",
    },
    citations: [
      { cite: "Me. Rev. Stat. tit. 14 §6002; Maine Judicial Branch form CV-256", note: "Serve the Notice to Quit plus the CV-256 Eviction Information Sheet and Mediation Request form in residential cases." },
    ],
  }),
  MD: pack("MD", "Maryland", {
    verificationStatus: "source_pack_complete",
    nonpayment: {
      periodLength: 10,
      periodUnit: "calendar_day",
      prerequisites: ["notice_of_intent"],
      summary: "10-day Notice of Intent to File (form DC-CV-115) before a failure-to-pay-rent complaint.",
    },
    service: {
      allowedMethods: ["first_class_mail", "posting_and_mail", "email_if_agreed", "text_if_agreed", "portal_if_agreed"],
      proofRequired: ["date_of_service", "method_of_service", "signature"],
      verified: true,
    },
    holidaySource: { strategy: "state_judiciary_calendar", notes: "Baltimore City execution/property rules handled in local overlays." },
    citations: [
      { cite: "Md. Real Prop. §8-401; form DC-CV-115", note: "Notice of intent may be mailed, taped to the door, or — if the tenant agreed — delivered by email, text, or tenant portal." },
    ],
    localOverlays: [
      { jurisdiction: "Baltimore City", status: "review_required", features: ["post_judgment_property_removal_rules"], matchCities: ["baltimore"], matchCounties: ["baltimore city"] },
    ],
  }),
  MA: pack("MA", "Massachusetts", {
    nonpayment: {
      periodLength: 14,
      periodUnit: "calendar_day",
      rentOnlyEnforcement: "hard_block",
      summary: "14-day notice to quit for nonpayment; first notice usually includes cure rights; a required form must accompany a residential nonpayment notice to quit.",
    },
    requiredContentFields: [...BASE_CONTENT, "right_to_cure_statement"],
    citations: [
      { cite: "Mass. Gen. Laws ch. 186 §11; Mass.gov / MassLegalHelp", note: "A nonpayment notice cannot demand late fees, attorney's fees, or constable fees. Cure rights can extend effect if the form is defective." },
    ],
    notes: "Rent-only strict. Deliver the notice plus the required accompanying form for residential nonpayment.",
  }),
  MI: pack("MI", "Michigan", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 7, periodUnit: "calendar_day", summary: "7 days." },
    citations: [{ cite: "Mich. Comp. Laws §554.134; SCAO Notice to Quit forms", note: "Use the SCAO forms." }],
  }),
  MN: pack("MN", "Minnesota", {
    leaseSensitive: true,
    citations: [{ cite: "Minnesota AG landlord-tenant handbook", note: "Do not hard-code a universal statewide pay-or-quit period; statute/lease/program sensitive." }],
    localOverlays: [
      { jurisdiction: "Minneapolis / St. Paul", status: "review_required", features: ["local_ordinance_review"], matchCities: ["minneapolis", "st. paul", "saint paul"], matchCounties: [] },
    ],
  }),
  MS: pack("MS", "Mississippi", {
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days, starting after receipt." },
    citations: [{ cite: "Miss. Code §89-8-13; Mississippi legal services", note: "Written notice; preserve proof of delivery." }],
  }),
  MO: pack("MO", "Missouri", {
    leaseSensitive: true,
    citations: [{ cite: "Mo. Rev. Stat. §535.010; Missouri AG", note: "No single statewide pre-suit period confidently confirmed for all residential nonpayment cases; local practice varies." }],
    localOverlays: [
      { jurisdiction: "Kansas City", status: "review_required", features: ["right_to_counsel_program"], matchCities: ["kansas city"], matchCounties: [] },
    ],
  }),
  MT: pack("MT", "Montana", {
    nonpayment: { periodLength: 10, periodUnit: "calendar_day", summary: "10 days for past-due rent." },
    citations: [{ cite: "Mont. Code (per Montana court forms and MLSA packets)", note: "Use Montana court forms and MLSA packets." }],
  }),
  NE: pack("NE", "Nebraska", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days." },
    citations: [{ cite: "Neb. Rev. Stat. §76-1431; Nebraska Judicial Branch materials", note: "Renter/landlord materials from the Judicial Branch." }],
  }),
  NV: pack("NV", "Nevada", {
    citations: [{ cite: "Nevada summary-eviction/self-help packet", note: "Period not confidently confirmed; judicial days likely matter — verify before release. County self-help variations matter." }],
    localOverlays: [
      { jurisdiction: "Clark County / Washoe County", status: "review_required", features: ["county_self_help_variations"], matchCities: ["las vegas", "reno"], matchCounties: ["clark", "washoe"] },
    ],
  }),
  NH: pack("NH", "New Hampshire", {
    citations: [{ cite: "N.H. Rev. Stat. §540:3, §540:9; NH Judicial Branch forms", note: "Demand for Rent and Eviction Notice supplied by the Judicial Branch; confirm the exact count from the official form before release." }],
  }),
  NJ: pack("NJ", "New Jersey", {
    leaseSensitive: true,
    ruleCards: [
      {
        key: "nonpayment_no_notice",
        label: "Nonpayment (no pre-suit notice required)",
        description:
          "In most NJ nonpayment cases no notice to cease/quit is required before filing. Verify no local or program rule requires more.",
      },
      ...DEFAULT_RULE_CARDS.filter((c) => c.key !== "lease_controlled_nonpayment"),
      {
        key: "cease_then_quit",
        label: "Lease violation (notice to cease, then notice to quit)",
        description:
          "For most non-nonpayment grounds, NJ requires a notice to cease followed by a notice to quit under the Anti-Eviction Act taxonomy.",
      },
    ],
    citations: [
      { cite: "N.J. Stat. §2A:18-61.1 et seq. (Anti-Eviction Act); NJ Courts / LSNJ", note: "Except for most nonpayment cases, the notice regime depends on the specific eviction ground." },
    ],
    localOverlays: [
      { jurisdiction: "Municipal rent control (varies)", status: "review_required", features: ["municipal_rent_control_review"], matchCities: [], matchCounties: [] },
    ],
  }),
  NM: pack("NM", "New Mexico", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days, counted from receipt/service." },
    citations: [{ cite: "N.M. Stat. §47-8-33; NM Courts forms", note: "Use the official court notice forms." }],
  }),
  NY: pack("NY", "New York", {
    nonpayment: { periodLength: 14, periodUnit: "calendar_day", summary: "State-specific rent-demand workflow; do not ship without attorney review." },
    citations: [
      { cite: "N.Y. Real Prop. Acts Law §711; NY Courts / HCR", note: "Housing-court notices vary by ground; holdover and nonpayment are distinct. Strong local and program overlays." },
    ],
    localOverlays: [
      { jurisdiction: "New York City", status: "review_required", features: ["housing_court_ecosystem", "right_to_counsel", "local_stabilization_rules"], matchCities: ["new york", "brooklyn", "bronx", "queens", "staten island", "manhattan"], matchCounties: ["kings", "bronx", "queens", "richmond", "new york"] },
    ],
    notes: "Use state-specific rent-demand / cure / termination packets; attorney review required.",
  }),
  NC: pack("NC", "North Carolina", {
    leaseSensitive: true,
    citations: [
      { cite: "N.C. Gen. Stat. §42-3; NC Courts + LawHelpNC", note: "Legal Aid shows a common 10-day nonpayment framework, while the Judicial Branch notes landlords are not always required to send an eviction notice — lease-sensitive." },
    ],
    notes: "10-day nonpayment is a common signal but must not be hard-coded; preserve the lease copy and notice proof.",
  }),
  ND: pack("ND", "North Dakota", {
    citations: [{ cite: "N.D. Cent. Code §47-32-01; ND courts eviction packet", note: "Exact statewide nonpayment count not confidently confirmed; hearings are fast (within 10 business days after filing)." }],
  }),
  OH: pack("OH", "Ohio", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "3 days, with mandatory statutory warning language printed exactly." },
    citations: [{ cite: "Ohio Rev. Code §1923.04", note: "The app should print the statutory warning exactly; statutory service rules apply." }],
  }),
  OK: pack("OK", "Oklahoma", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 5, periodUnit: "calendar_day", summary: "5 days, starting after receipt." },
    service: { allowedMethods: ["personal"], proofRequired: BASE_PROOF, verified: true },
    citations: [{ cite: "Okla. Stat. tit. 41 §131", note: "Personal service generally used under the statute." }],
  }),
  OR: pack("OR", "Oregon", {
    leaseSensitive: true,
    staleStatuteWarning:
      "Oregon's online 2025 ORS edition does not yet incorporate all changes made in the 2025 special session and the 2026 regular session. Do not rely on the static ORS edition alone — verify against current-session laws before serving any Oregon notice.",
    citations: [
      { cite: "Or. Rev. Stat. ch. 90; Oregon Legislature ORS portal warning", note: "Use current ORS plus 2026 session updates before release." },
    ],
    localOverlays: [
      { jurisdiction: "Portland", status: "review_required", features: ["just_cause", "rent_control_review"], matchCities: ["portland"], matchCounties: ["multnomah"] },
    ],
  }),
  PA: pack("PA", "Pennsylvania", {
    nonpayment: { periodLength: 10, periodUnit: "calendar_day", summary: "10 days by default for nonpayment, but lease terms can modify/waive defaults in some cases." },
    citations: [{ cite: "68 Pa. Stat. §250.501; PA legal aid", note: "Notice to Quit must be properly served; lease-sensitive defaults." }],
    localOverlays: [
      { jurisdiction: "Philadelphia", status: "review_required", features: ["rental_licensing_review", "diversion_program"], matchCities: ["philadelphia"], matchCounties: ["philadelphia"] },
    ],
    notes: "Lease can modify or waive the 10-day default in some cases — check the lease.",
  }),
  RI: pack("RI", "Rhode Island", {
    verificationStatus: "source_pack_complete",
    nonpayment: {
      periodLength: null,
      periodUnit: null,
      summary: "Nonpayment eviction is available when the tenant is 15 or more days in arrears; the workflow is statutory-form-driven rather than a simple pay-or-quit period.",
    },
    citations: [{ cite: "R.I. Gen. Laws §34-18-35; Rhode Island judiciary forms", note: "Form-driven; hearing 14–21 days after filing." }],
    notes: "Use the Rhode Island judiciary forms; the 15-day figure is an arrears threshold, not a notice period.",
  }),
  SC: pack("SC", "South Carolina", {
    citations: [{ cite: "S.C. Code §27-40-710; magistrate forms", note: "Written notice to vacate required, but the exact nonpayment waiting period should be confirmed from the lease/statute package before release." }],
  }),
  SD: pack("SD", "South Dakota", {
    citations: [{ cite: "S.D. Codified Laws §21-16-2; UJS forms", note: "Use official UJS eviction notices/affidavits; confirm the exact waiting period before release." }],
  }),
  TN: pack("TN", "Tennessee", {
    leaseSensitive: true,
    citations: [
      { cite: "Tenn. Code §66-28-505 (URLTA counties)", note: "County coverage under Tennessee's URLTA can change the rule set — attorney-review state." },
    ],
    localOverlays: [
      { jurisdiction: "Nashville", status: "review_required", features: ["local_rtc_style_services"], matchCities: ["nashville"], matchCounties: ["davidson"] },
    ],
  }),
  TX: pack("TX", "Texas", {
    verificationStatus: "source_pack_complete",
    nonpayment: { periodLength: 3, periodUnit: "calendar_day", summary: "At least 3 days' written notice to vacate unless the lease changes it." },
    citations: [
      { cite: "Tex. Prop. Code §24.005", note: "Personal delivery, posting, and mailing rules must be taken from the current §24.005 text before release; count the full contractual/statutory period." },
    ],
    notes: "The lease may modify the notice period; nonpayment cases may use pay-or-vacate or vacate-only pathways.",
  }),
  UT: pack("UT", "Utah", {
    verificationStatus: "source_pack_complete",
    nonpayment: {
      periodLength: 3,
      periodUnit: "business_day",
      countingBasis: { ...NO_EXCLUSIONS, excludeWeekends: true, excludeStateHolidays: true },
      summary: "3 business days (per the standard Utah court form).",
    },
    citations: [{ cite: "Utah Code §78B-6-802; Utah courts standard form", note: "The standard 3-day nonpayment form uses three business days." }],
  }),
  VT: pack("VT", "Vermont", {
    nonpayment: { periodLength: 14, periodUnit: "calendar_day", summary: "14 days for nonpayment; tenant may cure by paying during the notice period." },
    citations: [{ cite: "Vt. Stat. tit. 9 §4467; Vermont Law Help", note: "Count as stated in the statute/notices." }],
  }),
  VA: pack("VA", "Virginia", {
    citations: [{ cite: "Va. Code §55.1-1245 (VRLTA)", note: "Exact nonpayment notice count not confirmed from primary text this session; use the VRLTA source package before release." }],
  }),
  WA: pack("WA", "Washington", {
    nonpayment: { periodLength: 14, periodUnit: "calendar_day", summary: "14-day pay-or-vacate is the standard current signal; preserve official RCW source review before release." },
    citations: [
      { cite: "Wash. Rev. Code ch. 59.12 / 59.18", note: "RCW-based service rules; capture affidavit and mailing details; verify the statewide appointed-counsel statute separately before public release." },
    ],
    localOverlays: [
      { jurisdiction: "Seattle", status: "review_required", features: ["just_cause", "local_ordinance_review"], matchCities: ["seattle"], matchCounties: ["king"] },
    ],
  }),
  WV: pack("WV", "West Virginia", {
    citations: [{ cite: "W. Va. Code §55-3A-1 (wrongful occupation)", note: "Exact private nonpayment pre-suit period not confidently confirmed; very fast hearings — preserve proof and filing chronology." }],
  }),
  WI: pack("WI", "Wisconsin", {
    leaseSensitive: true,
    citations: [
      { cite: "Wis. Stat. §704.17; Wisconsin court instructions", note: "Notice type depends on tenancy and breach history (5-day / 14-day / 30-day) — do not hard-code one statewide number." },
    ],
  }),
  WY: pack("WY", "Wyoming", {
    citations: [{ cite: "Wyo. Stat. §1-21-1002 to 1003; Wyoming court eviction packet", note: "Exact nonpayment pre-suit period not confidently confirmed this session." }],
  }),
};

/** Look up a rule pack by 2-letter code (case-insensitive). Null if unknown. */
export function getRulePack(stateCode: string | null | undefined): StateRulePack | null {
  if (!stateCode) return null;
  return RULE_PACKS[stateCode.toUpperCase()] ?? null;
}

export const ALL_RULE_PACKS: StateRulePack[] = Object.values(RULE_PACKS).sort((a, b) =>
  a.stateName.localeCompare(b.stateName),
);

/** Lease-sensitive states requiring a rule-card selection before finalizing. */
export function isLeaseSensitive(stateCode: string | null | undefined): boolean {
  return getRulePack(stateCode)?.leaseSensitive ?? false;
}

/** Human summary of a pack's nonpayment period ("3 court days", "unspecified"). */
export function periodSummary(p: StateRulePack): string {
  const np = p.nonpayment;
  if (np.periodLength == null || np.periodUnit == null) {
    return p.leaseSensitive ? "Lease/ground-sensitive — no statewide period" : "Unspecified — verification required";
  }
  return `${np.periodLength} ${PERIOD_UNIT_LABELS[np.periodUnit]}`;
}

/**
 * Local overlays matching a property. City/county matching is case-insensitive
 * substring-free exact-ish matching; the CA Los Angeles City overlay also
 * honors the property's explicit isLosAngelesCity flag.
 */
export function matchLocalOverlays(
  p: StateRulePack | null,
  property: { city?: string; county?: string; isLosAngelesCity?: boolean } | null | undefined,
): LocalOverlay[] {
  if (!p || !property) return [];
  const city = (property.city ?? "").trim().toLowerCase();
  const county = (property.county ?? "").trim().toLowerCase();
  return p.localOverlays.filter((o) => {
    if (o.statewide) return true;
    if (
      p.state === "CA" &&
      o.jurisdiction === "Los Angeles City" &&
      property.isLosAngelesCity
    )
      return true;
    if (city && o.matchCities.includes(city)) return true;
    if (county && o.matchCounties.includes(county)) return true;
    return false;
  });
}
