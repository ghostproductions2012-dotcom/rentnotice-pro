// ---------------------------------------------------------------------------
// Rent-only demand calculation engine (CA 3-Day Notice to Pay Rent or Quit).
//
// Groups charges by rental-period month, applies payments/credits per the
// spec's rules, excludes every non-rent item into a per-month excluded list
// (with the class as the reason), enforces a 12-month lookback window, and
// returns the CalculationResult structure from ../types. All money is integer
// cents. Pure and deterministic.
//
// Rules (spec §6):
//  - Rent period always begins on the 1st and ends on the last day of month.
//  - Monthly rent owed = rent charges − payments applied − credits applied.
//  - Multiple/partial payments in a month are recognized.
//  - Credits reduce the balance only when rent-related (class "credit").
//  - Overpayments carry forward only when explicitly enabled.
//  - Security deposits are never applied automatically.
//  - Non-rent charges are never included; they land in the excluded list.
//  - Ambiguous / unapplied payments raise warnings.
// ---------------------------------------------------------------------------

import type { CalculationResult, Id, LedgerTransaction, MonthCalculation, RentClass } from "../types";
import { formatCents } from "../types";
import { monthBounds, monthKeyIndex } from "./dateUtils";

export interface CalculationOptions {
  /** Maximum age (in months) of a rent month to include. Default 12. */
  lookbackMonths?: number;
  /**
   * Anchor month ("YYYY-MM") for the lookback window. Defaults to the most
   * recent month present in the ledger.
   */
  asOfMonth?: string;
  /** Carry overpayments forward to reduce the next month's balance. Default false. */
  carryForwardCredits?: boolean;
  /** ISO timestamp used for computedAt (injectable for deterministic tests). */
  computedAt?: string;
}

const DEFAULT_LOOKBACK_MONTHS = 12;

function effectiveClass(txn: LedgerTransaction): RentClass {
  return txn.userOverrideClass ?? txn.systemClass;
}

interface MonthAccumulator {
  month: string;
  rentCharged: number;
  payments: number;
  credits: number;
  excluded: number;
  excludedItems: MonthCalculation["excludedItems"];
  warnings: string[];
  transactions: LedgerTransaction[];
  depositActivity: boolean;
}

/**
 * Compute the rent-only calculation for a set of ledger transactions.
 * `ledgerId` is echoed into the result to match CalculationResult.
 */
