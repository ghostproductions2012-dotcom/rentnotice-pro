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
import { ELECTRONIC_SERVICE_METHODS, SERVICE_METHOD_LABELS, formatCents } from "../types";
import { monthBounds } from "./dateUtils";
import { getNoticeTypeRule, isLargeRentIncrease } from "./noticeRules";
import {
  HI_MEDIATION_EFFECTIVE_DATE,
  PREREQUISITE_LABELS,
  getRulePack,
  matchLocalOverlays,
} from "./rulepacks";
import type { RulePackServiceMethod, StateRulePack } from "./rulepacks";

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
  /**
   * Recorded attorney approval of the notice's jurisdiction rule pack
   * (persisted in the local db; see state_rule_reviews). When present,
   * unverified-rule issues reference the approval and downgrade accordingly.
   */
  stateRuleReview?: {
    reviewerName: string;
    reviewedAt: string;
    notes?: string;
  } | null;
  /**
   * Today's date (ISO, YYYY-MM-DD) for date-conditioned rules such as the
   * Hawaii mediation prerequisite. Defaults to the current date.
   */
  today?: string;
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
    if (nonRentIncluded) {
      // Hard block only in the rent-only strict states (CA, AK, MA, FL per
      // the research pack); elsewhere the rent-only default remains and the
      // user can acknowledge (attest) after review.
      const strictRentOnly =
        getRulePack(notice.jurisdiction)?.nonpayment.rentOnlyEnforcement === "hard_block";
      add(
        "non_rent_included",
        strictRentOnly ? "blocker" : "warning",
        strictRentOnly
          ? "The notice amount includes charges classified as non-rent."
          : "The notice amount includes charges classified as non-rent. This state is not marked rent-only strict — review the classification and acknowledge only if the demand is legally permitted.",
        null,
      );
    }

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

  if (notice.jurisdiction && notice.jurisdiction.toUpperCase() !== "CA") {
    if (ctx.stateRuleReview) {
      add(
        "jurisdiction_attorney_approved",
        "warning",
        `The ${notice.jurisdiction} rules were attorney-approved by ${ctx.stateRuleReview.reviewerName} on ${ctx.stateRuleReview.reviewedAt}. Confirm the approval is still current before serving.`,
        "jurisdiction",
      );
    } else {
      add(
        "jurisdiction_not_reviewed",
        "warning",
        `Templates and rules for ${notice.jurisdiction} require attorney review before use. No attorney approval is recorded for this state — record one on the State Rules page once reviewed.`,
        "jurisdiction",
      );
    }
  }

  // Civ. Code §827(b)(2): a cumulative rent increase greater than 10% within
  // 12 months requires at least 90 days' notice (the deadline calculator
  // applies the 90-day period automatically when this context is present).
  // Compared against the tenant's scheduled rent.
  if (
    notice.noticeType === "rent_increase" &&
    notice.rentIncreaseNewAmountCents != null &&
    ctx.tenant?.monthlyRentCents != null &&
    isLargeRentIncrease(notice.rentIncreaseNewAmountCents, ctx.tenant.monthlyRentCents)
  )
    add(
      "rent_increase_over_10_percent",
      "warning",
      `The new rent (${formatCents(notice.rentIncreaseNewAmountCents)}) exceeds a 10% increase over the tenant's scheduled rent (${formatCents(ctx.tenant.monthlyRentCents)}). California Civil Code §827(b)(2) requires at least 90 days' notice for increases over 10% — the deadline calculator applies the 90-day period, and attorney review is required before serving this notice.`,
      "rentIncreaseNewAmountCents",
    );

  // ----------------------- 50-state rule-pack checks -----------------------
  validateRulePack(ctx, add);

  // ----------------- notice-type-specific required fields ------------------
  validateTypeSpecificFields(notice, rule.requiredFields, add);

  // ------------------------- service completeness --------------------------
  validateServiceInfo(notice, ctx, add);

  const blockers = issues.filter((i) => i.level === "blocker").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { noticeId: notice.id, issues, blockers, warnings, passed: blockers === 0 };
}

