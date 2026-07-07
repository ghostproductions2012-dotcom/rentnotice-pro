import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseDateToIso, parseMonthToIso } from "../dates";
import { suggestMapping } from "../mapping";
import { parseMoneyToCents } from "../money";
import { normalizeRows } from "../normalize";
import { parseCsvText } from "../parseCsv";
import { BUILTIN_PRESETS, getPreset } from "../presets";

const fixtureCsv = readFileSync(
  new URL("./fixtures/generic-ledger.csv", import.meta.url),
  "utf8",
);

describe("money parsing", () => {
  it("parses formatted currency into cents", () => {
    expect(parseMoneyToCents("$1,234.56")).toBe(123456);
    expect(parseMoneyToCents("2000")).toBe(200000);
    expect(parseMoneyToCents(19.99)).toBe(1999);
  });

  it("treats parentheses as negative amounts", () => {
    expect(parseMoneyToCents("(50.00)")).toBe(-5000);
    expect(parseMoneyToCents("-75.25")).toBe(-7525);
  });

  it("returns null for non-money input", () => {
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents(null)).toBeNull();
  });
});

describe("date parsing", () => {
  it("parses US and ISO dates to ISO", () => {
    expect(parseDateToIso("07/01/2026")).toBe("2026-07-01");
    expect(parseDateToIso("2026-07-01")).toBe("2026-07-01");
  });

  it("parses month strings", () => {
    expect(parseMonthToIso("July 2026")).toBe("2026-07");
    expect(parseMonthToIso("2026-07")).toBe("2026-07");
  });

  it("returns null for garbage", () => {
    expect(parseDateToIso("not a date")).toBeNull();
    expect(parseDateToIso(null)).toBeNull();
  });
});

describe("CSV import pipeline", () => {
  it("parses CSV text and detects the header row past preamble lines", () => {
    const table = parseCsvText(fixtureCsv);
    expect(table.headers).toEqual(["Date", "Description", "Charges", "Payments", "Balance"]);
    expect(table.rows).toHaveLength(4);
  });

  it("suggests a split charge/payment column mapping", () => {
    const table = parseCsvText(fixtureCsv);
    const suggestion = suggestMapping(table);
    expect(suggestion.mapping.date).toBe("Date");
    expect(suggestion.mapping.description).toBe("Description");
    expect(suggestion.mapping.chargeAmount).toBe("Charges");
    expect(suggestion.mapping.paymentAmount).toBe("Payments");
    expect(suggestion.amountMode).toBe("split");
  });

  it("normalizes rows into signed cents with ISO dates", () => {
    const table = parseCsvText(fixtureCsv);
    const { mapping } = suggestMapping(table);
    const result = normalizeRows(table, mapping);
    expect(result.rows).toHaveLength(4);

    const [rentRow, feeRow, payRow] = result.rows;
    expect(rentRow!.date).toBe("2026-07-01");
    expect(rentRow!.month).toBe("2026-07");
    expect(rentRow!.amountCents).toBe(200000); // charge = positive
    expect(feeRow!.amountCents).toBe(10000);
    expect(payRow!.amountCents).toBe(-150000); // payment = negative
    expect(result.periodStart).toBe("2026-07-01");
    expect(result.periodEnd).toBe("2026-08-01");
  });
});

describe("PM vendor presets", () => {
  it("ships built-in presets for the major PM platforms", () => {
    const vendors = BUILTIN_PRESETS.map((p) => p.vendor);
    for (const v of ["appfolio", "yardi", "buildium", "propertyware", "rent_manager"]) {
      expect(vendors).toContain(v);
    }
  });

  it("returns a usable preset by vendor key", () => {
    const preset = getPreset("appfolio");
    expect(preset).not.toBeNull();
    expect(preset!.mapping.date).toBeTruthy();
  });
});