export function calculateRentOnly(
  ledgerId: Id,
  transactions: LedgerTransaction[],
  options: CalculationOptions = {},
): CalculationResult {
  const lookbackMonths = options.lookbackMonths ?? DEFAULT_LOOKBACK_MONTHS;
  const computedAt = options.computedAt ?? new Date().toISOString();

  // 1) Bucket transactions by rental-period month.
  const byMonth = new Map<string, MonthAccumulator>();
  for (const txn of transactions) {
    const month = txn.month || txn.date.slice(0, 7);
    let acc = byMonth.get(month);
    if (!acc) {
      acc = {
        month,
        rentCharged: 0,
        payments: 0,
        credits: 0,
        excluded: 0,
        excludedItems: [],
        warnings: [],
        transactions: [],
        depositActivity: false,
      };
      byMonth.set(month, acc);
    }
    acc.transactions.push(txn);

    const cls = effectiveClass(txn);
    if (txn.kind === "payment" || cls === "payment") {
      acc.payments += Math.abs(txn.amountCents);
    } else if (
      txn.kind === "credit" ||
      txn.kind === "refund" ||
      txn.kind === "reversal" ||
      txn.kind === "void" ||
      txn.kind === "adjustment" ||
      cls === "credit"
    ) {
      acc.credits += Math.abs(txn.amountCents);
    } else if (cls === "rent" && txn.includedInNotice) {
      acc.rentCharged += txn.amountCents;
    } else if (txn.amountCents > 0) {
      // Every positive non-rent charge is excluded and made visible.
      acc.excluded += txn.amountCents;
      acc.excludedItems.push({
        description: txn.description || `(${cls})`,
        amountCents: txn.amountCents,
        class: cls,
      });
    }

    if (cls === "deposit") acc.depositActivity = true;
    if (txn.flagged)
      acc.warnings.push(`Flagged: "${txn.description}" — ${txn.flagReason ?? "review needed"}.`);
    else if (cls === "unclassified")
      acc.warnings.push(`Unclassified transaction: "${txn.description}" — review required.`);
  }

  // 2) Determine the lookback window.
  const allMonths = [...byMonth.keys()].sort();
  const anchorMonth = options.asOfMonth ?? allMonths[allMonths.length - 1] ?? null;
  const anchorIndex = anchorMonth ? monthKeyIndex(anchorMonth) : null;
  const inWindow = (month: string): boolean => {
    if (anchorIndex == null) return true;
    const idx = monthKeyIndex(month);
    return idx <= anchorIndex && anchorIndex - idx < lookbackMonths;
  };

  // 3) Emit MonthCalculation rows (chronological), applying carry-forward.
  const months: MonthCalculation[] = [];
  const excludedByLookback: string[] = [];
  const globalWarnings: string[] = [];
  let unappliedPayments = 0;
  let carry = 0; // running overpayment carried into the next in-window month

  for (const month of allMonths) {
    const acc = byMonth.get(month)!;
    const { start, end } = monthBounds(month);

    if (!inWindow(month)) {
      const bal = Math.max(0, acc.rentCharged - acc.payments - acc.credits);
      if (bal > 0)
        excludedByLookback.push(`${month} (${formatCents(bal)} rent-only balance beyond ${lookbackMonths}-month lookback)`);
      continue;
    }

    const carryIn = options.carryForwardCredits ? carry : 0;
    const applied = acc.payments + acc.credits + carryIn;
    const rentOnly = Math.max(0, acc.rentCharged - applied);
    const overpay = Math.max(0, applied - acc.rentCharged);

    const warnings = [...acc.warnings];
    if (acc.payments > 0 && acc.rentCharged === 0) {
      warnings.push(`Payment of ${formatCents(acc.payments)} received with no rent charge this month — allocation unclear.`);
      unappliedPayments += acc.payments;
    } else if (acc.payments > 0 && acc.payments < acc.rentCharged) {
      warnings.push(`Partial payment: ${formatCents(acc.payments)} applied toward ${formatCents(acc.rentCharged)} rent.`);
    }
    if (overpay > 0 && acc.rentCharged > 0) {
      if (options.carryForwardCredits) {
        warnings.push(`Overpayment of ${formatCents(overpay)} carried forward to the next month.`);
      } else {
        warnings.push(`Overpayment of ${formatCents(overpay)} not applied — carry-forward is disabled.`);
        unappliedPayments += overpay;
      }
    }
    if (acc.depositActivity)
      warnings.push("Security deposit activity present — not applied automatically; requires manual authorization and legal review.");

    carry = options.carryForwardCredits ? overpay : 0;

    months.push({
      month,
      periodStart: start,
      periodEnd: end,
      rentChargedCents: acc.rentCharged,
      paymentsAppliedCents: acc.payments,
      creditsAppliedCents: acc.credits,
      excludedChargesCents: acc.excluded,
      excludedItems: acc.excludedItems,
      rentOnlyBalanceCents: rentOnly,
      carryInCents: carryIn,
      warnings,
      transactions: acc.transactions,
    });
  }

  if (unappliedPayments > 0)
    globalWarnings.push(`Ledger contains ${formatCents(unappliedPayments)} in payments/credits not clearly applied to a rent month.`);
  if (excludedByLookback.length > 0)
    globalWarnings.push(`Excluded ${excludedByLookback.length} month(s) beyond the ${lookbackMonths}-month lookback: ${excludedByLookback.join("; ")}.`);

  return {
    ledgerId,
    months,
    totalRentOnlyCents: months.reduce((s, m) => s + m.rentOnlyBalanceCents, 0),
    totalExcludedCents: months.reduce((s, m) => s + m.excludedChargesCents, 0),
    unappliedPaymentsCents: unappliedPayments,
    globalWarnings,
    computedAt,
  };
}

/** Flattened list of every excluded item across all months (with reasons). */
export interface ExcludedItemDetail {
  month: string;
  description: string;
  amountCents: number;
  class: RentClass;
  reason: string;
}

export function collectExcludedItems(result: CalculationResult): ExcludedItemDetail[] {
  const out: ExcludedItemDetail[] = [];
  for (const m of result.months) {
    for (const item of m.excludedItems) {
      out.push({
        month: m.month,
        description: item.description,
        amountCents: item.amountCents,
        class: item.class,
        reason: `Excluded as non-rent charge (${item.class}).`,
      });
    }
  }
  return out;
}
