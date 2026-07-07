// ---------------------------------------------------------------------------
// Built-in 50-state (+ DC) pay-or-quit template data.
//
// Every non-California jurisdiction ships as a DELIBERATELY GENERIC starting
// point that is NOT attorney-reviewed (attorneyReviewed: false) — i.e. the
// attorney-review-required status per the NoticeTemplate contract in ../types.
// The body uses only merge fields produced by buildMergeFields() in
// ../documents/merge.ts, and the per-state statutory notice period + citation
// are captured in the template name and the version change-note (description).
//
// California itself is NOT included here; its attorney-reviewed templates live
// in ./ca.ts.
//
// The statutory disclaimer is composed from the LEGAL_DISCLAIMER constant in
// ../types and is never retyped here.
// ---------------------------------------------------------------------------

import { LEGAL_DISCLAIMER, type NoticeTemplate } from "../types";
import { extractMergeFields } from "../documents/merge";

const BUILT_AT = "2026-01-15T00:00:00.000Z";

// Disclaimer block: reference the shared constant; do not retype the text.
const DISCLAIMER_BLOCK = `IMPORTANT — PLEASE READ: ${LEGAL_DISCLAIMER}`;

// [stateCode, stateName, payOrQuitDays, statutoryCitation, terminationNote]
// payOrQuitDays === 0 indicates no statutory cure period (immediate/cause-based
// demand); verify current law. Data mirrors the engine's STATE_RULES reference.
type StateSeed = readonly [string, string, number, string, string];

