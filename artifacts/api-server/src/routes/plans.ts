import { Router, type IRouter } from "express";
import { PLAN_CONFIGS } from "../lib/plans";
import { getTierPrices } from "../lib/stripeData";

const router: IRouter = Router();

router.get("/www/plans", async (_req, res, next) => {
  try {
    const tierPrices = await getTierPrices();
    const plans = PLAN_CONFIGS.map((plan) => {
      const live = tierPrices.get(plan.tier);
      return {
        tier: plan.tier,
        name: plan.name,
        description: plan.description,
        seats: plan.seats,
        priceMonthlyCents: live?.unitAmount ?? plan.priceMonthlyCents,
        features: plan.features,
        stripePriceId: live?.priceId ?? null,
        available: Boolean(live),
        highlighted: plan.highlighted,
      };
    });
    res.json(plans);
  } catch (err) {
    next(err);
  }
});

export default router;
