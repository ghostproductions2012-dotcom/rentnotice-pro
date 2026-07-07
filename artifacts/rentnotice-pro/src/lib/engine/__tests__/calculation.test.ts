import { describe, expect, it } from "vitest";
import type { LedgerTransaction, RentClass, TxnKind } from "../../types";
import { calculateRentOnly, collectExcludedItems } from "../calculation";

let seq = 0;
function txn(partial: {
  date: string;
  description: string;
  amountCents: number;
  systemClass: RentClass;
  kind: TxnKind;
  includedInNotice?: boolean;
  userOverrideClass?: RentClass | null;
  flagged?: boolean;
}): LedgerTransaction {
  seq += 1;
  return {
    id: `t${seq}`,
    ledgerId: "L1",
    rowIndex: seq,
    date: partial.date,
    month: partial.date.slice(0, 7),
    description: partial.description,
    originalCategory: "",
    memo: "",
    kind: partial.kind,
    amountCents: partial.amountCents,
    balanceCents: null,
    systemClass: partial.systemClass,
    confidence: 0.9,
    includedInNotice: partial.includedInNotice ?? partial.systemClass === "rent",
    classReason: "",
    userOverrideClass: partial.userOverrideClass ?? null,
    overrideReason: null,
    overriddenBy: null,
    flagged: partial.flagged ?? false,
    flagReason: null,
  };
}

const rent = (date: string, cents: number) =>
  txn({ date, description: "Base Rent", amountCents: cents, systemClass: "rent", kind: "rent_charge" });
const payment = (date: string, cents: number) =>
  txn({ date, description: "Payment", amountCents: -Math.abs(cents), systemClass: "payment", kind: "payment" });

describe("rent-only calculation engine", () => {
  it("computes a single-month balance: rent minus partial payment", () => {
    const result = calculateRentOnly("L1", [rent("2026-06-01", 200000), payment("2026-06-05", 50000)]);
    expect(result.months).toHaveLength(1);
    const m = result.months[0]!;
    expect(m.rentChargedCents).toBe(200000);
    expect(m.paymentsAppliedCents).toBe(50000);
    expect(m.rentOnlyBalanceCents).toBe(150000);
    expect(result.totalRentOnlyCents).toBe(150000);
    expect(m.warnings.join(" ")).toMatch(/Partial payment/);
  });

  it("excludes non-rent charges and lists them visibly", () => {
    const result = calculateRentOnly("L1", [
      rent("2026-06-01", 200000),
      txn({ date: "2026-06-03", description: "Late Fee", amountCents: 10000, systemClass: "late_fee", kind: "non_rent_charge" }),
    ]);
    const m = result.months[0]!;
    expect(m.rentOnlyBalanceCents).toBe(200000); // late fee never demanded
    expect(m.excludedChargesCents).toBe(10000);
    expect(m.excludedItems).toHaveLength(1);
    expect(m.excludedItems[0]!.class).toBe("late_fee");
    expect(result.totalExcludedCents).toBe(10000);
    const detail = collectExcludedItems(result);
    expect(detail[0]!.reason).toMatch(/non-rent/);
  });

  it("applies rent credits against the balance", () => {
    const result = calculateRentOnly("L1", [
      rent("2026-06-01", 200000),
      txn({ date: "2026-06-10", description: "Rent credit", amountCents: -20000, systemClass: "credit", kind: "credit" }),
    ]);
    expect(result.months[0]!.rentOnlyBalanceCents).toBe(180000);
  });

  it("does not carry overpayments forward by default", () => {
    const result = calculateRentOnly("L1", [
      rent("2026-05-01", 100000),
      payment("2026-05-02", 150000),
      rent("2026-06-01", 100000),
    ]);
    const june = result.months.find((m) => m.month === "2026-06")!;
    expect(june.carryInCents).toBe(0);
    expect(june.rentOnlyBalanceCents).toBe(100000);
    expect(result.unappliedPaymentsCents).toBe(50000);
    expect(result.globalWarnings.join(" ")).toMatch(/not clearly applied/);
  });

  it("carries overpayments forward when enabled", () => {
    const result = calculateRentOnly(
      "L1",
      [rent("2026-05-01", 100000), payment("2026-05-02", 150000), rent("2026-06-01", 100000)],
      { carryForwardCredits: true },
    );
    const june = result.months.find((m) => m.month === "2026-06")!;
    expect(june.carryInCents).toBe(50000);
    expect(june.rentOnlyBalanceCents).toBe(50000);
    expect(result.unappliedPaymentsCents).toBe(0);
  });

  it("enforces the 12-month lookback window", () => {
    const result = calculateRentOnly(
      "L1",
      [rent("2025-01-01", 100000), rent("2026-06-01", 200000)],
      { asOfMonth: "2026-06" },
    );
    expect(result.months.map((m) => m.month)).toEqual(["2026-06"]);
    expect(result.totalRentOnlyCents).toBe(200000);
    expect(result.globalWarnings.join(" ")).toMatch(/lookback/);
  });

  it("warns on payments received in a month with no rent charge", () => {
    const result = calculateRentOnly("L1", [payment("2026-06-05", 40000)]);
    expect(result.unappliedPaymentsCents).toBe(40000);
    expect(result.months[0]!.warnings.join(" ")).toMatch(/allocation unclear/);
  });

  it("never applies security deposits automatically", () => {
    const result = calculateRentOnly("L1", [
      rent("2026-06-01", 200000),
      txn({ date: "2026-06-02", description: "Security Deposit", amountCents: 50000, systemClass: "deposit", kind: "deposit" }),
    ]);
    const m = result.months[0]!;
    expect(m.rentOnlyBalanceCents).toBe(200000);
    expect(m.excludedItems.some((x) => x.class === "deposit")).toBe(true);
    expect(m.warnings.join(" ")).toMatch(/deposit/i);
  });

  it("respects manual overrides via userOverrideClass", () => {
    const overridden = txn({
      date: "2026-06-04",
      description: "Misc charge",
      amountCents: 30000,
      systemClass: "other_non_rent",
      kind: "non_rent_charge",
      includedInNotice: true,
      userOverrideClass: "rent",
    });
    const result = calculateRentOnly("L1", [overridden]);
    expect(result.months[0]!.rentChargedCents).toBe(30000);
    expect(result.months[0]!.excludedItems).toHaveLength(0);
  });
});
