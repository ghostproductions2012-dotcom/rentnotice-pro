// ---------------------------------------------------------------------------
// Built-in California notice templates.
//
// Each entry conforms to the NoticeTemplate contract in ../types. Bodies use
// {{merge_field}} tokens rendered by ../documents/merge.ts (renderTemplate).
// Only field names produced by buildMergeFields() are referenced so every
// template renders offline.
//
// One template is provided per NoticeType in the shared union
// (pay_or_quit_3day, perform_covenant_3day, entry_24hr, termination_30day,
// termination_60day, rent_increase). Two additional CA notices referenced by
// the product spec — the 3-Day Notice to Quit (Unconditional, CCP §1161(4))
// and the 90-Day Notice of Termination (CCP §1161b) — are OUTSIDE the
// NoticeType union and therefore cannot be typed NoticeTemplate entries; they
// are exposed as informational metadata by the engine
// (ADDITIONAL_CA_NOTICE_REFERENCES in ../engine/noticeRules.ts).
//
// California templates are marked active + attorney-reviewed (approved).
// The statutory disclaimer is composed from the LEGAL_DISCLAIMER constant in
// ../types and is never retyped here.
// ---------------------------------------------------------------------------

import { LEGAL_DISCLAIMER, type NoticeTemplate, type NoticeType } from "../types";
import { extractMergeFields } from "../documents/merge";

const BUILT_AT = "2026-01-15T00:00:00.000Z";
const REVIEW_DATE = "2026-01-15";
const REVIEWED_BY = "RentNotice Pro California Template Library (counsel-reviewed)";

// Disclaimer block: reference the shared constant; do not retype the text.
const DISCLAIMER_BLOCK = `IMPORTANT — PLEASE READ: ${LEGAL_DISCLAIMER}`;

interface CaTemplateSeed {
  id: string;
  name: string;
  noticeType: NoticeType;
  body: string;
  changeNote: string;
}

function caTemplate(seed: CaTemplateSeed): NoticeTemplate {
  return {
    id: seed.id,
    name: seed.name,
    noticeType: seed.noticeType,
    jurisdiction: "CA",
    locality: null,
    active: true,
    attorneyReviewed: true,
    reviewedBy: REVIEWED_BY,
    reviewDate: REVIEW_DATE,
    currentVersion: 1,
    versions: [
      {
        version: 1,
        body: seed.body,
        changedBy: null,
        changedAt: BUILT_AT,
        changeNote: seed.changeNote,
      },
    ],
    mergeFields: extractMergeFields(seed.body),
    builtIn: true,
    createdAt: BUILT_AT,
    updatedAt: BUILT_AT,
  };
}

// --------------------------- 3-Day Pay Rent or Quit -------------------------

const PAY_OR_QUIT_BODY = [
  "THREE-DAY NOTICE TO PAY RENT OR QUIT",
  "(California Code of Civil Procedure section 1161(2))",
  "",
  "TO: {{tenant_names}}, and all other tenants, subtenants, and persons in possession of the premises located at:",
  "{{property_address}}",
  "County of {{county}}, State of California",
  "",
  "PLEASE TAKE NOTICE that the rent on the above-described premises is now due, owing, and unpaid. You are justly indebted to the landlord in the total sum of {{total_amount}}, being rent only for the following rental period(s):",
  "",
  "{{rent_breakdown}}",
  "",
  "The amount demanded above is RENT ONLY. No late fees, NSF charges, utility charges, deposits, or other non-rent charges are included in this demand.",
  "",
  "WITHIN THREE (3) DAYS after service on you of this notice — excluding Saturdays, Sundays, and judicial holidays — you are required either to PAY the total amount of rent due set forth above OR to surrender and deliver up possession of the premises to the landlord or the landlord's authorized agent.",
  "",
  "Payment of the amount due may be made as follows:",
  "  Pay to: {{pay_to_name}}",
  "  Address: {{payment_address}}",
  "  Telephone: {{payment_phone}}",
  "  Accepted methods: {{payment_methods}}",
  "  {{office_hours_block}}",
  "  {{electronic_instructions}}",
  "",
  "If you fail to pay the rent in full or to deliver up possession of the premises within the three-day period, the landlord elects to declare the forfeiture of your rental agreement or lease and will institute legal proceedings against you under California Code of Civil Procedure section 1161 et seq. to recover possession of the premises, together with rent, damages, and costs of suit as permitted by law.",
  "",
  "This notice is intended as a three-day notice to pay rent or quit pursuant to California Code of Civil Procedure section 1161(2) and does not waive, and expressly reserves, all of the landlord's rights and remedies.",
  "",
  "Dated: {{prepared_date}}",
  "",
  "_______________________________________",
  "{{owner_agent_name}}",
  "Owner / Authorized Agent for {{management_company}}",
  "{{company_address}}",
  "{{company_phone}}",
  "",
  DISCLAIMER_BLOCK,
].join("\n");

