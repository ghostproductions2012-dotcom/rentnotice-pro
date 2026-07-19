import { describe, expect, it } from "vitest";
import type { Notice, NoticeMonth, ValidationIssue, ValidationResult } from "../../types";
import { monthBounds } from "../dateUtils";
import { unacknowledgedWarnings, validateNotice, type ValidationContext } from "../validation";

function month(key: string, balanceCents: number, overrides: Partial<NoticeMonth> = {}): NoticeMonth {
  const { start, end } = monthBounds(key);
  return {
    month: key,
    periodStart: start,
    periodEnd: end,
    rentChargedCents: balanceCents,
    paymentsAppliedCents: 0,
    creditsAppliedCents: 0,
    rentOnlyBalanceCents: balanceCents,
    selectedAmountCents: balanceCents,
    overrideReason: null,
    ...overrides,
  };
}

function makeNotice(overrides: Partial<Notice> = {}): Notice {
  const months = overrides.months ?? [month("2026-06", 200000)];
  return {
    id: "n1",
    noticeType: "pay_or_quit_3day",
    jurisdiction: "CA",
    status: "draft",
    tenantId: "t1",
    propertyId: "p1",
    unit: "4B",
    tenantNames: ["Jordan Smith"],
    propertyAddress: "123 Main St, Los Angeles, CA 90001",
    ledgerId: "L1",
    months,
    totalAmountCents: months.reduce((s, m) => s + m.selectedAmountCents, 0),
    payment: {
      payToName: "Acme Property Management",
      paymentAddress: "500 Office Park Dr, Los Angeles, CA 90001",
      phone: "(213) 555-0100",
      acceptedMethods: ["personal_check", "money_order"],
      inPersonAllowed: true,
      officeHours: "Mon-Fri 9-5",
      paymentDays: "Monday through Friday",
      electronicInstructions: "",
    },
    templateId: "tpl1",
    templateVersion: 1,
    includeLahdLetter: false,
    covenantDescription: "",
    entryDate: null,
    entryTimeWindow: "",
    entryReason: "",
    terminationDate: null,
    rentIncreaseNewAmountCents: null,
    rentIncreaseEffectiveDate: null,
    version: 1,
    revisedFromId: null,
    reviewerApprovedBy: null,
    reviewerApprovedAt: null,
    finalizedBy: null,
    finalizedAt: null,
    localOverlayVerifiedBy: null,
    localOverlayVerifiedAt: null,
    attorneyExportFlag: false,
    service: {
      dateServed: null,
      timeServed: null,
      method: null,
      servedBy: "",
      serverNotes: "",
      mailedDate: null,
    },
    deadlineDate: null,
    internalNotes: "",
    preparedBy: null,
    createdAt: "2026-06-15T10:00:00.000Z",
    updatedAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

function codes(result: ValidationResult): string[] {
  return result.issues.map((i) => i.code);
}

describe("notice validation engine", () => {
  it("passes a complete, clean pay-or-quit notice", () => {
    const r = validateNotice({ notice: makeNotice() });
    expect(r.blockers).toBe(0);
    expect(r.passed).toBe(true);
  });

  it("skips the unit-number warnings for single-family properties", () => {
    const singleFamily = {
      id: "p1",
      ownerName: "Owner LLC",
      units: [],
    } as unknown as ValidationContext["property"];
    const r = validateNotice({ notice: makeNotice({ unit: "" }), property: singleFamily });
    expect(codes(r)).not.toContain("unit_missing");
    expect(codes(r)).not.toContain("content_unit_number_missing");

    const noProperty = validateNotice({ notice: makeNotice({ unit: "" }) });
    expect(codes(noProperty)).toContain("unit_missing");
  });

  it("blocks on missing tenant name and property address", () => {
    const r = validateNotice({
      notice: makeNotice({ tenantNames: [" "], propertyAddress: "" }),
    });
    expect(r.passed).toBe(false);
    expect(codes(r)).toContain("tenant_name_missing");
    expect(codes(r)).toContain("property_address_missing");
  });

  it("blocks amount overrides without a reason; warns with one", () => {
    const noReason = validateNotice({
      notice: makeNotice({ months: [month("2026-06", 200000, { selectedAmountCents: 150000 })] }),
    });
    expect(codes(noReason)).toContain("amount_overridden_no_reason");
    expect(noReason.passed).toBe(false);

    const withReason = validateNotice({
      notice: makeNotice({
        months: [
          month("2026-06", 200000, {
            selectedAmountCents: 150000,
            overrideReason: "Waived June partial per owner",
          }),
        ],
      }),
    });
    expect(codes(withReason)).toContain("amount_overridden");
    expect(withReason.issues.find((i) => i.code === "amount_overridden")!.level).toBe("warning");
  });

  it("blocks rent periods that do not span the full month", () => {
    const r = validateNotice({
      notice: makeNotice({
        months: [month("2026-06", 200000, { periodStart: "2026-06-05" })],
      }),
    });
    expect(codes(r)).toContain("period_not_first");
  });

  it("blocks zero-amount pay-or-quit notices", () => {
    const r = validateNotice({
      notice: makeNotice({
        months: [month("2026-06", 0)],
        totalAmountCents: 0,
      }),
    });
    expect(codes(r)).toContain("zero_amount");
  });

  it("warns on duplicate notices for the same tenant/unit/month", () => {
    const notice = makeNotice();
    const dupe = makeNotice({ id: "n2" });
    const r = validateNotice({ notice, existingNotices: [dupe] });
    expect(codes(r)).toContain("duplicate_notice");
    expect(r.issues.find((i) => i.code === "duplicate_notice")!.level).toBe("warning");
  });

  it("gates non-attorney-reviewed templates per settings and role", () => {
    const base: ValidationContext = {
      notice: makeNotice(),
      template: { attorneyReviewed: false },
      settings: { requireAttorneyReviewedTemplate: true, allowAdminTemplateOverride: true },
    };
    const staff = validateNotice({ ...base, currentUserRole: "staff" });
    expect(staff.issues.find((i) => i.code === "template_not_reviewed")!.level).toBe("blocker");

    const admin = validateNotice({ ...base, currentUserRole: "admin" });
    expect(admin.issues.find((i) => i.code === "template_not_reviewed")!.level).toBe("warning");
  });

  it("warns for non-CA jurisdictions pending attorney review", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "TX" }) });
    expect(codes(r)).toContain("jurisdiction_not_reviewed");
  });

  it("requires a covenant description for perform-covenant notices", () => {
    const r = validateNotice({
      notice: makeNotice({ noticeType: "perform_covenant_3day", covenantDescription: "" }),
    });
    expect(codes(r)).toContain("covenant_description_missing");
  });

  it("warns when a rent increase exceeds 10% of scheduled rent (Civ. Code §827(b)(2))", () => {
    const tenant = {
      id: "t1",
      names: ["Jordan Smith"],
      propertyId: "p1",
      unit: "4B",
      email: "",
      phone: "",
      monthlyRentCents: 200000,
      leaseStart: null,
      moveOutDate: null,
      notes: "",
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const notice = makeNotice({
      noticeType: "rent_increase",
      rentIncreaseNewAmountCents: 230000, // +15%
      rentIncreaseEffectiveDate: "2026-08-01",
    });
    const over = validateNotice({ notice, tenant });
    const issue = over.issues.find((i) => i.code === "rent_increase_over_10_percent");
    expect(issue).toBeDefined();
    expect(issue!.level).toBe("warning");
    expect(issue!.message).toMatch(/90 days/);

    const under = validateNotice({
      notice: makeNotice({
        noticeType: "rent_increase",
        rentIncreaseNewAmountCents: 215000, // +7.5%
        rentIncreaseEffectiveDate: "2026-08-01",
      }),
      tenant,
    });
    expect(codes(under)).not.toContain("rent_increase_over_10_percent");
  });

  it("requires service details once a notice is marked served", () => {
    const r = validateNotice({ notice: makeNotice({ status: "served" }) });
    expect(codes(r)).toContain("service_date_missing");
    expect(codes(r)).toContain("service_method_missing");
    expect(r.passed).toBe(false);
  });

  // --- duplicate detection for non-monetary notice types -------------------
  // Non-monetary notices carry no rent months, so month-overlap can never fire.
  // An active same tenant/unit/type notice must still be flagged as duplicate.
  const NON_MONETARY: { type: Notice["noticeType"]; extra: Partial<Notice> }[] = [
    { type: "entry_24hr", extra: { months: [], entryDate: "2026-07-10" } },
    { type: "termination_30day", extra: { months: [], terminationDate: "2026-08-15" } },
    { type: "termination_60day", extra: { months: [], terminationDate: "2026-09-15" } },
    {
      type: "rent_increase",
      extra: { months: [], rentIncreaseNewAmountCents: 210000, rentIncreaseEffectiveDate: "2026-09-01" },
    },
  ];

  for (const { type, extra } of NON_MONETARY) {
    it(`warns on a duplicate ${type} notice even though it carries no rent months`, () => {
      const notice = makeNotice({ noticeType: type, totalAmountCents: 0, ...extra });
      const dupe = makeNotice({ id: "n2", noticeType: type, totalAmountCents: 0, ...extra });
      const r = validateNotice({ notice, existingNotices: [dupe] });
      expect(codes(r)).toContain("duplicate_notice");
      expect(r.issues.find((i) => i.code === "duplicate_notice")!.level).toBe("warning");
    });

    it(`does not flag a duplicate ${type} for a different unit`, () => {
      const notice = makeNotice({ noticeType: type, totalAmountCents: 0, ...extra });
      const other = makeNotice({ id: "n2", noticeType: type, totalAmountCents: 0, unit: "9Z", ...extra });
      const r = validateNotice({ notice, existingNotices: [other] });
      expect(codes(r)).not.toContain("duplicate_notice");
    });

    it(`ignores a cancelled prior ${type} notice`, () => {
      const notice = makeNotice({ noticeType: type, totalAmountCents: 0, ...extra });
      const cancelled = makeNotice({
        id: "n2",
        noticeType: type,
        totalAmountCents: 0,
        status: "cancelled",
        ...extra,
      });
      const r = validateNotice({ notice, existingNotices: [cancelled] });
      expect(codes(r)).not.toContain("duplicate_notice");
    });
  }
});

