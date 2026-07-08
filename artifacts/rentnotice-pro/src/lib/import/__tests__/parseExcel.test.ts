// Excel (.xlsx) import pipeline coverage. Workbooks are generated in-test with
// SheetJS (XLSX.write -> Blob) so no binary fixtures are checked in. Mirrors
// the CSV pipeline tests: parse -> suggest mapping -> normalize.

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseDateToIso } from "../dates";
import { suggestMapping } from "../mapping";
import { normalizeRows } from "../normalize";
import { parseExcelFile } from "../parseExcel";
import { detectVendor } from "../presets";

/** Build an in-memory .xlsx Blob from a 2D array of cell values. */
function makeXlsxBlob(
  aoa: unknown[][],
  options?: { dateFormat?: string; sheetName?: string },
): Blob {
  const sheet = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  if (options?.dateFormat) {
    const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && (cell.t === "d" || cell.t === "n")) {
          if (cell.t === "d") cell.z = options.dateFormat;
        }
      }
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, options?.sheetName ?? "Ledger");
  const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Set an explicit Excel serial-number date cell (numeric value + date format). */
function setSerialDateCell(sheet: XLSX.WorkSheet, address: string, serial: number): void {
  sheet[address] = { t: "n", v: serial, z: "m/d/yyyy" };
}

describe("parseExcelFile", () => {
  it("parses a simple workbook into headers and string rows", async () => {
    const blob = makeXlsxBlob([
      ["Date", "Description", "Charges", "Payments", "Balance"],
      [new Date(Date.UTC(2026, 6, 1)), "Rent charge July", 2000, "", 2000],
      [new Date(Date.UTC(2026, 6, 3)), "Online payment", "", 1500, 500],
    ]);

    const table = await parseExcelFile(blob);
    expect(table.headers).toEqual(["Date", "Description", "Charges", "Payments", "Balance"]);
    expect(table.rows).toHaveLength(2);
    // Every cell must come back as a string (RawTable contract).
    for (const row of table.rows) {
      for (const cell of row) {
        expect(typeof cell).toBe("string");
      }
    }
    expect(table.rows[0]![1]).toBe("Rent charge July");
  });

  it("detects the header row past preamble/title rows, like the CSV parser", async () => {
    const blob = makeXlsxBlob([
      ["Sunrise Property Management"],
      ["Tenant Ledger — Unit 4B"],
      [],
      ["Date", "Description", "Charges", "Payments", "Balance"],
      [new Date(Date.UTC(2026, 6, 1)), "Rent charge", 2000, "", 2000],
      [new Date(Date.UTC(2026, 6, 3)), "Payment received", "", 2000, 0],
    ]);

    const table = await parseExcelFile(blob);
    expect(table.headers).toEqual(["Date", "Description", "Charges", "Payments", "Balance"]);
    expect(table.rows).toHaveLength(2);
  });

  it("returns an empty table for a workbook with no sheets", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([[]]), "Empty");
    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
    const table = await parseExcelFile(new Blob([out]));
    expect(table.headers).toEqual([]);
    expect(table.rows).toEqual([]);
  });

  it("end-to-end: Excel ledger normalizes identically to the CSV fixture", async () => {
    const blob = makeXlsxBlob(
      [
        ["Date", "Description", "Charges", "Payments", "Balance"],
        [new Date(Date.UTC(2026, 6, 1)), "Rent charge July", 2000, "", 2000],
        [new Date(Date.UTC(2026, 6, 5)), "Late fee", 100, "", 2100],
        [new Date(Date.UTC(2026, 6, 10)), "Online payment", "", 1500, 600],
        [new Date(Date.UTC(2026, 7, 1)), "Rent charge August", 2000, "", 2600],
      ],
      { dateFormat: "m/d/yyyy" },
    );

    const table = await parseExcelFile(blob);
    const suggestion = suggestMapping(table);
    expect(suggestion.mapping.date).toBe("Date");
    expect(suggestion.mapping.chargeAmount).toBe("Charges");
    expect(suggestion.mapping.paymentAmount).toBe("Payments");
    expect(suggestion.amountMode).toBe("split");

    const result = normalizeRows(table, suggestion.mapping);
    expect(result.rows).toHaveLength(4);
    const [rent, fee, pay, rentAug] = result.rows;
    expect(rent!.date).toBe("2026-07-01");
    expect(rent!.month).toBe("2026-07");
    expect(rent!.amountCents).toBe(200000);
    expect(fee!.amountCents).toBe(10000);
    expect(pay!.amountCents).toBe(-150000);
    expect(rentAug!.date).toBe("2026-08-01");
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-08-01");
  });
});

