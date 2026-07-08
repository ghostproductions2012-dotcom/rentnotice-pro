/**
 * Seed Stripe products/prices from the tier catalog in src/lib/plans.ts.
 *
 * Idempotent: products are matched by metadata.tier; existing active
 * products with a matching active monthly price are left untouched.
 * After seeding, runs a stripe-replit-sync backfill so the local
 * stripe schema reflects the new products immediately.
 *
 * Run with: node scripts/seed-products.ts   (Node >= 22.18 type stripping)
 */
import Stripe from "stripe";
import { PLAN_CONFIGS } from "../src/lib/plans.ts";
import {
  getUncachableStripeClient,
  getStripeSync,
} from "../src/lib/stripeClient.ts";

async function findProductByTier(
  stripe: Stripe,
  tier: string,
): Promise<Stripe.Product | undefined> {
  const result = await stripe.products.search({
    query: `active:'true' AND metadata['tier']:'${tier}'`,
  });
  return result.data[0];
}

async function findMonthlyPrice(
  stripe: Stripe,
  productId: string,
  unitAmount: number,
): Promise<Stripe.Price | undefined> {
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: "recurring",
    limit: 100,
  });
  return prices.data.find(
    (p) =>
      p.recurring?.interval === "month" &&
      p.unit_amount === unitAmount &&
      p.currency === "usd",
  );
}

async function main(): Promise<void> {
  const stripe = await getUncachableStripeClient();

  for (const plan of PLAN_CONFIGS) {
    let product = await findProductByTier(stripe, plan.tier);
    if (product) {
      console.log(`[${plan.tier}] product exists: ${product.id}`);
    } else {
      product = await stripe.products.create({
        name: `RentNotice Pro ${plan.name}`,
        description: plan.description,
        metadata: { tier: plan.tier, seats: String(plan.seats) },
      });
      console.log(`[${plan.tier}] created product: ${product.id}`);
    }

    let price = await findMonthlyPrice(
      stripe,
      product.id,
      plan.priceMonthlyCents,
    );
    if (price) {
      console.log(`[${plan.tier}] monthly price exists: ${price.id}`);
    } else {
      price = await stripe.prices.create({
        product: product.id,
        unit_amount: plan.priceMonthlyCents,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { tier: plan.tier },
      });
      console.log(
        `[${plan.tier}] created monthly price: ${price.id} ($${(plan.priceMonthlyCents / 100).toFixed(2)}/mo)`,
      );
    }
  }

  console.log("Syncing Stripe data into local stripe schema...");
  const sync = await getStripeSync();
  // NOTE: syncBackfill() without params has been observed to sync nothing;
  // sync the object types we need explicitly.
  const products = await sync.syncProducts();
  const prices = await sync.syncPrices();
  console.log(
    `Done. Products seeded and synced (products: ${products.synced}, prices: ${prices.synced}).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