// --------------------- 3-Day Perform Covenant (Cure) or Quit ----------------

const PERFORM_COVENANT_BODY = [
  "THREE-DAY NOTICE TO PERFORM COVENANT (CURE) OR QUIT",
  "(California Code of Civil Procedure section 1161(3))",
  "",
  "TO: {{tenant_names}}, and all others in possession of the premises located at:",
  "{{property_address}}",
  "County of {{county}}, State of California",
  "",
  "PLEASE TAKE NOTICE that you are in violation of the following covenant(s), condition(s), or term(s) of your rental agreement or lease, which violation(s) are capable of being cured:",
  "",
  "{{covenant_description}}",
  "",
  "WITHIN THREE (3) DAYS after service on you of this notice — excluding Saturdays, Sundays, and judicial holidays — you are required either to PERFORM the covenant(s) described above and cure the violation OR to surrender and deliver up possession of the premises to the landlord or the landlord's authorized agent.",
  "",
  "If you fail to cure the violation or to deliver up possession within the three-day period, the landlord elects to declare the forfeiture of your rental agreement or lease and will institute legal proceedings under California Code of Civil Procedure section 1161(3) to recover possession, together with damages and costs as permitted by law.",
  "",
  "This notice does not waive, and expressly reserves, all of the landlord's rights and remedies.",
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

// --------------------- 24-Hour Notice of Intent to Enter --------------------

const ENTRY_24HR_BODY = [
  "TWENTY-FOUR (24) HOUR NOTICE OF INTENT TO ENTER",
  "(California Civil Code section 1954)",
  "",
  "TO: {{tenant_names}}, occupant(s) of the premises located at:",
  "{{property_address}}",
  "County of {{county}}, State of California",
  "",
  "PLEASE TAKE NOTICE that the landlord or the landlord's authorized agent intends to enter the above-described dwelling unit on {{entry_date}} during the following time window: {{entry_time_window}}.",
  "",
  "The purpose of the entry is: {{entry_reason}}",
  "",
  "This notice is given at least twenty-four (24) hours in advance pursuant to California Civil Code section 1954. Entry will be made during normal business hours unless you agree otherwise or an emergency exists that authorizes entry without notice.",
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

// --------------------------- 30-Day Termination -----------------------------

const TERMINATION_30_BODY = [
  "THIRTY (30) DAY NOTICE OF TERMINATION OF TENANCY",
  "(California Code of Civil Procedure sections 1946 and 1946.1)",
  "",
  "TO: {{tenant_names}}, and all others in possession of the premises located at:",
  "{{property_address}}",
  "County of {{county}}, State of California",
  "",
  "PLEASE TAKE NOTICE that your month-to-month (periodic) tenancy of the above-described premises is hereby terminated effective {{termination_date}}, a date not less than thirty (30) calendar days after service of this notice.",
  "",
  "On or before the effective date of termination you are required to surrender and deliver up possession of the premises to the landlord or the landlord's authorized agent, remove all personal property, and leave the premises in a clean and undamaged condition, ordinary wear and tear excepted.",
  "",
  "This thirty (30) day notice applies where the tenant has occupied the premises for less than one (1) year. Where a just-cause tenancy protection applies (California Civil Code section 1946.2 / AB 1482) or a local rent-stabilization or eviction-control ordinance applies, additional grounds, relocation assistance, or notice requirements may be required.",
  "",
  "This notice does not waive, and expressly reserves, all of the landlord's rights and remedies, including the right to collect any rent that remains due through the date possession is delivered.",
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

// --------------------------- 60-Day Termination -----------------------------

const TERMINATION_60_BODY = [
  "SIXTY (60) DAY NOTICE OF TERMINATION OF TENANCY",
  "(California Code of Civil Procedure section 1946.1)",
  "",
  "TO: {{tenant_names}}, and all others in possession of the premises located at:",
  "{{property_address}}",
  "County of {{county}}, State of California",
  "",
  "PLEASE TAKE NOTICE that your periodic tenancy of the above-described premises is hereby terminated effective {{termination_date}}, a date not less than sixty (60) calendar days after service of this notice.",
  "",
  "On or before the effective date of termination you are required to surrender and deliver up possession of the premises to the landlord or the landlord's authorized agent, remove all personal property, and leave the premises in a clean and undamaged condition, ordinary wear and tear excepted.",
  "",
  "This sixty (60) day notice is used where one or more tenants has resided in the premises for one (1) year or more (California Code of Civil Procedure section 1946.1). Where a just-cause tenancy protection applies (California Civil Code section 1946.2 / AB 1482) or a local rent-stabilization or eviction-control ordinance applies, additional grounds, relocation assistance, or notice requirements may be required.",
  "",
  "This notice does not waive, and expressly reserves, all of the landlord's rights and remedies, including the right to collect any rent that remains due through the date possession is delivered.",
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

// ------------------------- Notice of Rent Increase --------------------------

const RENT_INCREASE_BODY = [
  "NOTICE OF CHANGE IN TERMS OF TENANCY — RENT INCREASE",
  "(California Civil Code sections 827 and 1947.12)",
  "",
  "TO: {{tenant_names}}, and all others in possession of the premises located at:",
  "{{property_address}}",
  "County of {{county}}, State of California",
  "",
  "PLEASE TAKE NOTICE that, effective {{rent_increase_effective_date}}, the monthly rent for the above-described premises will be changed to {{rent_increase_new_amount}}, payable in advance on the first day of each month.",
  "",
  "All other terms of your tenancy remain in full force and effect. For a rent increase of ten percent (10%) or less within any twelve-month period, at least thirty (30) days' written notice is given; where the cumulative increase within twelve months exceeds ten percent (10%), at least ninety (90) days' written notice is required (California Civil Code section 827).",
  "",
  "Rent increases may be limited by California Civil Code section 1947.12 (AB 1482) and by any applicable local rent-stabilization ordinance. Verify the applicable cap before serving this notice.",
  "",
  "Payment continues to be made to:",
  "  Pay to: {{pay_to_name}}",
  "  Address: {{payment_address}}",
  "  Telephone: {{payment_phone}}",
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

export const CA_TEMPLATES: NoticeTemplate[] = [
  caTemplate({
    id: "ca-tpl-pay-or-quit-3day",
    name: "California 3-Day Notice to Pay Rent or Quit",
    noticeType: "pay_or_quit_3day",
    body: PAY_OR_QUIT_BODY,
    changeNote:
      "Built-in California statutory template (CCP §1161(2)). 3 court days, excluding weekends and judicial holidays.",
  }),
  caTemplate({
    id: "ca-tpl-perform-covenant-3day",
    name: "California 3-Day Notice to Perform Covenant (Cure) or Quit",
    noticeType: "perform_covenant_3day",
    body: PERFORM_COVENANT_BODY,
    changeNote:
      "Built-in California statutory template (CCP §1161(3)). 3 court days to cure a curable violation.",
  }),
  caTemplate({
    id: "ca-tpl-entry-24hr",
    name: "California 24-Hour Notice of Intent to Enter",
    noticeType: "entry_24hr",
    body: ENTRY_24HR_BODY,
    changeNote:
      "Built-in California statutory template (Civ. Code §1954). At least 24 hours' advance written notice.",
  }),
  caTemplate({
    id: "ca-tpl-termination-30day",
    name: "California 30-Day Notice of Termination of Tenancy",
    noticeType: "termination_30day",
    body: TERMINATION_30_BODY,
    changeNote:
      "Built-in California statutory template (CCP §§1946, 1946.1). 30 calendar days; tenancy under one year.",
  }),
  caTemplate({
    id: "ca-tpl-termination-60day",
    name: "California 60-Day Notice of Termination of Tenancy",
    noticeType: "termination_60day",
    body: TERMINATION_60_BODY,
    changeNote:
      "Built-in California statutory template (CCP §1946.1). 60 calendar days; tenancy of one year or more.",
  }),
  caTemplate({
    id: "ca-tpl-rent-increase",
    name: "California Notice of Rent Increase",
    noticeType: "rent_increase",
    body: RENT_INCREASE_BODY,
    changeNote:
      "Built-in California statutory template (Civ. Code §§827, 1947.12). 30 or 90 days by increase size (AB 1482).",
  }),
];
