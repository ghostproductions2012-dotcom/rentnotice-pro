// ---------------------------------------------------------------------------
// Normalization pipeline: (raw table | header-keyed records) + ColumnMapping
// -> NormalizedTransaction rows ready for classification and storage.
//
// - money -> integer cents (charges positive, payments/credits negative)
// - dates -> ISO YYYY-MM-DD, month -> YYYY-MM
// - rows without a usable date or amount are skipped with a warning
// ---------------------------------------------------------------------------

import type { ColumnMapping } from "../types";
import type { NormalizedTransaction, NormalizeResult, RawTable } from "./types";
import { parseDateToIso, parseMonthToIso } from "./dates";
import { parseMoneyToCents } from "./money";

/** Convert a RawTable into header-keyed records (the ParsedLedgerFile row shape). */
export function tableToRecords(table: RawTable): Record<string, string>[] {
  return table.rows.map((cells) => {
    const record: Record<string, string> = {};
    table.headers.forEach((header, i) => {
      record[header] = cells[i] ?? "";
    });
    return record;
  });
}

function pick(record: Record<string, string>, header: string | null): string {
  if (!header) return "";
  const direct = record[header];
  if (direct !== undefined) return direct;
  // tolerate case/whitespace drift between mapping and headers
  const wanted = header.trim().toLowerCase();
  for (const key of Object.keys(record)) {
    if (key.trim().toLowerCase() === wanted) return record[key];
  }
  return "";
}

function isRowEmpty(record: Record<string, string>): boolean {
  return Object.values(record).every((v) => !String(v ?? "").trim());
}

/** Normalize header-keyed records using a column mapping. */
export function normalizeRecords(
  records: Record<string, string>[],
  mapping: ColumnMapping,
): NormalizeResult {
  const rows: NormalizedTransaction[] = [];
  const warnings: string[] = [];
  let skippedNoDate = 0;
  let skippedNoAmount = 0;

  records.forEach((record, index) => {
    if (isRowEmpty(record)) return;

    const rowWarnings: string[] = [];
    const dateIso = parseDateToIso(pick(record, mapping.date));
    if (!dateIso) {
      skippedNoDate += 1;
      return;
    }

    let amountCents: number | null = null;
    if (mapping.amount) {
      amountCents = parseMoneyToCents(pick(record, mapping.amount));
    } else {
      const charge = parseMoneyToCents(pick(record, mapping.chargeAmount));
      const payment = parseMoneyToCents(pick(record, mapping.paymentAmount));
      const credit = parseMoneyToCents(pick(record, mapping.creditAmount));
      if (charge === null && payment === null && credit === null) {
        amountCents = null;
      } else {
        amountCents =
          (charge ?? 0) - Math.abs(payment ?? 0) - Math.abs(credit ?? 0);
      }
    }
    if (amountCents === null) {
      skippedNoAmount += 1;
      return;
    }

    const month =
      parseMonthToIso(pick(record, mapping.month)) ?? dateIso.slice(0, 7);
    const balanceCents = parseMoneyToCents(pick(record, mapping.balance));
    const description =
      pick(record, mapping.description).trim() ||
      pick(record, mapping.category).trim() ||
      "(no description)";

    rows.push({
      rowIndex: index,
      date: dateIso,
      month,
      description,
      originalCategory: pick(record, mapping.category).trim(),
      memo: pick(record, mapping.memo).trim(),
      transactionType: pick(record, mapping.transactionType).trim(),
      tenantIdentifier: pick(record, mapping.tenantIdentifier).trim(),
      amountCents,
      balanceCents,
      warnings: rowWarnings,
    });
  });

  if (skippedNoDate > 0) {
    warnings.push(`${skippedNoDate} row(s) skipped: no recognizable date.`);
  }
  if (skippedNoAmount > 0) {
    warnings.push(`${skippedNoAmount} row(s) skipped: no recognizable amount.`);
  }
  if (rows.length === 0) {
    warnings.push("No usable transactions found with the current column mapping.");
  }

  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    warnings,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
  };
}

/** Normalize a RawTable using a column mapping. */
export function normalizeRows(table: RawTable, mapping: ColumnMapping): NormalizeResult {
  return normalizeRecords(tableToRecords(table), mapping);
}
