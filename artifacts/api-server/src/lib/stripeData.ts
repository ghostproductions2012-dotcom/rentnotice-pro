import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { logger } from "./logger";
import {
  computeTierPrices,
  computeTierPriceMismatches,
  type RawPriceRow,
  type TierPriceRow,
  type TierPriceMismatch,
} from "./stripePricing";

export type { TierPriceRow, TierPriceMismatch } from "./stripePricing";

async function fetchActiveMonthlyPrices(): Promise<RawPriceRow[]> {
  const rows: RawPriceRow[] = [];
  try {
    const result = await db.execute(
      sql`SELECT p.metadata->>'tier' AS tier,
                 pr.id AS price_id,
                 pr.unit_amount
          FROM stripe.products p
          JOIN stripe.prices pr
            ON pr.product = p.id
           AND pr.active = true
           AND pr.recurring->>'interval' = 'month'
          WHERE p.active = true
            AND p.metadata->>'tier' IS NOT NULL
          ORDER BY pr.created DESC`,
    );
    for (const raw of result.rows as Array<Record<string, unknown>>) {
      const tier = raw["tier"] as string | null;
      const priceId = raw["price_id"] as string | null;
      if (!tier || !priceId) continue;
      const unitAmount = raw["unit_amount"];
      rows.push({
        tier,
        priceId,
        unitAmount:
          unitAmount === null || unitAmount === undefined
            ? null
            : Number(unitAmount),
      });
    }
  } catch {
    // stripe schema not migrated yet -- Stripe not connected
  }
  return rows;
}

/**
 * Read live tier prices from the synced stripe schema.
 * Products are matched by metadata.tier (set by scripts/seed-products.ts).
 * Returns an empty map when the stripe schema does not exist yet.
 * Prices that don't match the plan catalog are guarded (see stripePricing.ts)
 * and mismatches are logged.
 */
export async function getTierPrices(): Promise<Map<string, TierPriceRow>> {
  const rows = await fetchActiveMonthlyPrices();
  const { prices, mismatches } = computeTierPrices(rows);
  for (const mismatch of mismatches) {
    logger.warn(
      {
        tier: mismatch.tier,
        catalogAmountCents: mismatch.catalogAmountCents,
        liveAmountCents: mismatch.liveAmountCents,
        livePriceId: mismatch.livePriceId,
        reason: mismatch.reason,
      },
      "Live Stripe price does not match the plan catalog",
    );
  }
  return prices;
}

/**
 * Compare the plan catalog against the live Stripe prices and report
 * every tier that is out of sync. Used by the admin pricing health check.
 */
export async function getTierPriceMismatches(): Promise<TierPriceMismatch[]> {
  const rows = await fetchActiveMonthlyPrices();
  return computeTierPriceMismatches(rows);
}

export function getPublicBaseUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) {
    throw new Error("REPLIT_DOMAINS environment variable is not set");
  }
  return `https://${domain}`;
}
