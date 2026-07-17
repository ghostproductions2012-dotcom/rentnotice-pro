// ---------------------------------------------------------------------------
// Merge-field template system. Templates store body text containing
// {{merge_field}} tokens (see NoticeTemplate.mergeFields). `renderTemplate`
// substitutes those tokens; `buildMergeFields` derives the full field map from
// a DocumentContext so any CA template can be rendered offline.
// ---------------------------------------------------------------------------

import {
  NOTICE_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  formatCents,
  type Notice,
  type PaymentMethod,
  type PaymentProfile,
} from "../types";
import type { DocumentContext } from "./context";

const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Substitute {{field}} tokens in `body` using `fields`. Unknown tokens are
 * rendered as a bracketed placeholder so missing data is obvious (never blank).
 */
export function renderTemplate(body: string, fields: Record<string, string>): string {
  return body.replace(MERGE_TOKEN, (_match, key: string) => {
    const value = fields[key];
    if (value === undefined || value === null || value === "") {
      return `[${key}]`;
    }
    return value;
  });
}

/** List the distinct merge fields referenced by a template body. */
export function extractMergeFields(body: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  MERGE_TOKEN.lastIndex = 0;
  while ((m = MERGE_TOKEN.exec(body)) !== null) {
    found.add(m[1]);
  }
  return Array.from(found);
}

// ------------------------------ date helpers -------------------------------

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Format an ISO "YYYY-MM-DD" date as "July 1, 2026" (TZ-safe, no Date()). */
export function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  const day = Number(m[3]);
  if (monthIdx < 0 || monthIdx > 11) return iso;
  return `${MONTHS[monthIdx]} ${day}, ${year}`;
}

/** Format an ISO "YYYY-MM" month as "July 2026". */
export function formatMonthLabel(month: string): string {
  const m = month.match(/^(\d{4})-(\d{2})/);
  if (!m) return month;
  const year = Number(m[1]);
  const idx = Number(m[2]) - 1;
  if (idx < 0 || idx > 11) return month;
  return `${MONTHS[idx]} ${year}`;
}

