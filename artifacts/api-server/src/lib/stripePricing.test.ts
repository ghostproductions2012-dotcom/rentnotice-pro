import { describe, expect, it } from "vitest";
import {
  computeTierPriceMismatches,
  computeTierPrices,
  selectTierPrice,
  type RawPriceRow,
} from "./stripePricing";
import { PLAN_CONFIGS, getPlanConfig } from "./plans";

// Catalog amounts, so tests don't hardcode pricing.
const STARTER = getPlanConfig("starter")!.priceMonthlyCents;
const PRO = getPlanConfig("professional")!.priceMonthlyCents;

function row(
  tier: string,
  priceId: string,
  unitAmount: number | null,
): RawPriceRow {
  return { tier, priceId, unitAmount };
}

describe("selectTierPrice", () => {
  it("picks the exact catalog match even when a newer non-matching price exists", () => {
    // Rows are newest-first; the newer stray price must not win.
    const { selected, mismatch } = selectTierPrice("starter", [
      row("starter", "price_new_stray", 12300),
      row("starter", "price_catalog", STARTER),
    ]);
    expect(selected?.priceId).toBe("price_catalog");
    expect(mismatch).toBeNull();
  });

  it("ignores a $0 price and falls back to the newest non-zero price with an amount_mismatch", () => {
    const { selected, mismatch } = selectTierPrice("starter", [
      row("starter", "price_zero", 0),
      row("starter", "price_newest_nonzero", 5500),
      row("starter", "price_older_nonzero", 5100),
    ]);
    expect(selected?.priceId).toBe("price_newest_nonzero");
    expect(mismatch).toEqual({
      tier: "starter",
      catalogAmountCents: STARTER,
      liveAmountCents: 5500,
      livePriceId: "price_newest_nonzero",
      reason: "amount_mismatch",
    });
  });

  it("ignores amount-less (null) prices", () => {
    const { selected } = selectTierPrice("starter", [
      row("starter", "price_null", null),
      row("starter", "price_real", 5500),
    ]);
    expect(selected?.priceId).toBe("price_real");
  });

  it("reports no_usable_live_price when only $0/amount-less prices exist", () => {
    const { selected, mismatch } = selectTierPrice("starter", [
      row("starter", "price_zero", 0),
      row("starter", "price_null", null),
    ]);
    expect(selected).toBeNull();
    expect(mismatch).toEqual({
      tier: "starter",
      catalogAmountCents: STARTER,
      liveAmountCents: 0,
      livePriceId: "price_zero",
      reason: "no_usable_live_price",
    });
  });

  it("allows a $0 price when the catalog amount is $0", () => {
    // No current plan is free, so inject a $0 catalog amount directly.
    const { selected, mismatch } = selectTierPrice(
      "free-tier",
      [row("free-tier", "price_zero", 0)],
      0,
    );
    expect(selected?.priceId).toBe("price_zero");
    expect(mismatch).toBeNull();
  });

  it("ignores a $0 price for tiers with no catalog entry", () => {
    const { selected, mismatch } = selectTierPrice("unknown-tier", [
      row("unknown-tier", "price_zero", 0),
    ]);
    expect(selected).toBeNull();
    // No catalog entry -> no mismatch reported for unknown tiers.
    expect(mismatch).toBeNull();
  });

  it("selects the newest non-zero price for unknown tiers without reporting a mismatch", () => {
    const { selected, mismatch } = selectTierPrice("unknown-tier", [
      row("unknown-tier", "price_a", 777),
    ]);
    expect(selected?.priceId).toBe("price_a");
    expect(mismatch).toBeNull();
  });
});

describe("computeTierPrices", () => {
  it("returns the catalog-matching price per tier and no mismatches when everything matches", () => {
    const { prices, mismatches } = computeTierPrices([
      row("starter", "price_s", STARTER),
      row("professional", "price_p", PRO),
    ]);
    expect(prices.get("starter")?.priceId).toBe("price_s");
    expect(prices.get("professional")?.priceId).toBe("price_p");
    expect(mismatches).toEqual([]);
  });

  it("omits tiers with only unusable prices and reports the mismatch", () => {
    const { prices, mismatches } = computeTierPrices([
      row("starter", "price_zero", 0),
    ]);
    expect(prices.has("starter")).toBe(false);
    expect(mismatches).toHaveLength(1);
    expect(mismatches[0]?.reason).toBe("no_usable_live_price");
  });

  it("regression: a stray $0 Starter price never reaches the pricing page", () => {
    const { prices } = computeTierPrices([
      row("starter", "price_zero_stray", 0),
      row("starter", "price_catalog", STARTER),
    ]);
    expect(prices.get("starter")?.unitAmount).toBe(STARTER);
  });
});

describe("computeTierPriceMismatches", () => {
  function fullCatalogRows(): RawPriceRow[] {
    return PLAN_CONFIGS.map((p) =>
      row(p.tier, `price_${p.tier}`, p.priceMonthlyCents),
    );
  }

  it("reports nothing when every tier matches the catalog", () => {
    expect(computeTierPriceMismatches(fullCatalogRows())).toEqual([]);
  });

  it("reports no_live_price for catalog tiers with no live prices at all", () => {
    const rows = fullCatalogRows().filter((r) => r.tier !== "starter");
    const mismatches = computeTierPriceMismatches(rows);
    expect(mismatches).toEqual([
      {
        tier: "starter",
        catalogAmountCents: STARTER,
        liveAmountCents: null,
        livePriceId: null,
        reason: "no_live_price",
      },
    ]);
  });

  it("reports stray_price_ignored for extra non-selected prices with different amounts", () => {
    const rows = [
      row("starter", "price_stray", 12300),
      ...fullCatalogRows(),
    ];
    const mismatches = computeTierPriceMismatches(rows);
    expect(mismatches).toEqual([
      {
        tier: "starter",
        catalogAmountCents: STARTER,
        liveAmountCents: 12300,
        livePriceId: "price_stray",
        reason: "stray_price_ignored",
      },
    ]);
  });

  it("does not report duplicates of the selected price amount as stray", () => {
    const rows = [
      row("starter", "price_dup", STARTER),
      ...fullCatalogRows(),
    ];
    expect(computeTierPriceMismatches(rows)).toEqual([]);
  });

  it("reports both amount_mismatch and no_live_price across tiers", () => {
    const rows = fullCatalogRows()
      .filter((r) => r.tier !== "professional")
      .map((r) =>
        r.tier === "starter" ? row("starter", "price_changed", 5900) : r,
      );
    const mismatches = computeTierPriceMismatches(rows);
    expect(mismatches).toContainEqual({
      tier: "starter",
      catalogAmountCents: STARTER,
      liveAmountCents: 5900,
      livePriceId: "price_changed",
      reason: "amount_mismatch",
    });
    expect(mismatches).toContainEqual({
      tier: "professional",
      catalogAmountCents: PRO,
      liveAmountCents: null,
      livePriceId: null,
      reason: "no_live_price",
    });
    expect(mismatches).toHaveLength(2);
  });
});
