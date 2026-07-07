// ---------------------------------------------------------------------------
// Excluded items summary (DocumentKind "excluded_summary").
//
// Transparency document: every non-rent charge that was excluded from the
// notice amount, grouped by month, with the classification reason and totals.
// Never hides exclusions (per spec).
// ---------------------------------------------------------------------------

import { formatCents } from "../../types";
import type { RentClass } from "../../types";
import { formatMonthLabel } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

export async function generateExcludedSummary(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice, calculation } = ctx;
  const b = await newBuilder(ctx, "Excluded Charge Summary", options);

  b.documentTitle("EXCLUDED NON-RENT CHARGE SUMMARY");
  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", `${notice.propertyAddress}${notice.unit ? `, Unit ${notice.unit}` : ""}`, {
    labelWidth: 130,
  });
  b.moveDown(4);

  b.paragraph(
    "The following charges were identified in the tenant ledger but were EXCLUDED from the amount demanded in the notice because they are not rent. A California 3-Day Notice to Pay Rent or Quit may demand rent only.",
    { gapAfter: 8 },
  );

  if (!calculation) {
    b.paragraph("No ledger calculation is linked to this notice; no exclusions to report.", {
      gapAfter: 6,
    });
    return finalize(b, fileName(ctx, "excluded_summary", options));
  }

  const rows = calculation.months.flatMap((m) =>
    m.excludedItems.map((e) => [
      formatMonthLabel(m.month),
      e.description || "(charge)",
      classLabel(e.class),
      { text: formatCents(e.amountCents), align: "right" as const },
    ]),
  );

  if (!rows.length) {
    b.paragraph("No non-rent charges were found in the selected period(s). Nothing was excluded.", {
      gapAfter: 6,
    });
    return finalize(b, fileName(ctx, "excluded_summary", options));
  }

  b.table({
    columns: [
      { header: "Month", width: 18 },
      { header: "Description", width: 40 },
      { header: "Category / Reason", width: 26 },
      { header: "Amount", width: 16, align: "right" },
    ],
    rows,
  });

  b.labelValue("Total excluded (not demanded):", formatCents(calculation.totalExcludedCents), {
    labelWidth: 210,
  });

  // ---- breakdown by category ----
  const byClass = new Map<RentClass, number>();
  for (const m of calculation.months) {
    for (const e of m.excludedItems) {
      byClass.set(e.class, (byClass.get(e.class) ?? 0) + e.amountCents);
    }
  }
  if (byClass.size) {
    b.heading("Excluded Totals by Category");
    b.table({
      columns: [
        { header: "Category", width: 60 },
        { header: "Total Excluded", width: 40, align: "right" },
      ],
      rows: Array.from(byClass.entries())
        .sort((a, b2) => b2[1] - a[1])
        .map(([cls, cents]) => [
          classLabel(cls),
          { text: formatCents(cents), align: "right" as const },
        ]),
    });
  }

  b.moveDown(6);
  b.note(
    "These excluded charges may still be owed by the tenant and may be pursued through other lawful means, but they are not part of this rent demand.",
  );

  return finalize(b, fileName(ctx, "excluded_summary", options));
}

function classLabel(cls: RentClass): string {
  return cls
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