type AddIssue = (code: string, level: ValidationLevel, message: string, field?: string | null) => void;

/**
 * State-pack-driven required content-field checks (research document content
 * rules). Fields that map onto structured notice data raise blockers when
 * missing; document-embedded statements (right-to-cure, mediation) raise
 * warnings to confirm the template carries the language, since the data model
 * cannot observe the rendered text.
 */
function validateRequiredContentFields(
  ctx: ValidationContext,
  pack: StateRulePack,
  add: AddIssue,
): void {
  const { notice } = ctx;
  const missing = (code: string, message: string, field: string | null) =>
    add(code, "blocker", `${pack.stateName} requires this on the notice: ${message}`, field);

  for (const field of pack.requiredContentFields) {
    switch (field) {
      case "tenant_names":
        if (!notice.tenantNames.some((n) => n.trim()))
          missing("content_tenant_names_missing", "all tenant names.", "tenantNames");
        break;
      case "property_address":
        if (!notice.propertyAddress.trim())
          missing("content_property_address_missing", "the property address.", "propertyAddress");
        break;
      case "unit_number":
        // Unit may legitimately be absent (single-family) — warning only.
        if (!notice.unit.trim())
          add(
            "content_unit_number_missing",
            "warning",
            `${pack.stateName} notices normally identify the unit — confirm the premises description is complete without one.`,
            "unit",
          );
        break;
      case "landlord_name":
        if (!ctx.property || !ctx.property.ownerName.trim())
          missing("content_landlord_name_missing", "the landlord/owner name.", "ownerName");
        break;
      case "rent_periods":
        if (notice.months.length === 0)
          missing("content_rent_periods_missing", "the rent period(s) demanded.", "months");
        break;
      case "rent_amount_due":
        if (!(notice.totalAmountCents > 0))
          missing("content_rent_amount_missing", "the rent amount due.", "totalAmountCents");
        break;
      case "payment_address":
        if (!notice.payment.paymentAddress.trim())
          missing("content_payment_address_missing", "the address where rent can be paid.", "payment.paymentAddress");
        break;
      case "payment_methods":
        if (notice.payment.acceptedMethods.length === 0)
          missing("content_payment_methods_missing", "the accepted payment methods.", "payment.acceptedMethods");
        break;
      case "office_days_hours":
        if (notice.payment.inPersonAllowed && !notice.payment.officeHours.trim())
          missing("content_office_hours_missing", "the days/hours payment can be made in person.", "payment.officeHours");
        break;
      case "deadline_date":
        // The deadline is derived from the service date; it can only be
        // required once service has been recorded.
        if (notice.service.dateServed && !notice.deadlineDate)
          missing("content_deadline_date_missing", "the computed pay-or-vacate deadline date.", "deadlineDate");
        break;
      case "right_to_cure_statement":
        add(
          "content_right_to_cure_statement",
          "warning",
          `${pack.stateName} requires a right-to-cure statement on the notice — confirm the selected template includes it.`,
          "templateId",
        );
        break;
      case "mediation_statement":
        add(
          "content_mediation_statement",
          "warning",
          `${pack.stateName} requires mediation-related language on the notice — confirm the selected template includes it.`,
          "templateId",
        );
        break;
      case "signature":
      case "date_signed":
        // Rendered on the generated document itself; nothing to check in data.
        break;
    }
  }
}

/** Map an app ServiceMethod onto the rule-pack service vocabulary. */
function toPackServiceMethod(method: string): RulePackServiceMethod {
  if (method === "substitute") return "substituted_and_mail";
  if (method === "post_and_mail") return "posting_and_mail";
  return method as RulePackServiceMethod;
}

/**
 * State rule-pack validation (50-state engine). All non-CA-specific issue
 * codes are new — existing California behavior is unchanged except that CA's
 * own pack now also drives local-overlay warnings.
 */
