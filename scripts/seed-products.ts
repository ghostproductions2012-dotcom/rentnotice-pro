import { getUncachableStripeClient } from "./stripeClient";

/**
 * Creates the RentNotice Pro subscription products and monthly prices in
 * Stripe. Idempotent -- products are matched by metadata.tier, so running
 * it multiple times is safe.
 *
 * Run with: npx tsx scripts/seed-products.ts
 */
const TIERS = [
  {
    tier: "starter",
    name: "RentNotice Pro Starter",
    description:
      "For independent landlords managing a handful of units. Up to 3 team members.",
    priceMonthlyCents: 4900,
  },
  {
    tier: "professional",
    name: "RentNotice Pro Professional",
    description:
      "For growing property management teams. Up to 10 team members.",
    priceMonthlyCents: 9900,
  },
  {
    tier: "enterprise",
    name: "RentNotice Pro Enterprise",
    description:
      "For large portfolios and multi-office operations. Up to 50 team members.",
    priceMonthlyCents: 24900,
  },
];

async function createProducts() {
  try {
    const stripe = await getUncachableStripeClient();
    console.log("Creating RentNotice Pro products and prices in Stripe...");

    const existing = await stripe.products.search({
      query: "active:'true'",
      limit: 100,
    });

    for (const config of TIERS) {
      const found = existing.data.find(
        (p) => p.metadata?.tier === config.tier,
      );
      if (found) {
        console.log(
          `Product for tier "${config.tier}" already exists (${found.id}). Skipping.`,
        );
        continue;
      }

      const product = await stripe.products.create({
        name: config.name,
        description: config.description,
        metadata: { tier: config.tier },
      });
      console.log(`Created product: ${product.name} (${product.id})`);

      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: config.priceMonthlyCents,
        currency: "usd",
        recurring: { interval: "month" },
        metadata: { tier: config.tier },
      });
      console.log(
        `Created monthly price: $${(config.priceMonthlyCents / 100).toFixed(2)}/month (${price.id})`,
      );
    }

    console.log("Products and prices ready.");
    console.log("Webhooks will sync this data to your database automatically.");
  } catch (error) {
    console.error(
      "Error creating products:",
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}

createProducts();
