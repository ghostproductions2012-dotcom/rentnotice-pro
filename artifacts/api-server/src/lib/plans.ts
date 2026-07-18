export interface PlanConfig {
  tier: string;
  name: string;
  description: string;
  /** Seat limit for the tier; null means unlimited (no seat cap). */
  seats: number | null;
  priceMonthlyCents: number;
  features: string[];
  highlighted: boolean;
}

/**
 * Tier catalog. Stripe products are created from this config by
 * scripts/seed-products.ts and matched back via product metadata.tier.
 * Prices shown here are placeholders until final pricing is decided;
 * the live Stripe price always wins once products are seeded.
 */
export const PLAN_CONFIGS: PlanConfig[] = [
  {
    tier: "starter",
    name: "Starter",
    description: "For independent landlords managing a handful of units.",
    seats: 3,
    priceMonthlyCents: 4900,
    features: [
      "Up to 3 team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Email support",
    ],
    highlighted: false,
  },
  {
    tier: "professional",
    name: "Professional",
    description: "For growing property management teams.",
    seats: 10,
    priceMonthlyCents: 9900,
    features: [
      "Up to 10 team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Role-based access control",
      "Priority support",
    ],
    highlighted: true,
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    description: "For large portfolios and multi-office operations.",
    seats: 50,
    priceMonthlyCents: 24900,
    features: [
      "Up to 50 team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Role-based access control",
      "Dedicated onboarding",
      "Priority support",
    ],
    highlighted: false,
  },
  {
    tier: "unlimited",
    name: "Unlimited",
    description: "For large customers who never want to think about seats.",
    seats: null,
    priceMonthlyCents: 74999,
    features: [
      "Unlimited team members",
      "Unlimited rent notices",
      "State-compliant notice templates",
      "Desktop app license",
      "Role-based access control",
      "Dedicated onboarding",
      "Priority support",
    ],
    highlighted: false,
  },
];

export function getPlanConfig(tier: string): PlanConfig | undefined {
  return PLAN_CONFIGS.find((p) => p.tier === tier);
}
