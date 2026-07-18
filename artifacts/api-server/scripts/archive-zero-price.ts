/**
 * Deactivate (archive) the stray $0/month Starter price in the live Stripe
 * account so the pricing health check goes back to green.
 *
 * Idempotent: if the price is already inactive this is a no-op.
 *
 * Run with: node scripts/archive-zero-price.ts
 */
import { getUncachableStripeClient } from "../src/lib/stripeClient.ts";

const PRICE_ID = "price_1Tr7iNIOuX9KXYagrtmTy1PV";

async function main() {
  const stripe = await getUncachableStripeClient();
  const price = await stripe.prices.retrieve(PRICE_ID);
  console.log(
    `Price ${price.id}: unit_amount=${price.unit_amount} active=${price.active} product=${price.product}`,
  );
  if (price.unit_amount !== 0) {
    throw new Error(
      `Refusing to archive: price ${PRICE_ID} is not $0 (unit_amount=${price.unit_amount})`,
    );
  }
  if (!price.active) {
    console.log("Price is already inactive; nothing to do.");
    return;
  }
  const updated = await stripe.prices.update(PRICE_ID, { active: false });
  console.log(`Archived price ${updated.id}; active=${updated.active}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