function validateRulePack(ctx: ValidationContext, add: AddIssue): void {
  const { notice } = ctx;
  const pack = getRulePack(notice.jurisdiction);
  const isMoneyNotice = notice.noticeType === "pay_or_quit_3day";

  if (!pack) {
    if (notice.jurisdiction)
      add(
        "rule_pack_missing",
        "blocker",
        `No rule pack exists for jurisdiction "${notice.jurisdiction}". Choose a valid US state or DC.`,
        "jurisdiction",
      );
    return;
  }

  // ---- unspecified nonpayment period (never guess) -------------------------
  if (isMoneyNotice && !pack.leaseSensitive && pack.nonpayment.periodLength == null)
    add(
      "state_period_unspecified",
      "blocker",
      `The ${pack.stateName} rule pack does not carry a verified nonpayment notice period. ${pack.nonpayment.summary} This notice cannot be finalized until the pack is verified by an attorney.${
        ctx.stateRuleReview
          ? ` An attorney approval is recorded for ${pack.state} (${ctx.stateRuleReview.reviewerName}, ${ctx.stateRuleReview.reviewedAt}), but the pack still has no notice period on file — the engine never guesses a number.`
          : ""
      }`,
      "jurisdiction",
    );

  // ---- lease-sensitive states: a rule card must be chosen ------------------
  if (isMoneyNotice && pack.leaseSensitive) {
    if (!notice.ruleCardKey) {
      add(
        "rule_card_required",
        "blocker",
        `${pack.stateName} is a lease/ground-sensitive state — there is no single statewide notice period. Select the rule card that matches this tenancy (and verify it against the lease) before finalizing.`,
        "ruleCardKey",
      );
    } else if (!pack.ruleCards.some((c) => c.key === notice.ruleCardKey)) {
      add(
        "rule_card_invalid",
        "blocker",
        `The selected rule card "${notice.ruleCardKey}" is not defined for ${pack.stateName}.`,
        "ruleCardKey",
      );
    } else {
      add(
        "rule_card_verify_lease",
        "warning",
        `${pack.stateName} rule card "${pack.ruleCards.find((c) => c.key === notice.ruleCardKey)?.label}" selected — confirm it matches the lease and the specific eviction ground.`,
        "ruleCardKey",
      );
    }
  }

  // ---- rent-only strict states ---------------------------------------------
  // non_rent_included is a blocker only in these strict states; here we also
  // surface the state-specific statute context as an explicit blocker.
  if (isMoneyNotice && pack.nonpayment.rentOnlyEnforcement === "hard_block") {
    const txns = ctx.transactions ?? [];
    const nonRentIncluded = txns.some(
      (x) => x.includedInNotice && effectiveClass(x) !== "rent",
    );
    if (nonRentIncluded)
      add(
        "rent_only_strict_state",
        "blocker",
        `${pack.stateName} is a rent-only strict state: the demanded amount cannot include late fees, utilities, damages, or other non-rent charges.`,
        null,
      );
  }

  // ---- state-required content fields ----------------------------------------
  if (isMoneyNotice) validateRequiredContentFields(ctx, pack, add);

  // ---- unverified service rules block finalization ---------------------------
  // The research is conservative: when a state's pre-suit service rules could
  // not be verified, the notice cannot be finalized (the existing admin
  // attorney-review override downgrades this to a warning).
  if (isMoneyNotice && !pack.service.verified) {
    if (ctx.stateRuleReview) {
      // A licensed attorney's approval is on record for this jurisdiction —
      // the research-pack caution downgrades to an acknowledgeable warning
      // that cites the recorded review.
      add(
        "service_rule_unverified",
        "warning",
        `The research pack could not verify ${pack.stateName}'s pre-suit service rules, but an attorney approval is recorded for ${pack.state}: reviewed by ${ctx.stateRuleReview.reviewerName} on ${ctx.stateRuleReview.reviewedAt}. Confirm the approval covers the service method used.`,
        "service.method",
      );
    } else {
      const adminOverride =
        !!ctx.settings?.allowAdminTemplateOverride && ctx.currentUserRole === "admin";
      add(
        "service_rule_unverified",
        adminOverride ? "warning" : "blocker",
        `The pre-suit service rules for ${pack.stateName} have not been verified. An attorney must confirm the permitted service methods before this notice is finalized${adminOverride ? " (admin override enabled)" : ""}.`,
        "service.method",
      );
    }
  }

  // ---- pre-filing prerequisites ---------------------------------------------
  if (isMoneyNotice) {
    for (const prereq of pack.nonpayment.prerequisites) {
      // Hawaii's mediation branch only applies to cases filed on/after the
      // effective date.
      if (prereq === "mediation_if_requested") {
        const today = ctx.today ?? new Date().toISOString().slice(0, 10);
        if (today < HI_MEDIATION_EFFECTIVE_DATE) continue;
      }
      if (!notice.prereqCompleted?.[prereq])
        add(
          `prereq_${prereq}_missing`,
          "blocker",
          `${pack.stateName} pre-filing prerequisite not completed: ${PREREQUISITE_LABELS[prereq]}.`,
          "prereqCompleted",
        );
    }
  }

  // ---- stale-statute warning (Oregon) ---------------------------------------
  if (pack.staleStatuteWarning)
    add("stale_statute_source", "warning", pack.staleStatuteWarning, "jurisdiction");

  // ---- local overlays --------------------------------------------------------
  for (const overlay of matchLocalOverlays(pack, ctx.property)) {
    add(
      "local_overlay",
      "warning",
      `Possible local overlay: ${overlay.jurisdiction} (${overlay.features.map((f) => f.replace(/_/g, " ")).join(", ")}). Local ordinances may add forms, longer periods, or just-cause requirements — verify before serving.`,
      null,
    );
  }
}

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

