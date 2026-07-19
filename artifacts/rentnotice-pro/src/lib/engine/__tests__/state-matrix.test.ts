// ---------------------------------------------------------------------------
// The research document's minimum regression matrix (task spec step 9):
// rent-only exclusion (CA/AK/MA/FL), business-day counting (UT/AL), FL
// weekend/holiday exclusion, AK mail extension, MD notice-of-intent block,
// ME info-sheet block, HI mediation block, NJ nonpayment vs lease-violation
// branching, lease-sensitive NC branch, LA local-overlay warning, plus the
// Oregon stale-statute warning and unverified-service blocking semantics.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import type {
  LedgerTransaction,
  Notice,
  NoticeMonth,
  Property,
  ValidationResult,
} from "../../types";
import { monthBounds } from "../dateUtils";
import { computeDeadline } from "../deadlines";
import { validateNotice } from "../validation";

function month(key: string, balanceCents: number): NoticeMonth {
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

function nonRentTxn(): LedgerTransaction {
  return {
    id: "x1",
    ledgerId: "L1",
    rowIndex: 1,
    date: "2026-06-01",
    month: "2026-06",
    description: "Late fee",
    originalCategory: "fee",
    memo: "",
    kind: "charge",
    amountCents: 5000,
    balanceCents: null,
    systemClass: "non_rent",
    confidence: 1,
    includedInNotice: true,
    classReason: "late fee",
    userOverrideClass: null,
    overrideReason: null,
    overriddenBy: null,
    flagged: false,
    flagReason: null,
  } as LedgerTransaction;
}

function issue(r: ValidationResult, code: string) {
  return r.issues.find((i) => i.code === code);
}

describe("rent-only exclusion in strict states (CA, AK, MA, FL)", () => {
  for (const st of ["CA", "AK", "MA", "FL"]) {
    it(`${st}: hard-blocks a notice that includes a non-rent charge`, () => {
      const r = validateNotice({
        notice: makeNotice({ jurisdiction: st }),
        transactions: [nonRentTxn()],
      });
      const i = issue(r, "rent_only_strict_state");
      expect(i, `${st} missing rent_only_strict_state`).toBeTruthy();
      expect(i!.level).toBe("blocker");
    });
  }

  it("does not raise the strict-state block outside strict states (TX)", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "TX" }),
      transactions: [nonRentTxn()],
    });
    expect(issue(r, "rent_only_strict_state")).toBeUndefined();
  });

  it("non-strict states get an acknowledgeable warning, not a block (TX)", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "TX" }),
      transactions: [nonRentTxn()],
    });
    const i = issue(r, "non_rent_included");
    expect(i?.level).toBe("warning");
    expect(i?.acknowledgeable).toBe(true);
  });

  it("strict states keep non_rent_included as a hard block (CA)", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "CA" }),
      transactions: [nonRentTxn()],
    });
    expect(issue(r, "non_rent_included")?.level).toBe("blocker");
  });
});

describe("business-day counting (UT, AL)", () => {
  it("AL: 7 business days skip weekends", () => {
    // Served Friday 2026-06-05; 7 business days should land well past +7 calendar.
    const r = computeDeadline("2026-06-05", "pay_or_quit_3day", "AL");
    const day = new Date(`${r.expirationDate}T12:00:00Z`).getUTCDay();
    expect(day).not.toBe(0);
    expect(day).not.toBe(6);
    // 7 business days from Sat 06-06 start → at least 9 calendar days out.
    expect(r.expirationDate >= "2026-06-16").toBe(true);
  });

  it("UT: business-day counting excludes weekends", () => {
    const r = computeDeadline("2026-06-05", "pay_or_quit_3day", "UT");
    const day = new Date(`${r.expirationDate}T12:00:00Z`).getUTCDay();
    expect(day).not.toBe(0);
    expect(day).not.toBe(6);
  });
});

describe("Florida weekend/court-holiday exclusion", () => {
  it("FL: 3 days served Thursday skips Sat/Sun", () => {
    // Served Thu 2026-06-04. FL counts from the service day context with
    // weekends excluded — the deadline must never fall on a weekend and must
    // extend past a plain +3 calendar count that would land on Sunday.
    const r = computeDeadline("2026-06-04", "pay_or_quit_3day", "FL");
    const day = new Date(`${r.expirationDate}T12:00:00Z`).getUTCDay();
    expect(day).not.toBe(0);
    expect(day).not.toBe(6);
    expect(r.expirationDate > "2026-06-07").toBe(true);
  });
});

