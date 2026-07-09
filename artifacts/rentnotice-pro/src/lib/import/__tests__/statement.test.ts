import { describe, expect, it } from "vitest";
import { classifyRow } from "../../engine/classification";
import { isPriorBalanceDescription, normalizeRecords } from "../normalize";
import { extractStatementInfo } from "../statement";
import type { ColumnMapping } from "../../types";

// Header lines as reconstructed from the First Light "Tenant Statement" PDF.
const FIRST_LIGHT_HEADER = [
  "First Light Property Management, Inc.",
  "1600 S Pacific Coast Hwy, Suite 100",
  "Redondo Beach, CA 90277",
  "Tenant Statement",
  "4/7/2026 - 7/7/2026",
  "Stan Francois",
  "Lease # 458849 2021 Carnegie Lane",
  "#5",
  "Redondo Beach, CA 90278",
  "Date Description Charge Payment Balance",
];

describe("tenant statement header extraction", () => {
  it("extracts the full header from a First Light tenant statement", () => {
    const info = extractStatementInfo(FIRST_LIGHT_HEADER);
    expect(info).not.toBeNull();
    expect(info!.vendor).toBe("first_light");
    expect(info!.tenantName).toBe("Stan Francois");
    expect(info!.street).toBe("2021 Carnegie Lane");
    expect(info!.unit).toBe("5");
    expect(info!.city).toBe("Redondo Beach");
    expect(info!.state).toBe("CA");
    expect(info!.zip).toBe("90278");
    expect(info!.leaseNumber).toBe("458849");
    expect(info!.periodStart).toBe("2026-04-07");
    expect(info!.periodEnd).toBe("2026-07-07");
  });

  it("prefers the premises city/state/zip over the company letterhead", () => {
    const info = extractStatementInfo(FIRST_LIGHT_HEADER);
    expect(info!.zip).toBe("90278"); // premises, not the 90277 letterhead
  });

  it("returns null for files that are not tenant statements", () => {
    expect(extractStatementInfo(["Rent Roll Report", "January 2026"])).toBeNull();
    expect(extractStatementInfo([])).toBeNull();
  });

  it("strips First Light listing-index suffixes from the property label line", () => {
    const info = extractStatementInfo([
      "Tenant Statement",
      "Stan Francois",
      "Lease # 458849 2021 Carnegie Lane #5 - 1",
      "Redondo Beach, CA 90278",
    ]);
    expect(info!.street).toBe("2021 Carnegie Lane");
    expect(info!.unit).toBe("5");
  });

  it("handles a street with a trailing unit marker on one line", () => {
    const info = extractStatementInfo([
      "Tenant Statement",
      "Jane Q Tenant",
      "Lease # 12345 100 Main Street #12B",
      "Los Angeles, CA 90001",
    ]);
    expect(info!.tenantName).toBe("Jane Q Tenant");
    expect(info!.street).toBe("100 Main Street");
    expect(info!.unit).toBe("12B");
    expect(info!.city).toBe("Los Angeles");
  });
});

describe("prior-balance handling", () => {
  it("recognizes carried-forward balance descriptions", () => {
    expect(isPriorBalanceDescription("Previous balance")).toBe(true);
    expect(isPriorBalanceDescription("Balance forward")).toBe(true);
    expect(isPriorBalanceDescription("Beginning Balance")).toBe(true);
    expect(isPriorBalanceDescription("Rent for July")).toBe(false);
    expect(isPriorBalanceDescription("EFT fees")).toBe(false);
  });

  it("takes the amount from the balance column for balance-only prior-balance rows", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      description: "Description",
      chargeAmount: "Charge",
      paymentAmount: "Payment",
      creditAmount: null,
      amount: null,
      balance: "Balance",
      transactionType: null,
      category: null,
      memo: null,
      month: null,
      tenantIdentifier: null,
    };
    const records = [
      { Date: "4/7/2026", Description: "Previous balance", Charge: "", Payment: "", Balance: "5,395.00" },
      { Date: "5/1/2026", Description: "Rent", Charge: "5,395.00", Payment: "", Balance: "10,790.00" },
    ];
    const result = normalizeRecords(records, mapping);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].amountCents).toBe(539500);
    expect(result.rows[0].warnings.join(" ")).toMatch(/balance column/i);
    expect(result.rows[1].amountCents).toBe(539500);
  });

  it("still skips non-prior-balance rows that have no amount", () => {
    const mapping: ColumnMapping = {
      date: "Date",
      description: "Description",
      chargeAmount: "Charge",
      paymentAmount: null,
      creditAmount: null,
      amount: null,
      balance: "Balance",
      transactionType: null,
      category: null,
      memo: null,
      month: null,
      tenantIdentifier: null,
    };
    const records = [
      { Date: "5/1/2026", Description: "Statement note", Charge: "", Balance: "100.00" },
    ];
    const result = normalizeRecords(records, mapping);
    expect(result.rows).toHaveLength(0);
  });

  it("classifies prior balance as rent owed but flags it for review", () => {
    const res = classifyRow({ description: "Previous balance", amountCents: 539500 });
    expect(res.category).toBe("rent");
    expect(res.kind).toBe("rent_charge");
    expect(res.includedInNotice).toBe(true);
    expect(res.needsReview).toBe(true);
    expect(res.confidence).toBeLessThan(70);
  });
});

describe("statement row classification (rent-only demand)", () => {
  it("classifies rent charges as demandable rent", () => {
    const res = classifyRow({ description: "Rent", amountCents: 539500 });
    expect(res.category).toBe("rent");
    expect(res.includedInNotice).toBe(true);
  });

  it("excludes EFT fees from the notice", () => {
    const res = classifyRow({ description: "EFT fees", amountCents: 129 });
    expect(res.category).toBe("admin_fee");
    expect(res.includedInNotice).toBe(false);
  });

  it("treats negative amounts as payments, not charges", () => {
    const res = classifyRow({ description: "EFT payment", amountCents: -539629 });
    expect(res.category).toBe("payment");
    expect(res.includedInNotice).toBe(false);
  });
});