function validateServiceInfo(notice: Notice, ctx: ValidationContext, add: AddIssue): void {
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

  const method = service.method;
  if (!method) return;
  const pack = getRulePack(notice.jurisdiction);

  // ---- state service-method allow list ------------------------------------
  if (pack && method !== "other") {
    // Unverified service rules are already a pack-level finalization blocker
    // (see validateRulePack); here we only police the verified allow list.
    if (pack.service.verified && !pack.service.allowedMethods.includes(toPackServiceMethod(method))) {
      add(
        "service_method_not_allowed",
        "blocker",
        `${SERVICE_METHOD_LABELS[method]} is not a verified service method for ${pack.stateName}. Allowed: ${pack.service.allowedMethods.map((m) => m.replace(/_/g, " ")).join(", ")}.`,
        "service.method",
      );
    }
  }
  if (method === "other")
    add(
      "service_method_other",
      "warning",
      "An 'Other attorney-approved method' was used — attach the attorney's approval to the file.",
      "service.method",
    );

  // ---- electronic service requires documented tenant agreement --------------
  if ((ELECTRONIC_SERVICE_METHODS as string[]).includes(method)) {
    if (!notice.electronicServiceConsent) {
      add(
        "electronic_service_consent_missing",
        "blocker",
        `${SERVICE_METHOD_LABELS[method]} is only valid when the tenant agreed to electronic service. Confirm and record the tenant's agreement before serving electronically.`,
        "electronicServiceConsent",
      );
    } else {
      add(
        "electronic_service_agreed",
        "warning",
        `Electronic service (${SERVICE_METHOD_LABELS[method]}) is being used based on a recorded tenant agreement. Keep a copy of the agreement — electronic service is only authorized where the tenant consented.`,
        "service.method",
      );
    }
  }

  // ---- mail methods should carry a mailing date -----------------------------
  if (
    ["certified_mail", "registered_mail", "first_class_mail"].includes(method) &&
    !service.mailedDate &&
    !service.dateServed
  )
    add("mailing_date_missing", "warning", "A mailing date is required for mail service.", "service.mailedDate");
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
