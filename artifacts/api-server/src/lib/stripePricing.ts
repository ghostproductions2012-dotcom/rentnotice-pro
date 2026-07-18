import { PLAN_CONFIGS, getPlanConfig } from "./plans";

export interface TierPriceRow {
  tier: string;
  priceId: string;
  unitAmount: number | null;
}

export interface TierPriceMismatch {
  tier: string;
  catalogAmountCents: number;
  liveAmountCents: number | null;
  livePriceId: string | null;
  reason:
    | "amount_mismatch"
    | "no_usable_live_price"
    | "no_live_price"
    | "stray_price_ignored";
}

/**
 * A live Stripe price candidate for a tier. Candidate lists must be ordered
 * newest-first (the DB query orders by pr.created DESC).
 */
export interface RawPriceRow {
  tier: string;
  priceId: string;
  unitAmount: number | null;
}

/**
 * Pick the live price to use for a tier, guarding against stray/test prices
 * in the live Stripe account silently changing the public pricing page:
 * 1. Prefer the price whose amount matches the plan catalog exactly.
 * 2. Otherwise fall back to the newest price with a real (> 0) amount --
 *    a deliberate live price change still wins, but is reported as a mismatch.
 * 3. $0 or amount-less prices are never used unless the catalog price is $0.
 */
export function selectTierPrice(
  tier: string,
  candidates: RawPriceRow[],
  catalogAmountOverride?: number | null,
): { selected: TierPriceRow | null; mismatch: TierPriceMismatch | null } {
  const catalogAmount =
    catalogAmountOverride !== undefined
      ? catalogAmountOverride
      : (getPlanConfig(tier)?.priceMonthlyCents ?? null);

  if (catalogAmount !== null) {
    const exact = candidates.find((c) => c.unitAmount === catalogAmount);
    if (exact) return { selected: exact, mismatch: null };
  }

  const usable = candidates.find(
    (c) =>
      c.unitAmount !== null &&
      (c.unitAmount > 0 || (catalogAmount !== null && catalogAmount === 0)),
  );
  if (usable) {
    return {
      selected: usable,
      mismatch:
        catalogAmount === null
          ? null
          : {
              tier,
              catalogAmountCents: catalogAmount,
              liveAmountCents: usable.unitAmount,
              livePriceId: usable.priceId,
              reason: "amount_mismatch",
            },
    };
  }

  // Only ignored ($0 / amount-less) prices exist for this tier.
  const first = candidates[0];
  return {
    selected: null,
    mismatch:
      catalogAmount === null
        ? null
        : {
            tier,
            catalogAmountCents: catalogAmount,
            liveAmountCents: first?.unitAmount ?? null,
            livePriceId: first?.priceId ?? null,
            reason: "no_usable_live_price",
          },
  };
}

function groupByTier(rows: RawPriceRow[]): Map<string, RawPriceRow[]> {
  const byTier = new Map<string, RawPriceRow[]>();
  for (const row of rows) {
    const list = byTier.get(row.tier) ?? [];
    list.push(row);
    byTier.set(row.tier, list);
  }
  return byTier;
}

/**
 * Compute the per-tier selected prices (and any mismatches) from the raw
 * newest-first price rows. Pure -- no database access.
 */
export function computeTierPrices(rows: RawPriceRow[]): {
  prices: Map<string, TierPriceRow>;
  mismatches: TierPriceMismatch[];
} {
  const byTier = groupByTier(rows);
  const prices = new Map<string, TierPriceRow>();
  const mismatches: TierPriceMismatch[] = [];
  for (const [tier, candidates] of byTier) {
    const { selected, mismatch } = selectTierPrice(tier, candidates);
    if (selected) {
      prices.set(tier, {
        tier: selected.tier,
        priceId: selected.priceId,
        unitAmount: selected.unitAmount,
      });
    }
    if (mismatch) mismatches.push(mismatch);
  }
  return { prices, mismatches };
}

/**
 * Compare the plan catalog against the live Stripe price rows and report
 * every tier that is out of sync. Pure -- no database access.
 */
export function computeTierPriceMismatches(
  rows: RawPriceRow[],
): TierPriceMismatch[] {
  const byTier = groupByTier(rows);
  const mismatches: TierPriceMismatch[] = [];
  for (const plan of PLAN_CONFIGS) {
    const candidates = byTier.get(plan.tier) ?? [];
    if (candidates.length === 0) {
      mismatches.push({
        tier: plan.tier,
        catalogAmountCents: plan.priceMonthlyCents,
        liveAmountCents: null,
        livePriceId: null,
        reason: "no_live_price",
      });
      continue;
    }
    const { selected, mismatch } = selectTierPrice(plan.tier, candidates);
    if (mismatch) mismatches.push(mismatch);
    if (selected) {
      for (const candidate of candidates) {
        if (candidate.priceId === selected.priceId) continue;
        if (candidate.unitAmount === selected.unitAmount) continue;
        mismatches.push({
          tier: plan.tier,
          catalogAmountCents: plan.priceMonthlyCents,
          liveAmountCents: candidate.unitAmount,
          livePriceId: candidate.priceId,
          reason: "stray_price_ignored",
        });
      }
    }
  }
  return mismatches;
}
