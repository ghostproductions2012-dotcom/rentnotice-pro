import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  cloudUsersTable,
  companiesTable,
  licenseKeysTable,
  pendingSignupsTable,
} from "@workspace/db";
import { StartCheckoutBody, CompleteCheckoutBody } from "@workspace/api-zod";
import { getUncachableStripeClient } from "../lib/stripeClient";
import { getPlanConfig } from "../lib/plans";
import { getTierPrices, getPublicBaseUrl } from "../lib/stripeData";
import {
  hashPassword,
  createSession,
  setSessionCookie,
} from "../lib/auth";
import { generateLicenseKey } from "../lib/license";
import { sendWelcomeEmail } from "../lib/email";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/www/checkout/session", async (req, res, next) => {
  try {
    const parsed = StartCheckoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "invalid_input" });
      return;
    }
    const { companyName, adminName, email, password, tier } = parsed.data;
    const normalizedEmail = email.trim().toLowerCase();

    const plan = getPlanConfig(tier);
    if (!plan) {
      res.status(400).json({ error: "Unknown plan", code: "unknown_plan" });
      return;
    }

    const [existing] = await db
      .select({ id: cloudUsersTable.id })
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.email, normalizedEmail));
    if (existing) {
      res.status(400).json({
        error: "An account with this email already exists. Log in instead.",
        code: "email_taken",
      });
      return;
    }

    const tierPrices = await getTierPrices();
    const live = tierPrices.get(tier);
    if (!live) {
      res.status(503).json({
        error:
          "Payments are still being set up. Please try again in a few minutes.",
        code: "payments_unavailable",
      });
      return;
    }

    const [signup] = await db
      .insert(pendingSignupsTable)
      .values({
        companyName,
        adminName,
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        tier,
      })
      .returning();
    if (!signup) throw new Error("Failed to create pending signup");

    const stripe = await getUncachableStripeClient();
    const base = getPublicBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: normalizedEmail,
      line_items: [{ price: live.priceId, quantity: 1 }],
      allow_promotion_codes: true,
      // A 100%-off promo brings the total to $0; don't demand a card then.
      payment_method_collection: "if_required",
      success_url: `${base}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing`,
      metadata: { pendingSignupId: signup.id, tier },
      subscription_data: {
        metadata: { pendingSignupId: signup.id, tier },
      },
    });

    await db
      .update(pendingSignupsTable)
      .set({ stripeSessionId: session.id })
      .where(eq(pendingSignupsTable.id, signup.id));

    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

router.post("/www/checkout/complete", async (req, res, next) => {
  try {
    const parsed = CompleteCheckoutBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid input", code: "invalid_input" });
      return;
    }
    const { sessionId } = parsed.data;

    const [signup] = await db
      .select()
      .from(pendingSignupsTable)
      .where(eq(pendingSignupsTable.stripeSessionId, sessionId));
    if (!signup) {
      res
        .status(400)
        .json({ error: "Unknown checkout session", code: "unknown_session" });
      return;
    }

    // Idempotent: already provisioned -> log in and return existing result
    if (signup.status === "completed") {
      const [user] = await db
        .select()
        .from(cloudUsersTable)
        .where(eq(cloudUsersTable.email, signup.email));
      if (!user) {
        res.status(400).json({
          error: "Provisioned account not found",
          code: "provision_error",
        });
        return;
      }
      const [license] = await db
        .select()
        .from(licenseKeysTable)
        .where(eq(licenseKeysTable.companyId, user.companyId));
      const session = await createSession(user.id);
      setSessionCookie(res, session.token, session.expiresAt);
      res.json({
        licenseKey: license?.key ?? "",
        companyName: signup.companyName,
        tier: signup.tier,
        email: signup.email,
      });
      return;
    }

    const stripe = await getUncachableStripeClient();
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId);
    // "no_payment_required" is what Stripe reports for a fully discounted
    // (100% off) subscription checkout -- treat it like a paid session.
    if (
      checkoutSession.payment_status !== "paid" &&
      checkoutSession.payment_status !== "no_payment_required"
    ) {
      res.status(400).json({
        error: "Payment has not completed for this session",
        code: "not_paid",
      });
      return;
    }

    const stripeCustomerId =
      typeof checkoutSession.customer === "string"
        ? checkoutSession.customer
        : (checkoutSession.customer?.id ?? null);
    const stripeSubscriptionId =
      typeof checkoutSession.subscription === "string"
        ? checkoutSession.subscription
        : (checkoutSession.subscription?.id ?? null);

    const [company] = await db
      .insert(companiesTable)
      .values({
        name: signup.companyName,
        contactEmail: signup.email,
        tier: signup.tier,
        stripeCustomerId,
        stripeSubscriptionId,
      })
      .returning();
    if (!company) throw new Error("Failed to create company");

    const [masterAdmin] = await db
      .insert(cloudUsersTable)
      .values({
        companyId: company.id,
        email: signup.email,
        name: signup.adminName,
        passwordHash: signup.passwordHash,
        role: "admin",
        isMasterAdmin: true,
        active: true,
      })
      .returning();
    if (!masterAdmin) throw new Error("Failed to create master admin");

    const [license] = await db
      .insert(licenseKeysTable)
      .values({
        companyId: company.id,
        key: generateLicenseKey(),
        status: "active",
      })
      .returning();
    if (!license) throw new Error("Failed to create license key");

    await db
      .update(pendingSignupsTable)
      .set({ status: "completed" })
      .where(eq(pendingSignupsTable.id, signup.id));

    logger.info(
      { companyId: company.id, tier: signup.tier },
      "Provisioned company, master admin and license key",
    );

    // Best-effort welcome email; the success page still shows the key.
    void sendWelcomeEmail({
      to: masterAdmin.email,
      adminName: masterAdmin.name,
      companyName: company.name,
      planName: getPlanConfig(company.tier)?.name ?? company.tier,
      licenseKey: license.key,
      portalUrl: `${getPublicBaseUrl()}/portal`,
    });

    const session = await createSession(masterAdmin.id);
    setSessionCookie(res, session.token, session.expiresAt);
    res.json({
      licenseKey: license.key,
      companyName: company.name,
      tier: company.tier,
      email: masterAdmin.email,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
