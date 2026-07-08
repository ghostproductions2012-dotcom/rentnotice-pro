import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export interface TierPriceRow {
  tier: string;
  priceId: string;
  unitAmount: number | null;
}

/**
 * Read live tier prices from the synced stripe schema.
 * Products are matched by metadata.tier (set by scripts/seed-products.ts).
 * Returns an empty map when the stripe schema does not exist yet.
 */
export async function getTierPrices(): Promise<Map<string, TierPriceRow>> {
  const map = new Map<string, TierPriceRow>();
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
      if (!tier || !priceId || map.has(tier)) continue;
      const unitAmount = raw["unit_amount"];
      map.set(tier, {
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
  return map;
}

export function getPublicBaseUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0];
  if (!domain) {
    throw new Error("REPLIT_DOMAINS environment variable is not set");
  }
  return `https://${domain}/www`;
}