describe("prerequisite blocks (MD, ME, HI)", () => {
  it("MD: blocks finalization until the notice of intent is completed", () => {
    const blocked = validateNotice({ notice: makeNotice({ jurisdiction: "MD" }) });
    expect(issue(blocked, "prereq_notice_of_intent_missing")?.level).toBe("blocker");

    const cleared = validateNotice({
      notice: makeNotice({
        jurisdiction: "MD",
        prereqCompleted: { notice_of_intent: true },
      }),
    });
    expect(issue(cleared, "prereq_notice_of_intent_missing")).toBeUndefined();
  });

  it("ME: blocks finalization until the information sheet is attached", () => {
    const blocked = validateNotice({ notice: makeNotice({ jurisdiction: "ME" }) });
    expect(issue(blocked, "prereq_information_sheet_missing")?.level).toBe("blocker");

    const cleared = validateNotice({
      notice: makeNotice({
        jurisdiction: "ME",
        prereqCompleted: { information_sheet: true },
      }),
    });
    expect(issue(cleared, "prereq_information_sheet_missing")).toBeUndefined();
  });

  it("HI: mediation block applies on/after 2026-02-05 and not before", () => {
    const after = validateNotice({
      notice: makeNotice({ jurisdiction: "HI" }),
      today: "2026-07-17",
    });
    expect(issue(after, "prereq_mediation_if_requested_missing")?.level).toBe("blocker");

    const before = validateNotice({
      notice: makeNotice({ jurisdiction: "HI" }),
      today: "2026-01-15",
    });
    expect(issue(before, "prereq_mediation_if_requested_missing")).toBeUndefined();
  });
});

describe("New Jersey nonpayment vs lease-violation branching", () => {
  it("requires a rule card before finalizing", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "NJ" }) });
    expect(issue(r, "rule_card_required")?.level).toBe("blocker");
  });

  it("accepts the nonpayment (no pre-suit notice) branch", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "NJ", ruleCardKey: "nonpayment_no_notice" }),
    });
    expect(issue(r, "rule_card_required")).toBeUndefined();
    expect(issue(r, "rule_card_verify_lease")?.level).toBe("warning");
  });

  it("accepts the lease-violation cease-then-quit branch", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "NJ", ruleCardKey: "cease_then_quit" }),
    });
    expect(issue(r, "rule_card_required")).toBeUndefined();
    expect(issue(r, "rule_card_verify_lease")?.level).toBe("warning");
  });

  it("rejects a rule card that does not exist for NJ", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "NJ", ruleCardKey: "bogus_card" }),
    });
    expect(issue(r, "rule_card_invalid")?.level).toBe("blocker");
  });
});

describe("lease-sensitive North Carolina branch", () => {
  it("blocks until a rule card is chosen, then warns to verify the lease", () => {
    const blocked = validateNotice({ notice: makeNotice({ jurisdiction: "NC" }) });
    expect(issue(blocked, "rule_card_required")?.level).toBe("blocker");

    const chosen = validateNotice({
      notice: makeNotice({
        jurisdiction: "NC",
        ruleCardKey: "lease_controlled_nonpayment",
      }),
    });
    expect(issue(chosen, "rule_card_required")).toBeUndefined();
    expect(issue(chosen, "rule_card_verify_lease")?.level).toBe("warning");
  });
});

describe("Los Angeles local-overlay verification", () => {
  const property = {
    id: "p1",
    city: "Los Angeles",
    county: "Los Angeles",
    isLosAngelesCity: true,
    ownerName: "Owner LLC",
  } as unknown as Property;

  it("blocks when the property matches an overlay and it is unverified", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "CA" }), property });
    const i = issue(r, "local_overlay_unverified");
    expect(i).toBeTruthy();
    expect(i!.level).toBe("blocker");
  });

  it("raises no overlay issue once verification is recorded", () => {
    const r = validateNotice({
      notice: makeNotice({
        jurisdiction: "CA",
        localOverlayVerifiedBy: "user-1",
        localOverlayVerifiedAt: "2026-07-01T00:00:00.000Z",
      }),
      property,
    });
    expect(issue(r, "local_overlay_unverified")).toBeUndefined();
    expect(r.issues.filter((i) => i.code === "local_overlay")).toHaveLength(0);
  });
});

describe("Oregon stale-statute is a warning, not a blocker", () => {
  it("emits stale_statute_source as an acknowledgeable warning", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "OR" }) });
    const i = issue(r, "stale_statute_source");
    expect(i).toBeTruthy();
    expect(i!.level).toBe("warning");
  });
});