// ---------------------------------------------------------------------------
// Warning-acknowledgment gate (shared by finalizeNotice). A warning is only
// acknowledged when the ack has a matching code AND a non-empty reason.
// ---------------------------------------------------------------------------

describe("unacknowledgedWarnings gate", () => {
  const warn = (code: string): ValidationIssue => ({
    code,
    level: "warning",
    message: `warn ${code}`,
    field: null,
    acknowledgeable: true,
  });
  const blocker: ValidationIssue = {
    code: "zero_amount",
    level: "blocker",
    message: "blocker",
    field: null,
    acknowledgeable: false,
  };

  it("treats a warning acknowledged with a non-empty reason as resolved", () => {
    const issues = [warn("unapplied_payments")];
    const acks = [{ code: "unapplied_payments", reason: "Reviewed with owner; applied manually." }];
    expect(unacknowledgedWarnings(issues, acks)).toHaveLength(0);
  });

  it("rejects a warning acknowledged with a blank reason", () => {
    const issues = [warn("unapplied_payments")];
    expect(unacknowledgedWarnings(issues, [{ code: "unapplied_payments", reason: "" }])).toHaveLength(1);
  });

  it("rejects a warning acknowledged with a whitespace-only reason", () => {
    const issues = [warn("duplicate_notice")];
    expect(unacknowledgedWarnings(issues, [{ code: "duplicate_notice", reason: "   \n\t " }])).toHaveLength(1);
  });

  it("rejects a warning with no matching acknowledgment at all", () => {
    const issues = [warn("deposit_applied")];
    expect(unacknowledgedWarnings(issues, [{ code: "unapplied_payments", reason: "ok" }])).toHaveLength(1);
  });

  it("never treats blockers as acknowledgeable warnings", () => {
    const issues = [blocker];
    expect(unacknowledgedWarnings(issues, [{ code: "zero_amount", reason: "ignore" }])).toHaveLength(0);
  });

  it("returns only the unresolved warnings when mixed", () => {
    const issues = [warn("a"), warn("b"), warn("c")];
    const acks = [
      { code: "a", reason: "valid reason" },
      { code: "b", reason: "  " },
    ];
    const out = unacknowledgedWarnings(issues, acks).map((i) => i.code);
    expect(out).toEqual(["b", "c"]);
  });
});
