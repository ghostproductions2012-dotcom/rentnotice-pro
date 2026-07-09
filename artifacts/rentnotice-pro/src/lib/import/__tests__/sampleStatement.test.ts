// ---------------------------------------------------------------------------
// End-to-end pipeline test against the real First Light sample statement PDF:
//   parse PDF → detect vendor + statement header → normalize → classify →
//   rent-only calculation → the demand must be exactly $5,395.00 (July 2026
//   rent only; EFT fees excluded; prior balance paid off by the EFT payment).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyRow, confidenceToUnit } from "../../engine/classification";
import { calculateRentOnly } from "../../engine/calculation";
import type { LedgerTransaction } from "../../types";

// pdfjs-dist references browser canvas globals at module load. Text
// extraction never touches them, so minimal stubs are enough for Node.
/* eslint-disable @typescript-eslint/no-explicit-any */
(globalThis as any).DOMMatrix ??= class DOMMatrix {
  a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
};
(globalThis as any).Path2D ??= class Path2D {};
(globalThis as any).ImageData ??= class ImageData {};
/* eslint-enable @typescript-eslint/no-explicit-any */

const { parseFile, toParsedLedgerFile, normalizeRecords } = await import("../index");

// In the browser Vite serves the worker via `?url`; under Node that path is
// not importable, so point pdfjs at the real worker file on disk instead.
const { createRequire } = await import("node:module");
const { pathToFileURL } = await import("node:url");
const pdfjs = await import("pdfjs-dist");
pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
).href;

const PDF_PATH = new URL(
  "../../../../../../attached_assets/tenant_statement_1783567530142.pdf",
  import.meta.url,
);

function loadSampleFile(): File {
  const buf = readFileSync(PDF_PATH);
  return new File([new Uint8Array(buf)], "tenant_statement.pdf", { type: "application/pdf" });
}

describe("sample First Light tenant statement (full pipeline)", () => {
  it("yields a $5,395.00 rent-only demand for July 2026", async () => {
    const parsed = await parseFile(loadSampleFile());
    expect(parsed.sourceType).toBe("pdf");
    expect(parsed.ocrUsed).toBe(false);

    const plf = toParsedLedgerFile("tenant_statement.pdf", parsed);
    expect(plf.detectedVendor).toBe("first_light");

    // ---- statement header auto-detection ----
    expect(plf.statement).not.toBeNull();
    expect(plf.statement!.tenantName).toBe("Stan Francois");
    expect(plf.statement!.street).toBe("2021 Carnegie Lane");
    expect(plf.statement!.unit).toBe("5");
    expect(plf.statement!.city).toBe("Redondo Beach");
    expect(plf.statement!.state).toBe("CA");
    expect(plf.statement!.zip).toBe("90278");
    expect(plf.statement!.leaseNumber).toBe("458849");

    // ---- normalize + classify (mirrors importLedger) ----
    const normalized = normalizeRecords(plf.rows, plf.suggestedMapping);
    expect(normalized.rows.length).toBeGreaterThanOrEqual(6);

    const txns: LedgerTransaction[] = normalized.rows.map((row, i) => {
      const cls = classifyRow({
        description: row.description,
        category: row.originalCategory,
        memo: row.memo,
        transactionType: row.transactionType,
        amountCents: row.amountCents,
      });
      return {
        id: `txn_${i}`,
        ledgerId: "ledger_test",
        rowIndex: row.rowIndex,
        date: row.date,
        month: row.month || row.date.slice(0, 7),
        description: row.description,
        originalCategory: row.originalCategory,
        memo: row.memo,
        kind: cls.kind,
        amountCents: row.amountCents,
        balanceCents: row.balanceCents,
        systemClass: cls.category,
        confidence: confidenceToUnit(cls.confidence),
        includedInNotice: cls.includedInNotice,
        classReason: cls.reason,
        userOverrideClass: null,
        overrideReason: null,
        overriddenBy: null,
        flagged: cls.needsReview,
        flagReason: cls.needsReview ? cls.reason : null,
      };
    });

    // The EFT fee rows must be excluded from the notice.
    const eftFees = txns.filter((t) => /eft fee/i.test(t.description));
    expect(eftFees.length).toBeGreaterThan(0);
    for (const fee of eftFees) {
      expect(fee.systemClass).toBe("admin_fee");
      expect(fee.includedInNotice).toBe(false);
    }

    // The prior-balance row is carried as rent but flagged for review.
    const prior = txns.find((t) => /previous balance/i.test(t.description));
    expect(prior).toBeDefined();
    expect(prior!.amountCents).toBe(539500);
    expect(prior!.systemClass).toBe("rent");
    expect(prior!.flagged).toBe(true);

    // ---- rent-only calculation ----
    const calc = calculateRentOnly("ledger_test", txns, {
      computedAt: "2026-07-08T00:00:00.000Z",
    });

    const totalDue = calc.months.reduce((s, m) => s + m.rentOnlyBalanceCents, 0);
    expect(totalDue).toBe(539500); // $5,395.00 — July 2026 rent only

    const delinquent = calc.months.filter((m) => m.rentOnlyBalanceCents > 0);
    expect(delinquent).toHaveLength(1);
    expect(delinquent[0].month).toBe("2026-07");
    expect(delinquent[0].rentOnlyBalanceCents).toBe(539500);
  });
});
