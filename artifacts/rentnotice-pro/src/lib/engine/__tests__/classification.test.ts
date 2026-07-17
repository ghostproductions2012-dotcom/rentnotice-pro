import { describe, expect, it } from "vitest";
import { NEEDS_REVIEW_THRESHOLD, classifyRow, confidenceToUnit } from "../classification";

describe("classification engine", () => {
  it("classifies base rent as rent, included in notice", () => {
    const r = classifyRow({ description: "Base Rent - July", amountCents: 200000 });
    expect(r.category).toBe("rent");
    expect(r.kind).toBe("rent_charge");
    expect(r.includedInNotice).toBe(true);
    expect(r.needsReview).toBe(false);
    expect(r.matchedKeyword).toBeTruthy();
  });

  it("classifies late fee as non-rent, excluded", () => {
    const r = classifyRow({ description: "Late Fee", amountCents: 10000 });
    expect(r.category).toBe("late_fee");
    expect(r.kind).toBe("non_rent_charge");
    expect(r.includedInNotice).toBe(false);
  });

  it("fee keywords beat the generic rent keyword", () => {
    const r = classifyRow({ description: "Late fee on rent", amountCents: 5000 });
    expect(r.category).toBe("late_fee");
    expect(r.includedInNotice).toBe(false);
  });

  it("pet rent is a pet fee, never rent", () => {
    const r = classifyRow({ description: "Pet Rent", amountCents: 5000 });
    expect(r.category).toBe("pet_fee");
    expect(r.includedInNotice).toBe(false);
  });

  it("treats a negative amount as authoritative money-in", () => {
    const r = classifyRow({ description: "Rent", amountCents: -150000 });
    expect(["payment", "credit"]).toContain(r.category);
    expect(r.includedInNotice).toBe(false);
    expect(r.confidence).toBeGreaterThanOrEqual(90);
  });

  it("classifies NSF / returned check charges", () => {
    const r = classifyRow({ description: "Returned check - NSF", amountCents: 3500 });
    expect(r.category).toBe("nsf_fee");
    expect(r.includedInNotice).toBe(false);
  });

  it("classifies utilities (water/sewer/trash) as non-rent", () => {
    const r = classifyRow({ description: "Water & Sewer", amountCents: 8000 });
    expect(r.category).toBe("utility");
    expect(r.includedInNotice).toBe(false);
  });

  it("flags unmatched rows as unclassified needing review", () => {
    const r = classifyRow({ description: "XYZZY misc item", amountCents: 1200 });
    expect(r.category).toBe("unclassified");
    expect(r.kind).toBe("unknown");
    expect(r.needsReview).toBe(true);
    expect(r.confidence).toBeLessThanOrEqual(NEEDS_REVIEW_THRESHOLD);
  });

  // "Tenant Statement" ledgers — real-world descriptions.
  it("classifies a positive EFT fee as a non-rent admin fee, not a payment", () => {
    const r = classifyRow({ description: "EFT fee", amountCents: 129 });
    expect(r.category).toBe("admin_fee");
    expect(r.kind).toBe("non_rent_charge");
    expect(r.includedInNotice).toBe(false);
  });

  it("classifies an EFT convenience fee as a non-rent fee", () => {
    const r = classifyRow({ description: "EFT convenience fee", amountCents: 99 });
    expect(r.kind).toBe("non_rent_charge");
    expect(r.includedInNotice).toBe(false);
  });

  it("treats a negative 'by <tenant>' line as a payment (money in)", () => {
    const r = classifyRow({ description: "by Sofia Garza", amountCents: -230089 });
    expect(r.kind).toBe("payment");
    expect(r.includedInNotice).toBe(false);
  });

  it("classifies a plain 'Rent' line as rent, included in the notice", () => {
    const r = classifyRow({ description: "Rent", amountCents: 250000 });
    expect(r.category).toBe("rent");
    expect(r.includedInNotice).toBe(true);
  });

  it("classifies a security deposit as a deposit, excluded", () => {
    const r = classifyRow({ description: "Security deposit", amountCents: 250000 });
    expect(r.category).toBe("deposit");
    expect(r.includedInNotice).toBe(false);
  });

  it("is deterministic for identical inputs", () => {
    const a = classifyRow({ description: "Base Rent", amountCents: 100000 });
    const b = classifyRow({ description: "Base Rent", amountCents: 100000 });
    expect(a).toEqual(b);
  });

  it("converts 0-100 confidence to 0-1 units", () => {
    expect(confidenceToUnit(88)).toBeCloseTo(0.88);
    expect(confidenceToUnit(0)).toBe(0);
    expect(confidenceToUnit(150)).toBe(1);
  });
});