const STATE_SEEDS: StateSeed[] = [
  ["AL", "Alabama", 7, "Ala. Code §35-9A-421.", "Termination: 30 days month-to-month."],
  ["AK", "Alaska", 7, "Alaska Stat. §34.03.220.", "Termination: 30 days month-to-month."],
  ["AZ", "Arizona", 5, "Ariz. Rev. Stat. §33-1368.", "Termination: 30 days month-to-month."],
  ["AR", "Arkansas", 3, "Ark. Code §18-17-701.", "Termination: 30 days (10 days week-to-week)."],
  ["CO", "Colorado", 10, "Colo. Rev. Stat. §13-40-104.", "Termination: 21-91 days by tenancy length."],
  ["CT", "Connecticut", 3, "Conn. Gen. Stat. §47a-23.", "Termination: 3 days' notice to quit."],
  ["DE", "Delaware", 5, "Del. Code tit. 25 §5502.", "Termination: 60 days month-to-month."],
  ["FL", "Florida", 3, "Fla. Stat. §83.56(3) (excludes weekends/holidays).", "Termination: 30 days month-to-month."],
  ["GA", "Georgia", 0, "Ga. Code §44-7-50 (demand for possession).", "No statutory cure period; 60 days landlord termination."],
  ["HI", "Hawaii", 5, "Haw. Rev. Stat. §521-68.", "Termination: 45 days (landlord) month-to-month."],
  ["ID", "Idaho", 3, "Idaho Code §6-303.", "Termination: 30 days month-to-month."],
  ["IL", "Illinois", 5, "735 ILCS 5/9-209.", "Termination: 30 days month-to-month."],
  ["IN", "Indiana", 10, "Ind. Code §32-31-1-6.", "Termination: 30 days month-to-month."],
  ["IA", "Iowa", 3, "Iowa Code §562A.27.", "Termination: 30 days month-to-month."],
  ["KS", "Kansas", 3, "Kan. Stat. §58-2564.", "Termination: 30 days month-to-month."],
  ["KY", "Kentucky", 7, "Ky. Rev. Stat. §383.660 (URLTA counties).", "Termination: 30 days month-to-month."],
  ["LA", "Louisiana", 5, "La. Code Civ. Proc. art. 4701.", "Termination: 10 days month-to-month."],
  ["ME", "Maine", 7, "Me. Rev. Stat. tit. 14 §6002.", "Termination: 30 days month-to-month."],
  ["MD", "Maryland", 10, "Md. Real Prop. §8-401.", "Termination: 60 days month-to-month."],
  ["MA", "Massachusetts", 14, "Mass. Gen. Laws ch. 186 §11.", "Termination: rental-period notice (>=30 days)."],
  ["MI", "Michigan", 7, "Mich. Comp. Laws §554.134.", "Termination: 30 days month-to-month."],
  ["MN", "Minnesota", 14, "Minn. Stat. §504B.135, §504B.291.", "Termination: rental-period notice."],
  ["MS", "Mississippi", 3, "Miss. Code §89-8-13.", "Termination: 30 days month-to-month."],
  ["MO", "Missouri", 0, "Mo. Rev. Stat. §535.010 (immediate demand).", "Termination: 30 days (one rental period)."],
  ["MT", "Montana", 3, "Mont. Code §70-24-422.", "Termination: 30 days month-to-month."],
  ["NE", "Nebraska", 7, "Neb. Rev. Stat. §76-1431.", "Termination: 30 days month-to-month."],
  ["NV", "Nevada", 7, "Nev. Rev. Stat. §40.253 (excludes weekends/holidays).", "Termination: 30 days month-to-month."],
  ["NH", "New Hampshire", 7, "N.H. Rev. Stat. §540:3, §540:9.", "Termination: 30 days for cause."],
  ["NJ", "New Jersey", 0, "N.J. Stat. §2A:18-61.1 et seq. (Anti-Eviction Act).", "No cure period for nonpayment; cause-based termination."],
  ["NM", "New Mexico", 3, "N.M. Stat. §47-8-33.", "Termination: 30 days month-to-month."],
  ["NY", "New York", 14, "N.Y. Real Prop. Acts Law §711.", "Termination: 30-90 days by occupancy length."],
  ["NC", "North Carolina", 10, "N.C. Gen. Stat. §42-3.", "Termination: 7 days month-to-month."],
  ["ND", "North Dakota", 3, "N.D. Cent. Code §47-32-01.", "Termination: 30 days month-to-month."],
  ["OH", "Ohio", 3, "Ohio Rev. Code §1923.04, §5321.17.", "Termination: 30 days month-to-month."],
  ["OK", "Oklahoma", 5, "Okla. Stat. tit. 41 §131.", "Termination: 30 days month-to-month."],
  ["OR", "Oregon", 3, "Or. Rev. Stat. §90.394 (72-hour / 144-hour).", "Termination: 30-90 days (just cause)."],
  ["PA", "Pennsylvania", 10, "68 Pa. Stat. §250.501.", "Termination: 15-30 days by lease length."],
  ["RI", "Rhode Island", 5, "R.I. Gen. Laws §34-18-35.", "Termination: 30 days month-to-month."],
  ["SC", "South Carolina", 5, "S.C. Code §27-40-710.", "Termination: 30 days month-to-month."],
  ["SD", "South Dakota", 3, "S.D. Codified Laws §21-16-2.", "Termination: 30 days month-to-month."],
  ["TN", "Tennessee", 14, "Tenn. Code §66-28-505 (URLTA counties).", "Termination: 30 days month-to-month."],
  ["TX", "Texas", 3, "Tex. Prop. Code §24.005.", "Notice to vacate; lease may modify the period."],
  ["UT", "Utah", 3, "Utah Code §78B-6-802.", "Termination: 15 days month-to-month."],
  ["VT", "Vermont", 14, "Vt. Stat. tit. 9 §4467.", "Termination: 60-90 days by occupancy length."],
  ["VA", "Virginia", 5, "Va. Code §55.1-1245.", "Termination: 30 days month-to-month."],
  ["WA", "Washington", 14, "Wash. Rev. Code §59.12.030(3).", "Termination: 20 days month-to-month (just cause)."],
  ["WV", "West Virginia", 0, "W. Va. Code §55-3A-1 (no cure period).", "Termination: one rental period notice."],
  ["WI", "Wisconsin", 5, "Wis. Stat. §704.17.", "Termination: 28 days month-to-month."],
  ["WY", "Wyoming", 3, "Wyo. Stat. §1-21-1002 to 1003.", "Termination: reasonable notice (commonly 30 days)."],
  ["DC", "District of Columbia", 30, "D.C. Code §42-3505.01.", "Cause-based; 30-day cure for nonpayment; 30-90 days termination."],
];

