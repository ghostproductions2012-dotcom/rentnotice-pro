// ---------------------------------------------------------------------------
// Calculation review sheet (DocumentKind "calc_review").
//
// Internal, auditable breakdown of how the rent-only amount was reached:
// included months table (rent charged, payments applied, credits, rent-only
// balance), excluded items with reasons, and the demanded total.
// ---------------------------------------------------------------------------

import { formatCents } from "../../types";
import type { MonthCalculation } from "../../types";
import { formatLongDate, formatMonthLabel } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

export async function generateCalcReview(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice, calculation } = ctx;
  const b = await newBuilder(ctx, "Calculation Review", options);

  b.documentTitle("INTERNAL CALCULATION REVIEW", {
    subtitle: "Rent-only balance — for internal review; not part of the served notice",
  });

  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", `${notice.propertyAddress}${notice.unit ? `, Unit ${notice.unit}` : ""}`, {
    labelWidth: 130,
  });
  if (calculation) {
    b.labelValue("Computed at:", new Date(calculation.computedAt).toLocaleString("en-US"), {
      labelWidth: 130,
    });
  }
  b.moveDown(4);

  if (!calculation) {
    b.paragraph(
      "No ledger calculation is linked to this notice. The demanded amount below was entered or overridden manually.",
      { gapAfter: 6 },
    );
    b.labelValue("Demanded total:", formatCents(notice.totalAmountCents), { labelWidth: 130 });
    return finalize(b, fileName(ctx, "calc_review", options));
  }

  // ---- included months (demanded on the notice) ----
  b.heading("Included Months (Rent Only)");
  b.table({
    columns: [
      { header: "Rent Period", width: 30 },
      { header: "Rent Charged", width: 15, align: "right" },
      { header: "Payments Applied", width: 16, align: "right" },
      { header: "Credits Applied", width: 15, align: "right" },
      { header: "Carry-In", width: 12, align: "right" },
      { header: "Rent-Only Balance", width: 16, align: "right" },
    ],
    rows: calculation.months.map((m: MonthCalculation) => [
      `${formatLongDate(m.periodStart)} - ${formatLongDate(m.periodEnd)}`,
      formatCents(m.rentChargedCents),
      formatCents(m.paymentsAppliedCents),
      formatCents(m.creditsAppliedCents),
      formatCents(m.carryInCents),
      { text: formatCents(m.rentOnlyBalanceCents), bold: true, align: "right" as const },
    ]),
  });

  b.labelValue("Total rent-only balance:", formatCents(calculation.totalRentOnlyCents), {
    labelWidth: 190,
  });
  b.labelValue("Unapplied payments:", formatCents(calculation.unappliedPaymentsCents), {
    labelWidth: 190,
  });
  b.labelValue("Total demanded on notice:", formatCents(notice.totalAmountCents), {
    labelWidth: 190,
  });

  // ---- overrides on the notice months ----
  const overrides = notice.months.filter((m) => m.overrideReason);
  if (overrides.length) {
    b.heading("Manual Overrides");
    for (const m of overrides) {
      b.bullet(
        `${formatMonthLabel(m.month)}: demanded ${formatCents(m.selectedAmountCents)} (calculated ${formatCents(m.rentOnlyBalanceCents)}). Reason: ${m.overrideReason}`,
      );
    }
  }

  // ---- payments applied detail ----
  b.heading("Payments Applied by Month");
  const paymentRows = calculation.months
    .filter((m) => m.transactions.some((t) => t.amountCents < 0))
    .flatMap((m) =>
      m.transactions
        .filter((t) => t.amountCents < 0)
        .map((t) => [
          formatMonthLabel(m.month),
          formatLongDate(t.date),
          t.description || "(payment)",
          { text: formatCents(Math.abs(t.amountCents)), align: "right" as const },
        ]),
    );
  if (paymentRows.length) {
    b.table({
      columns: [
        { header: "Month", width: 18 },
        { header: "Date", width: 20 },
        { header: "Description", width: 44 },
        { header: "Amount", width: 18, align: "right" },
      ],
      rows: paymentRows,
    });
  } else {
    b.paragraph("No payments or credits were applied within the selected period(s).", { gapAfter: 6 });
  }

  // ---- excluded items with reasons ----
  b.heading("Excluded Non-Rent Charges");
  const excludedRows = calculation.months.flatMap((m) =>
    m.excludedItems.map((e) => [
      formatMonthLabel(m.month),
      e.description || "(charge)",
      e.class.replace(/_/g, " "),
      { text: formatCents(e.amountCents), align: "right" as const },
    ]),
  );
  if (excludedRows.length) {
    b.table({
      columns: [
        { header: "Month", width: 18 },
        { header: "Description", width: 42 },
        { header: "Reason (Class)", width: 24 },
        { header: "Amount", width: 16, align: "right" },
      ],
      rows: excludedRows,
    });
    b.labelValue("Total excluded:", formatCents(calculation.totalExcludedCents), { labelWidth: 150 });
  } else {
    b.paragraph("No non-rent charges were found in the selected period(s).", { gapAfter: 6 });
  }

  // ---- warnings ----
  const allWarnings = [
    ...calculation.globalWarnings,
    ...calculation.months.flatMap((m) => m.warnings.map((w) => `${formatMonthLabel(m.month)}: ${w}`)),
  ];
  if (allWarnings.length) {
    b.heading("Warnings");
    for (const w of allWarnings) b.bullet(w);
  }

  b.moveDown(6);
  b.note(
    "Only rent charges are included in the notice amount. All non-rent charges shown above are excluded from the demand.",
  );

  return finalize(b, fileName(ctx, "calc_review", options));
}
