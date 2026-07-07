// ---------------------------------------------------------------------------
// Ledger backup document (DocumentKind "ledger_backup").
//
// A full-row table of the underlying ledger transactions (date, description,
// category/class, amount, balance) so the notice file preserves the source
// data behind the calculation. Rows are pulled from the calculation result.
// ---------------------------------------------------------------------------

import { formatCents } from "../../types";
import type { LedgerTransaction, RentClass } from "../../types";
import { formatLongDate } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

function classLabel(cls: RentClass): string {
  return cls.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateLedgerBackup(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice, calculation } = ctx;
  const b = await newBuilder(ctx, "Ledger Backup", options);

  b.documentTitle("LEDGER BACKUP");
  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", `${notice.propertyAddress}${notice.unit ? `, Unit ${notice.unit}` : ""}`, {
    labelWidth: 130,
  });
  b.moveDown(4);

  if (!calculation) {
    b.paragraph("No ledger calculation is linked to this notice; no transactions to display.", {
      gapAfter: 6,
    });
    return finalize(b, fileName(ctx, "ledger_backup", options));
  }

  // Flatten and de-duplicate transactions across months, sorted by date/row.
  const seen = new Set<string>();
  const txns: LedgerTransaction[] = [];
  for (const m of calculation.months) {
    for (const t of m.transactions) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      txns.push(t);
    }
  }
  txns.sort((a, c) => {
    if (a.date !== c.date) return a.date < c.date ? -1 : 1;
    return a.rowIndex - c.rowIndex;
  });

  b.paragraph(
    "The following is a copy of the ledger transactions used to prepare this notice. This backup is retained for audit purposes and reflects the data as calculated.",
    { gapAfter: 8 },
  );

  if (!txns.length) {
    b.paragraph("No transactions are available.", { gapAfter: 6 });
    return finalize(b, fileName(ctx, "ledger_backup", options));
  }

  b.table({
    columns: [
      { header: "Date", width: 14 },
      { header: "Description", width: 34 },
      { header: "Category / Class", width: 20 },
      { header: "Included", width: 10, align: "center" },
      { header: "Amount", width: 12, align: "right" },
      { header: "Balance", width: 12, align: "right" },
    ],
    rows: txns.map((t) => [
      formatLongDate(t.date),
      t.description || t.originalCategory || "(transaction)",
      classLabel(t.userOverrideClass ?? t.systemClass),
      { text: t.includedInNotice ? "Yes" : "No", align: "center" as const },
      { text: formatCents(t.amountCents), align: "right" as const },
      { text: t.balanceCents != null ? formatCents(t.balanceCents) : "—", align: "right" as const },
    ]),
    fontSize: 8.5,
  });

  // ---- totals ----
  const charges = txns.filter((t) => t.amountCents > 0).reduce((s, t) => s + t.amountCents, 0);
  const paymentsCredits = txns
    .filter((t) => t.amountCents < 0)
    .reduce((s, t) => s + Math.abs(t.amountCents), 0);
  b.labelValue("Total charges:", formatCents(charges), { labelWidth: 190 });
  b.labelValue("Total payments / credits:", formatCents(paymentsCredits), { labelWidth: 190 });
  b.labelValue("Transactions:", String(txns.length), { labelWidth: 190 });

  b.moveDown(6);
  b.note(
    "Amounts are normalized (positive = charge; negative = payment or credit). This backup does not itself demand any amount; see the notice for the rent-only demand.",
  );

  return finalize(b, fileName(ctx, "ledger_backup", options));
}
