// ---------------------------------------------------------------------------
// Two-level notice validation engine (spec §8).
//
// Produces the full warning/blocker catalog. Each issue has a stable `code`,
// a `level` ("warning" | "blocker"), a plain-English `message`, and a `field`
// reference. Warnings are acknowledgeable; blockers must be fixed before a
// notice can be finalized.
//
// Validates the notice + tenant + property + calculation + company profile +
// service info completeness. Pure and deterministic — all data is passed in.
// ---------------------------------------------------------------------------

import type {
  CalculationResult,
  CompanyProfile,
  LedgerTransaction,
  Notice,
  Property,
  RentClass,
  Tenant,
  ValidationIssue,
  ValidationLevel,
  ValidationResult,
} from "../types";
import { formatCents } from "../types";
import { monthBounds } from "./dateUtils";
import { getNoticeTypeRule } from "./noticeRules";

export interface ValidationContext {
  notice: Notice;
  tenant?: Tenant | null;
  property?: Property | null;
  company?: CompanyProfile | null;
  /** Pre-computed rent-only calculation (used for unapplied-payment checks). */
  calculation?: CalculationResult | null;
  /** Ledger transactions (used for non-rent-included / deposit checks). */
  transactions?: LedgerTransaction[];
  /** Other notices on file (used for duplicate detection). */
  existingNotices?: Notice[];
  /** Selected template review state. */
  template?: { attorneyReviewed: boolean } | null;
  /** Relevant app settings. */
  settings?: {
    requireAttorneyReviewedTemplate: boolean;
    allowAdminTemplateOverride: boolean;
  };
  /** Current user's role (enables admin template override). */
  currentUserRole?: string;
}

function effectiveClass(txn: LedgerTransaction): RentClass {
  return txn.userOverrideClass ?? txn.systemClass;
}

/**
 * Validate a notice and everything it depends on, returning the full catalog
 * of warnings and blockers.
 */