describe("count-start behavior (countStartsDayAfterService)", () => {
  it("NM (starts day after service): 3 calendar days → service + 3", () => {
    // NM pack: 3 calendar days, countStartsDayAfterService: true.
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "NM");
    expect(r.expirationDate).toBe("2026-06-04");
  });

  it("FL (counting starts on the service day): weekday service day is day 1", () => {
    // FL pack: 3 court days, countStartsDayAfterService: false.
    // Served Mon 2026-06-01 → Mon=1, Tue=2, Wed=3.
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "FL");
    expect(r.expirationDate).toBe("2026-06-03");
    expect(r.explanation.some((l) => /service day counted as day 1/.test(l))).toBe(true);
  });

  it("CA still counts from the day after service (byte-identical)", () => {
    const r = computeDeadline("2026-06-01", "pay_or_quit_3day", "CA");
    expect(r.expirationDate).toBe("2026-06-04");
  });
});

describe("state-required content fields", () => {
  it("blocks a CA money notice missing accepted payment methods", () => {
    const base = makeNotice();
    const r = validateNotice({
      notice: makeNotice({
        payment: { ...base.payment, acceptedMethods: [] },
      }),
    });
    expect(issue(r, "content_payment_methods_missing")?.level).toBe("blocker");
  });

  it("blocks a missing payment address via the state content rule", () => {
    const base = makeNotice();
    const r = validateNotice({
      notice: makeNotice({
        jurisdiction: "FL",
        payment: { ...base.payment, paymentAddress: "" },
      }),
    });
    expect(issue(r, "content_payment_address_missing")?.level).toBe("blocker");
  });

  it("warns that MA requires a right-to-cure statement on the notice", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "MA" }) });
    expect(issue(r, "content_right_to_cure_statement")?.level).toBe("warning");
  });
});

describe("undetermined service rules block finalization", () => {
  it("blocks a draft in an unverified-service state even before service is recorded (AL)", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "AL" }) });
    expect(issue(r, "service_rule_unverified")?.level).toBe("blocker");
  });

  it("does not raise the pack-level block in a verified-service state (CA)", () => {
    const r = validateNotice({ notice: makeNotice({ jurisdiction: "CA" }) });
    expect(issue(r, "service_rule_unverified")).toBeUndefined();
  });

  const served = (jurisdiction: string): Partial<Notice> => ({
    jurisdiction,
    status: "served",
    service: {
      dateServed: "2026-06-05",
      timeServed: "10:00",
      method: "personal",
      servedBy: "Sam Server",
      serverNotes: "",
      mailedDate: null,
    },
  });

  it("blocks when the state's service rules are unverified (AL)", () => {
    const r = validateNotice({ notice: makeNotice(served("AL")) });
    expect(issue(r, "service_rule_unverified")?.level).toBe("blocker");
  });

  it("downgrades to a warning under the admin override", () => {
    const r = validateNotice({
      notice: makeNotice(served("AL")),
      settings: { requireAttorneyReviewedTemplate: false, allowAdminTemplateOverride: true },
      currentUserRole: "admin",
    });
    expect(issue(r, "service_rule_unverified")?.level).toBe("warning");
  });

  it("downgrades to a warning citing a recorded attorney approval (AL)", () => {
    const r = validateNotice({
      notice: makeNotice(served("AL")),
      stateRuleReview: { reviewerName: "Jane Doe, Esq.", reviewedAt: "2026-07-01" },
    });
    const i = issue(r, "service_rule_unverified");
    expect(i?.level).toBe("warning");
    expect(i?.message).toContain("Jane Doe, Esq.");
    expect(i?.message).toContain("2026-07-01");
  });

  it("replaces the generic not-reviewed warning with an approval reference", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "AL" }),
      stateRuleReview: { reviewerName: "Jane Doe, Esq.", reviewedAt: "2026-07-01" },
    });
    expect(issue(r, "jurisdiction_not_reviewed")).toBeUndefined();
    const i = issue(r, "jurisdiction_attorney_approved");
    expect(i?.level).toBe("warning");
    expect(i?.message).toContain("Jane Doe, Esq.");
  });

  it("keeps the unspecified-period blocker even with an approval on file (RI)", () => {
    const r = validateNotice({
      notice: makeNotice({ jurisdiction: "RI" }),
      stateRuleReview: { reviewerName: "Jane Doe, Esq.", reviewedAt: "2026-07-01" },
    });
    const i = issue(r, "state_period_unspecified");
    expect(i?.level).toBe("blocker");
    expect(i?.message).toContain("Jane Doe, Esq.");
  });

  it("blocks a disallowed method in a verified state (OK requires personal service)", () => {
    const r = validateNotice({
      notice: makeNotice({
        ...served("OK"),
        service: { ...served("OK").service!, method: "certified_mail" },
      }),
    });
    expect(issue(r, "service_method_not_allowed")?.level).toBe("blocker");
  });
});
