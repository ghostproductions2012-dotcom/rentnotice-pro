/**
 * Seed the 100% off test promotion code used by the owner to live-test the
 * full purchase path (checkout -> license -> welcome email -> portal) at $0.
 *
 * Idempotent: the coupon is matched by its fixed id and the promotion code
 * by its code string; existing active objects are left untouched.
 *
 * Run with: node scripts/seed-promo.ts   (Node >= 22.18 type stripping)
 */
import Stripe from "stripe";
import { getUncachableStripeClient } from "../src/lib/stripeClient.ts";

const COUPON_ID = "testfree100";
const PROMO_CODE = "TESTFREE100";

async function ensureCoupon(stripe: Stripe): Promise<Stripe.Coupon> {
  try {
    const existing = await stripe.coupons.retrieve(COUPON_ID);
    if (existing.valid) {
      console.log(`Coupon exists: ${existing.id} (${existing.percent_off}% off, ${existing.duration})`);
      return existing;
    }
    console.log(`Coupon ${COUPON_ID} exists but is no longer valid; deleting and recreating.`);
    await stripe.coupons.del(COUPON_ID);
  } catch (err) {
    if (!(err instanceof Stripe.errors.StripeError) || err.statusCode !== 404) {
      throw err;
    }
  }
  const coupon = await stripe.coupons.create({
    id: COUPON_ID,
    percent_off: 100,
    duration: "forever",
    name: "Owner live-test (100% off)",
  });
  console.log(`Created coupon: ${coupon.id} (100% off, forever)`);
  return coupon;
}

async function ensurePromotionCode(
  stripe: Stripe,
  couponId: string,
): Promise<Stripe.PromotionCode> {
  const existing = await stripe.promotionCodes.list({
    code: PROMO_CODE,
    limit: 10,
  });
  const active = existing.data.find((p) => p.active);
  if (active) {
    console.log(`Promotion code exists: ${active.code} (${active.id})`);
    return active;
  }
  const promo = await stripe.promotionCodes.create({
    promotion: { type: "coupon", coupon: couponId },
    code: PROMO_CODE,
  });
  console.log(`Created promotion code: ${promo.code} (${promo.id})`);
  return promo;
}

async function main(): Promise<void> {
  const stripe = await getUncachableStripeClient();
  const coupon = await ensureCoupon(stripe);
  await ensurePromotionCode(stripe, coupon.id);
  console.log(
    `Done. Enter code ${PROMO_CODE} in the "Add promotion code" field on the Stripe checkout page to bring the total to $0.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Promo seed failed:", err);
  process.exit(1);
});