export function validateNotice(ctx: ValidationContext): ValidationResult {
  const { notice } = ctx;
  const issues: ValidationIssue[] = [];
  const add = (
    code: string,
    level: ValidationLevel,
    message: string,
    field: string | null = null,
  ) => {
    issues.push({ code, level, message, field, acknowledgeable: level === "warning" });
  };

  const rule = getNoticeTypeRule(notice.noticeType);
  const isPayOrQuit = notice.noticeType === "pay_or_quit_3day";

  // ------------------------- identity / party fields -----------------------
  if (!notice.tenantNames.length || notice.tenantNames.every((n) => !n.trim()))
    add("tenant_name_missing", "blocker", "Tenant name is missing.", "tenantNames");
  if (!notice.propertyAddress.trim())
    add("property_address_missing", "blocker", "Property address is missing.", "propertyAddress");
  if (!notice.unit.trim())
    add("unit_missing", "warning", "Unit number is missing.", "unit");

  if (ctx.property && !ctx.property.ownerName.trim())
    add("owner_missing", "blocker", "Owner/landlord name is missing on the property.", "ownerName");

  // Multiple tenants on file but not all named on the notice.
  if (
    ctx.tenant &&
    ctx.tenant.names.length > 1 &&
    notice.tenantNames.filter((n) => n.trim()).length < ctx.tenant.names.length
  )
    add(
      "tenant_names_partial",
      "warning",
      "Multiple tenants are on file but not all names are listed on the notice.",
      "tenantNames",
    );

  // ------------------------------ payment info -----------------------------
  if (!notice.payment.payToName.trim())
    add("payment_recipient_missing", "blocker", "Authorized payment recipient is missing.", "payment.payToName");
  if (!notice.payment.paymentAddress.trim())
    add("payment_address_missing", "blocker", "Payment address is missing.", "payment.paymentAddress");
  if (isPayOrQuit && notice.payment.acceptedMethods.length === 0)
    add("payment_methods_missing", "blocker", "Accepted payment methods are missing.", "payment.acceptedMethods");
  if (notice.payment.inPersonAllowed && !notice.payment.officeHours.trim())
    add("office_hours_missing", "blocker", "Office hours are required when in-person payment is allowed.", "payment.officeHours");
  if (notice.payment.inPersonAllowed && !notice.payment.paymentDays.trim())
    add("payment_days_missing", "blocker", "Payment days are required when in-person payment is allowed.", "payment.paymentDays");

  // ---------------------------- company profile ----------------------------
  if (!ctx.company || !ctx.company.name.trim())
    add("company_profile_missing", "warning", "Company profile name is missing.", "company.name");

  // ------------------------------ rent periods -----------------------------
  for (const m of notice.months) {
    const { start, end } = monthBounds(m.month);
    if (m.periodStart !== start)
      add("period_not_first", "blocker", `Rent period for ${m.month} does not begin on the 1st of the month.`, "months");
    if (m.periodEnd !== end)
      add("period_not_last", "blocker", `Rent period for ${m.month} does not end on the last day of the month.`, "months");
    if (m.selectedAmountCents !== m.rentOnlyBalanceCents) {
      if (m.overrideReason && m.overrideReason.trim())
        add(
          "amount_overridden",
          "warning",
          `Amount for ${m.month} was manually overridden (${formatCents(m.rentOnlyBalanceCents)} \u2192 ${formatCents(m.selectedAmountCents)}).`,
          "months",
        );
      else
        add(
          "amount_overridden_no_reason",
          "blocker",
          `Amount for ${m.month} was changed from the calculated balance without a reason.`,
          "months",
        );
    }
  }

  // ------------------------- calculation / ledger --------------------------
  const txns = ctx.transactions ?? [];
  if (txns.length > 0) {
    const nonRentIncluded = txns.some(
      (x) => x.includedInNotice && effectiveClass(x) !== "rent",
    );
    if (nonRentIncluded)
      add("non_rent_included", "blocker", "The notice amount includes charges classified as non-rent.", null);

    const depositApplied = txns.some(
      (x) => effectiveClass(x) === "deposit" && x.includedInNotice,
    );
    if (depositApplied)
      add("deposit_applied", "warning", "A security deposit is being applied \u2014 requires manual authorization and legal review.", null);
  }

  const unapplied = ctx.calculation?.unappliedPaymentsCents ?? 0;
  if (unapplied > 0)
    add(
      "unapplied_payments",
      "warning",
      `Ledger contains ${formatCents(unapplied)} in payments not clearly applied to a rent month.`,
      null,
    );

  // ----------------------------- duplicates --------------------------------
  const others = ctx.existingNotices ?? [];
  const duplicates = others.filter((n) => {
    if (n.id === notice.id) return false;
    if (n.revisedFromId === notice.id || notice.revisedFromId === n.id) return false;
    if (n.tenantId !== notice.tenantId) return false;
    if (n.unit !== notice.unit) return false;
    if (n.noticeType !== notice.noticeType) return false;
    if (["cancelled", "revised"].includes(n.status)) return false;
    // Monetary notices carry rent months → duplicate only on month overlap.
    // Non-monetary notices (entry, termination, rent increase) carry no months
    // → any active same tenant/unit/type notice is a duplicate.
    if (notice.months.length === 0 || n.months.length === 0) return true;
    return n.months.some((m) => notice.months.some((mm) => mm.month === m.month));
  });
  if (duplicates.length > 0) {
    const monthScoped = notice.months.length > 0 && duplicates.some((n) => n.months.length > 0);
    add(
      "duplicate_notice",
      "warning",
      monthScoped
        ? `A notice already exists for this tenant/unit covering the same rent month (${duplicates.length} found).`
        : `An active ${notice.noticeType.replace(/_/g, " ")} notice already exists for this tenant/unit (${duplicates.length} found).`,
      null,
    );
  }

  // ------------------------------- template --------------------------------
  if (ctx.settings?.requireAttorneyReviewedTemplate) {
    if (notice.templateId == null) {
      add("template_missing", "blocker", "No template selected for this notice.", "templateId");
    } else if (ctx.template && !ctx.template.attorneyReviewed) {
      const adminOverride =
        ctx.settings.allowAdminTemplateOverride && ctx.currentUserRole === "admin";
      add(
        "template_not_reviewed",
        adminOverride ? "warning" : "blocker",
        adminOverride
          ? "Selected template has not been marked attorney-reviewed (admin override enabled)."
          : "Selected template has not been marked attorney-reviewed.",
        "templateId",
      );
    }
  }

  // ---------------------------- amount / jurisdiction ----------------------
  if (isPayOrQuit && notice.totalAmountCents <= 0)
    add("zero_amount", "blocker", "Total demanded amount must be greater than zero.", "months");

  if (notice.jurisdiction && notice.jurisdiction.toUpperCase() !== "CA")
    add(
      "jurisdiction_not_reviewed",
      "warning",
      `Templates and rules for ${notice.jurisdiction} require attorney review before use.`,
      "jurisdiction",
    );

  // Civ. Code §827(b)(2): a cumulative rent increase greater than 10% within
  // 12 months requires at least 90 days' notice (this tool's rent-increase
  // rule computes 30 days). Compared against the tenant's scheduled rent.
  if (
    notice.noticeType === "rent_increase" &&
    notice.rentIncreaseNewAmountCents != null &&
    ctx.tenant?.monthlyRentCents != null &&
    ctx.tenant.monthlyRentCents > 0 &&
    notice.rentIncreaseNewAmountCents > Math.round(ctx.tenant.monthlyRentCents * 1.1)
  )
    add(
      "rent_increase_over_10_percent",
      "warning",
      `The new rent (${formatCents(notice.rentIncreaseNewAmountCents)}) exceeds a 10% increase over the tenant's scheduled rent (${formatCents(ctx.tenant.monthlyRentCents)}). California Civil Code §827(b)(2) requires at least 90 days' notice for increases over 10% — attorney review is required before serving this notice.`,
      "rentIncreaseNewAmountCents",
    );

  // ----------------- notice-type-specific required fields ------------------
  validateTypeSpecificFields(notice, rule.requiredFields, add);

  // ------------------------- service completeness --------------------------
  validateServiceInfo(notice, add);

  const blockers = issues.filter((i) => i.level === "blocker").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { noticeId: notice.id, issues, blockers, warnings, passed: blockers === 0 };
}