/** Today's date formatted long-form. */
export function todayLong(): string {
  const d = new Date();
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

// ------------------------------ address helpers ----------------------------

/** Build a single-line premises address from the property (falls back to snapshot). */
export function premisesAddress(ctx: DocumentContext): string {
  const p = ctx.property;
  const unit = ctx.notice.unit ? `, Unit ${ctx.notice.unit}` : "";
  if (!p) return `${ctx.notice.propertyAddress}${unit}`;
  const parts = [p.addressLine1, p.addressLine2].filter((x) => x && x.trim() !== "");
  const street = parts.join(", ");
  const cityLine = [p.city, p.state].filter(Boolean).join(", ");
  const tail = [cityLine, p.zip].filter(Boolean).join(" ");
  return [street + unit, tail].filter(Boolean).join(", ");
}

/** Format accepted payment methods as a readable list. */
export function formatPaymentMethods(methods: PaymentMethod[]): string {
  if (!methods || methods.length === 0) return "";
  return methods.map((m) => PAYMENT_METHOD_LABELS[m] ?? m).join(", ");
}

/** Build the in-person payment / office-hours block sentence. */
export function officeHoursBlock(payment: PaymentProfile): string {
  if (!payment.inPersonAllowed) {
    return "In-person payment is not accepted at the payment address.";
  }
  const bits: string[] = [];
  if (payment.officeHours) bits.push(`during office hours (${payment.officeHours})`);
  if (payment.paymentDays) bits.push(`on ${payment.paymentDays}`);
  const suffix = bits.length ? ` ${bits.join(", ")}` : "";
  return `Payment may be made in person at the address above${suffix}.`;
}

/**
 * Multi-line itemized rent breakdown for the {{rent_breakdown}} field. Phrased
 * to match real-world California reference notices, e.g.
 * "$2,395.00 due on June 1, 2026 for rent from June 1, 2026 to June 30, 2026".
 * Months are listed newest-first (matching the reference notices), including
 * fully-paid $0.00 months when they were selected onto the notice.
 */
export function rentBreakdownText(notice: Notice): string {
  if (!notice.months.length) return "(no rent periods selected)";
  return [...notice.months]
    .sort((a, b) => (a.periodStart < b.periodStart ? 1 : a.periodStart > b.periodStart ? -1 : 0))
    .map(
      (m) =>
        `${formatCents(m.selectedAmountCents)} due on ${formatLongDate(m.periodStart)} for rent from ${formatLongDate(m.periodStart)} to ${formatLongDate(m.periodEnd)}`,
    )
    .join("\n");
}

/**
 * The single-line premises description used by the reference notices, e.g.
 * "925 N. Curson Avenue (Unit 3) in West Hollywood, CA 90046".
 */
export function premisesLine(ctx: DocumentContext): string {
  const p = ctx.property;
  const unit = ctx.notice.unit ? ` (Unit ${ctx.notice.unit})` : "";
  if (!p) return `${ctx.notice.propertyAddress}${unit}`;
  const street = [p.addressLine1, p.addressLine2].filter((x) => x && x.trim() !== "").join(", ");
  const cityTail = [p.city, p.state].filter(Boolean).join(", ");
  const tail = [cityTail, p.zip].filter(Boolean).join(" ");
  return `${street}${unit}${tail ? ` in ${tail}` : ""}`;
}

/** HUD Fair Market Value limits table shown on the reference CA notices. */
export const FMV_LIMITS_2025 = [
  "Efficiency: $1,856.00",
  "1-Bedroom: $2,081.00",
  "2-Bedroom: $2,625.00",
  "3-Bedroom: $3,335.00",
  "4-Bedroom: $3,698.00",
].join("\n");

/** "Rent may be paid on the following days and times: …" value. */
export function paymentDaysTimes(payment: PaymentProfile): string {
  const bits = [payment.paymentDays, payment.officeHours].filter(
    (x) => x && x.trim() !== "",
  );
  return bits.join(", ");
}

// ------------------------------ known fields -------------------------------

/**
 * Every merge field produced by `buildMergeFields`. Keep this list in sync
 * with the keys of the object returned there — it drives editor warnings for
 * unknown tokens in template bodies.
 */
export const KNOWN_MERGE_FIELDS: readonly string[] = [
  // parties & premises
  "tenant_names",
  "property_address",
  "premises_address",
  "premises_line",
  "unit",
  "city",
  "state",
  "zip",
  "county",
  "bedrooms",
  "jurisdiction",
  // amounts / periods
  "total_amount",
  "rent_breakdown",
  "notice_days",
  // payment instructions
  "pay_to_name",
  "pay_to_person",
  "payment_address",
  "payment_phone",
  "payment_methods",
  "payment_days",
  "payment_days_times",
  "office_hours",
  "office_hours_block",
  "electronic_instructions",
  // dates
  "prepared_date",
  "served_date",
  "expires_date",
  // reference tables
  "fmv_limits_table",
  // signature / company
  "owner_agent_name",
  "management_company",
  "company_name",
  "company_address",
  "company_phone",
  "company_email",
  // notice-type specifics
  "covenant_description",
  "termination_date",
  "entry_date",
  "entry_time_window",
  "entry_reason",
  "rent_increase_new_amount",
  "rent_increase_effective_date",
  "notice_type_label",
];

/**
 * Short human-readable descriptions for each known merge field, shown in the
 * template editor's field picker. Keep keys in sync with KNOWN_MERGE_FIELDS.
 */
export const MERGE_FIELD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  // parties & premises
  tenant_names: "All tenant names, joined with \u201cand\u201d",
  property_address: "Full premises address on one line",
  premises_address: "Full premises address on one line (alias)",
  premises_line: "Premises described as \u201cstreet (Unit X) in City, ST ZIP\u201d",
  unit: "Unit number, if any",
  city: "Property city (blank line if unknown)",
  state: "Property state",
  zip: "Property ZIP code (blank line if unknown)",
  county: "Property county (blank line if unknown)",
  bedrooms: "Number of bedrooms (blank line if unknown)",
  jurisdiction: "Notice jurisdiction (state code)",
  // amounts / periods
  total_amount: "Total amount due, formatted as currency",
  rent_breakdown: "Itemized list of rent periods and amounts due",
  notice_days: "Notice period, e.g. \u201cTHREE (3)\u201d",
  // payment instructions
  pay_to_name: "Company or person rent is payable to",
  pay_to_person: "Specific person to pay, falls back to pay-to name",
  payment_address: "Address where payment is accepted",
  payment_phone: "Phone number for payment questions",
  payment_methods: "Accepted payment methods, comma-separated",
  payment_days: "Days rent may be paid",
  payment_days_times: "Payment days and office hours combined",
  office_hours: "Office hours for in-person payment",
  office_hours_block: "Full sentence about in-person payment availability",
  electronic_instructions: "Instructions for electronic payment",
  // dates
  prepared_date: "Date the notice is generated (today)",
  served_date: "Date served (blank line until service is recorded)",
  expires_date: "Compliance deadline date (blank line until set)",
  // reference tables
  fmv_limits_table: "HUD Fair Market Value limits table",
  // signature / company
  owner_agent_name: "Property owner or agent name",
  management_company: "Management company name",
  company_name: "Your company name",
  company_address: "Your company address",
  company_phone: "Your company phone number",
  company_email: "Your company email address",
  // notice-type specifics
  covenant_description: "Violated covenant description (cure/quit notices)",
  termination_date: "Tenancy termination date",
  entry_date: "Date of intended entry (entry notices)",
  entry_time_window: "Time window for entry",
  entry_reason: "Reason for entry",
  rent_increase_new_amount: "New rent amount (increase notices)",
  rent_increase_effective_date: "Date the rent increase takes effect",
  notice_type_label: "Human-readable notice type name",
};