describe("Excel serial-number dates", () => {
  it("parseDateToIso converts raw serial numbers", () => {
    // 2026-07-01 is 46204 days after 1899-12-30.
    expect(parseDateToIso(46204)).toBe("2026-07-01");
    expect(parseDateToIso(25569)).toBe("1970-01-01");
    // Out-of-range numbers are not dates.
    expect(parseDateToIso(0)).toBeNull();
    expect(parseDateToIso(700000)).toBeNull();
  });

  it("serial-date cells with a date format flow through parseExcelFile as real dates", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Date", "Description", "Amount"],
      [0, "Rent", 2000],
      [0, "Payment", -2000],
    ]);
    setSerialDateCell(sheet, "A2", 46204); // 2026-07-01
    setSerialDateCell(sheet, "A3", 46235); // 2026-08-01
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Ledger");
    const out = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const table = await parseExcelFile(new Blob([out]));
    const { mapping } = suggestMapping(table);
    const result = normalizeRows(table, mapping);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.date).toBe("2026-07-01");
    expect(result.rows[1]!.date).toBe("2026-08-01");
  });
});

describe("single signed-amount column mode", () => {
  const signedRows: unknown[][] = [
    ["Date", "Description", "Amount", "Balance"],
    [new Date(Date.UTC(2026, 6, 1)), "Rent", 2000, 2000],
    [new Date(Date.UTC(2026, 6, 3)), "by Jane Tenant", -2000, 0],
    [new Date(Date.UTC(2026, 7, 1)), "Rent", 2000, 2000],
    [new Date(Date.UTC(2026, 7, 2)), "EFT fee", 25, 2025],
    [new Date(Date.UTC(2026, 7, 6)), "by Jane Tenant", -2025, 0],
  ];

  it("suggestMapping detects a single signed amount column", async () => {
    const table = await parseExcelFile(makeXlsxBlob(signedRows));
    const suggestion = suggestMapping(table);
    expect(suggestion.mapping.amount).toBe("Amount");
    expect(suggestion.mapping.balance).toBe("Balance");
    expect(suggestion.amountMode).toBe("single");
  });

  it("normalizes signed amounts: charges positive, negatives stay payments", async () => {
    const table = await parseExcelFile(makeXlsxBlob(signedRows));
    const { mapping } = suggestMapping(table);
    const result = normalizeRows(table, mapping);
    expect(result.rows).toHaveLength(5);
    expect(result.rows.map((r) => r.amountCents)).toEqual([
      200000, -200000, 200000, 2500, -202500,
    ]);
    expect(result.rows[1]!.description).toBe("by Jane Tenant");
    expect(result.rows[0]!.balanceCents).toBe(200000);
    expect(result.rows[4]!.balanceCents).toBe(0);
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-08-06");
  });

  it("handles parenthesized negatives in a single amount column", async () => {
    const table = await parseExcelFile(
      makeXlsxBlob([
        ["Date", "Description", "Amount"],
        ["07/01/2026", "Rent", "$2,000.00"],
        ["07/03/2026", "Payment received", "($2,000.00)"],
      ]),
    );
    const { mapping } = suggestMapping(table);
    const result = normalizeRows(table, mapping);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]!.amountCents).toBe(200000);
    expect(result.rows[1]!.amountCents).toBe(-200000);
  });
});

describe("vendor detection from Excel headers", () => {
  it("detects AppFolio from its header signature", async () => {
    const table = await parseExcelFile(
      makeXlsxBlob([
        ["Date", "Type", "Description", "Charge", "Payment", "Balance", "Reference"],
        ["07/01/2026", "Charge", "Rent", "2000", "", "2000", "R-1"],
      ]),
    );
    const detection = detectVendor(table.headers);
    expect(detection.vendor).toBe("appfolio");
    expect(detection.confidence).toBeGreaterThanOrEqual(80);
    expect(detection.preset?.vendor).toBe("appfolio");
  });

  it("detects Yardi from its header signature", async () => {
    const table = await parseExcelFile(
      makeXlsxBlob([
        ["Post Date", "Trans Type", "Charge Code", "Description", "Charges", "Payments", "Balance", "Notes"],
        ["07/01/2026", "CHG", "RENT", "Rent", "2000", "", "2000", ""],
      ]),
    );
    const detection = detectVendor(table.headers);
    expect(detection.vendor).toBe("yardi");
    expect(detection.preset?.vendor).toBe("yardi");
  });

  it("falls back to generic for unrecognized headers", () => {
    const detection = detectVendor(["Foo", "Bar", "Baz"]);
    expect(detection.vendor).toBe("generic");
    expect(detection.confidence).toBe(0);
    expect(detection.preset).toBeNull();
  });
});