function periodLabel(days: number): string {
  return days === 0 ? "period set by state law" : `${days}-day cure period`;
}

function periodClause(days: number): string {
  return days === 0
    ? "within the period required by applicable state law"
    : `within ${days} day(s) after service of this notice`;
}

function stateBody(name: string, days: number, cite: string): string {
  return [
    "NOTICE TO PAY RENT OR QUIT",
    `State of {{jurisdiction}}`,
    "",
    "TO: {{tenant_names}}, and all others in possession of the premises located at:",
    "{{property_address}}",
    "",
    "PLEASE TAKE NOTICE that rent in the total amount of {{total_amount}} is now due and unpaid for the following rental period(s):",
    "",
    "{{rent_breakdown}}",
    "",
    "The amount demanded above is RENT ONLY and does not include late fees, utility charges, deposits, or other non-rent charges.",
    "",
    `You are required, ${periodClause(days)}, to PAY the total amount of rent due set forth above OR to surrender and deliver up possession of the premises to the landlord or the landlord's authorized agent.`,
    "",
    "Payment of the amount due may be made as follows:",
    "  Pay to: {{pay_to_name}}",
    "  Address: {{payment_address}}",
    "  Telephone: {{payment_phone}}",
    "  Accepted methods: {{payment_methods}}",
    "  {{office_hours_block}}",
    "",
    "If the amount demanded is not paid or possession is not delivered within the required period, the landlord may pursue the remedies available under the law of {{jurisdiction}}, which may include an action to recover possession of the premises, rent, damages, and costs as permitted by law.",
    "",
    `GENERIC TEMPLATE — ATTORNEY REVIEW REQUIRED: This is a non-jurisdiction-specific starting point for ${name}. The statutory notice period (${periodLabel(days)}), the method of counting days, service requirements, and required content vary by state and locality. Statutory reference (verify current law): ${cite} A qualified ${name} landlord-tenant attorney must review and adapt this notice before any use.`,
    "",
    "Dated: {{prepared_date}}",
    "",
    "_______________________________________",
    "{{owner_agent_name}}",
    "Owner / Authorized Agent for {{management_company}}",
    "{{company_phone}}",
    "",
    DISCLAIMER_BLOCK,
  ].join("\n");
}

function stateTemplate(seed: StateSeed): NoticeTemplate {
  const [code, name, days, cite, termination] = seed;
  const body = stateBody(name, days, cite);
  const noticeNote =
    days === 0
      ? "No statutory cure period (immediate/cause-based demand)."
      : `${days}-day statutory cure period for nonpayment.`;
  return {
    id: `st-tpl-pay-or-quit-${code.toLowerCase()}`,
    name: `${name} Notice to Pay Rent or Quit (${periodLabel(days)}) — Generic, Attorney Review Required`,
    noticeType: "pay_or_quit_3day",
    jurisdiction: code,
    locality: null,
    active: true,
    attorneyReviewed: false,
    reviewedBy: "",
    reviewDate: null,
    currentVersion: 1,
    versions: [
      {
        version: 1,
        body,
        changedBy: null,
        changedAt: BUILT_AT,
        changeNote: `${name} pay-or-quit (generic). ${noticeNote} ${cite} ${termination} Requires attorney review before use.`,
      },
    ],
    mergeFields: extractMergeFields(body),
    builtIn: true,
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
  };
}

export const STATE_TEMPLATES: NoticeTemplate[] = STATE_SEEDS.map(stateTemplate);