type AddIssue = (code: string, level: ValidationLevel, message: string, field?: string | null) => void;

function validateTypeSpecificFields(
  notice: Notice,
  requiredFields: string[],
  add: AddIssue,
): void {
  const has = (field: string): boolean => {
    switch (field) {
      case "covenantDescription":
        return !!notice.covenantDescription.trim();
      case "entryDate":
        return !!notice.entryDate;
      case "entryTimeWindow":
        return !!notice.entryTimeWindow.trim();
      case "entryReason":
        return !!notice.entryReason.trim();
      case "terminationDate":
        return !!notice.terminationDate;
      case "rentIncreaseNewAmountCents":
        return notice.rentIncreaseNewAmountCents != null && notice.rentIncreaseNewAmountCents > 0;
      case "rentIncreaseEffectiveDate":
        return !!notice.rentIncreaseEffectiveDate;
      case "months":
        return notice.months.length > 0;
      default:
        return true; // common fields handled above
    }
  };

  if (requiredFields.includes("covenantDescription") && !has("covenantDescription"))
    add("covenant_description_missing", "blocker", "A description of the covenant/violation is required.", "covenantDescription");
  if (requiredFields.includes("entryDate") && !has("entryDate"))
    add("entry_date_missing", "blocker", "An entry date is required for a 24-hour entry notice.", "entryDate");
  if (requiredFields.includes("entryTimeWindow") && !has("entryTimeWindow"))
    add("entry_time_missing", "warning", "An entry time window is recommended for a 24-hour entry notice.", "entryTimeWindow");
  if (requiredFields.includes("entryReason") && !has("entryReason"))
    add("entry_reason_missing", "warning", "A reason for entry is recommended for a 24-hour entry notice.", "entryReason");
  if (requiredFields.includes("terminationDate") && !has("terminationDate"))
    add("termination_date_missing", "blocker", "A termination date is required for a termination notice.", "terminationDate");
  if (requiredFields.includes("rentIncreaseNewAmountCents") && !has("rentIncreaseNewAmountCents"))
    add("rent_increase_amount_missing", "blocker", "A new rent amount is required for a rent-increase notice.", "rentIncreaseNewAmountCents");
  if (requiredFields.includes("rentIncreaseEffectiveDate") && !has("rentIncreaseEffectiveDate"))
    add("rent_increase_date_missing", "blocker", "An effective date is required for a rent-increase notice.", "rentIncreaseEffectiveDate");
  if (requiredFields.includes("months") && !has("months"))
    add("no_months_selected", "blocker", "At least one rent month must be selected.", "months");
}

function validateServiceInfo(notice: Notice, add: AddIssue): void {
  const service = notice.service;
  const servedStatuses = ["served", "mailed", "expired", "paid"];
  const requiresService = servedStatuses.includes(notice.status);
  const partiallyFilled =
    !!service.dateServed || !!service.method || !!service.servedBy.trim() || !!service.timeServed;

  if (requiresService || partiallyFilled) {
    if (!service.dateServed)
      add("service_date_missing", requiresService ? "blocker" : "warning", "Service date is missing.", "service.dateServed");
    if (!service.method)
      add("service_method_missing", requiresService ? "blocker" : "warning", "Service method is missing.", "service.method");
    if (!service.servedBy.trim())
      add("server_name_missing", "warning", "The name of the person who served the notice is missing.", "service.servedBy");
    if (service.method === "post_and_mail" && !service.mailedDate)
      add("mailing_date_missing", "warning", "A mailing date is required for post-and-mail service.", "service.mailedDate");
  }
}

// ---------------------------------------------------------------------------
// Warning acknowledgment gate (shared by the finalize service + tests).
//
// A warning is only "acknowledged" when the caller supplies BOTH a matching
// code AND a non-empty (non-whitespace) reason. This is a pure function so the
// service layer and unit tests enforce the identical rule — a direct API call
// cannot finalize a money notice with blank acknowledgment reasons.
// ---------------------------------------------------------------------------

export interface WarningAck {
  code: string;
  reason: string;
}

/** Return the subset of warning issues that are NOT validly acknowledged. */
export function unacknowledgedWarnings(
  issues: ValidationIssue[],
  acks: WarningAck[],
): ValidationIssue[] {
  return issues.filter(
    (i) =>
      i.level === "warning" &&
      !acks.some((a) => a.code === i.code && a.reason.trim().length > 0),
  );
}