const KNOWN_MERGE_FIELD_SET = new Set(KNOWN_MERGE_FIELDS);

/** True when `field` is produced by the merge pipeline (`buildMergeFields`). */
export function isKnownMergeField(field: string): boolean {
  return KNOWN_MERGE_FIELD_SET.has(field);
}

/**
 * Merge fields referenced by `body` that are NOT produced by the merge
 * pipeline — these would render as unfilled placeholders on a generated
 * notice.
 */
export function unknownMergeFields(body: string): string[] {
  return extractMergeFields(body).filter((f) => !isKnownMergeField(f));
}

/** Levenshtein edit distance between two strings. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/**
 * Suggest the closest known merge field for an unknown token, or null when
 * nothing is similar enough to be a plausible typo. The threshold scales with
 * the token length so short fields don't match unrelated names.
 */
export function suggestMergeField(field: string): string | null {
  const needle = field.toLowerCase();
  let best: string | null = null;
  let bestDist = Infinity;
  for (const known of KNOWN_MERGE_FIELDS) {
    const dist = editDistance(needle, known.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = known;
    }
  }
  if (best === null) return null;
  const maxAllowed = Math.max(1, Math.floor(Math.max(needle.length, best.length) / 3));
  return bestDist <= maxAllowed ? best : null;
}

/**
 * Replace every {{from}} token in `body` with {{to}}, preserving nothing of
 * the original token's inner whitespace. Used by the editor's "did you mean"
 * suggestion to fix typo'd merge fields in one click.
 */
export function replaceMergeField(body: string, from: string, to: string): string {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, "g"), `{{${to}}}`);
}

// ------------------------------ field builder ------------------------------

/**
 * Build the complete merge-field map from a DocumentContext. Covers every field
 * referenced by the built-in CA templates in ../templates-data.
 */
export function buildMergeFields(ctx: DocumentContext): Record<string, string> {
  const { notice, property, companyProfile } = ctx;
  const payment = notice.payment;
  const ownerName = property?.ownerName || companyProfile.name;
  const mgmt = property?.managementCompany || companyProfile.name;

  return {
    // parties & premises
    tenant_names: notice.tenantNames.join(" and "),
    property_address: premisesAddress(ctx),
    premises_address: premisesAddress(ctx),
    premises_line: premisesLine(ctx),
    unit: notice.unit || "",
    // Legal-form fields render as blank fill-in lines when unknown so a
    // printed notice never shows a raw "[city]" / "[county]" token.
    city: property?.city || "______________",
    state: property?.state || notice.jurisdiction || "",
    zip: property?.zip || "__________",
    county: property?.county || "______________",
    bedrooms: property?.bedrooms != null ? String(property.bedrooms) : "____",
    jurisdiction: notice.jurisdiction || "",

    // amounts / periods
    total_amount: formatCents(notice.totalAmountCents),
    rent_breakdown: rentBreakdownText(notice),
    notice_days: "THREE (3)",

    // payment instructions
    pay_to_name: payment.payToName || companyProfile.name,
    pay_to_person: payment.payToPerson || payment.payToName || companyProfile.name,
    payment_address: payment.paymentAddress || companyProfile.address,
    payment_phone: payment.phone || companyProfile.phone,
    payment_methods: formatPaymentMethods(payment.acceptedMethods),
    payment_days: payment.paymentDays,
    payment_days_times: paymentDaysTimes(payment),
    office_hours: payment.officeHours,
    office_hours_block: officeHoursBlock(payment),
    electronic_instructions: payment.electronicInstructions,

    // dates
    prepared_date: todayLong(),
    // Notices are usually generated before service, so these render as blank
    // fill-in lines (completed by hand or by regenerating after service).
    served_date: notice.service.dateServed
      ? formatLongDate(notice.service.dateServed)
      : "____________________",
    expires_date: notice.deadlineDate
      ? formatLongDate(notice.deadlineDate)
      : "____________________",

    // reference tables
    fmv_limits_table: FMV_LIMITS_2025,

    // signature / company
    owner_agent_name: ownerName,
    management_company: mgmt,
    company_name: companyProfile.name,
    company_address: companyProfile.address,
    company_phone: companyProfile.phone,
    company_email: companyProfile.email,

    // notice-type specifics
    covenant_description: notice.covenantDescription || "",
    termination_date: formatLongDate(notice.terminationDate),
    entry_date: formatLongDate(notice.entryDate),
    entry_time_window: notice.entryTimeWindow || "",
    entry_reason: notice.entryReason || "",
    rent_increase_new_amount:
      notice.rentIncreaseNewAmountCents != null
        ? formatCents(notice.rentIncreaseNewAmountCents)
        : "",
    rent_increase_effective_date: formatLongDate(notice.rentIncreaseEffectiveDate),
    notice_type_label: NOTICE_TYPE_LABELS[notice.noticeType],
  };
}
