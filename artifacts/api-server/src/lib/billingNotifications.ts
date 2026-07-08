import { eq, and, desc } from "drizzle-orm";
import { db, companiesTable, cloudUsersTable } from "@workspace/db";
import type { Company } from "@workspace/db";
import {
  sendPaymentFailedEmail,
  sendCancellationScheduledEmail,
} from "./email";
import { getPublicBaseUrl } from "./stripeData";
import { logger } from "./logger";

/**
 * Billing warning emails driven by Stripe webhook events.
 *
 * Dispatched AFTER stripe-replit-sync has verified the webhook signature and
 * synced the event, so the payload here is trusted. Everything in this module
 * is best-effort: failures are logged and swallowed so webhook processing
 * (and Stripe's delivery acknowledgement) is never broken by email issues.
 */

interface StripeEventPayload {
  type?: string;
  data?: {
    object?: Record<string, unknown>;
    previous_attributes?: Record<string, unknown>;
  };
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Stripe expands some references into objects; accept both shapes. */
function refId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    return asString((value as { id?: unknown }).id);
  }
  return null;
}

function epochToDate(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return new Date(value * 1000);
}

/**
 * Newer Stripe API versions report current_period_end on the subscription
 * ITEMS rather than the subscription itself. Take the latest of both.
 */
function subscriptionPeriodEnd(sub: Record<string, unknown>): Date | null {
  const candidates: number[] = [];
  const topLevel = sub["current_period_end"];
  if (typeof topLevel === "number") candidates.push(topLevel);
  const items = sub["items"];
  if (items && typeof items === "object" && "data" in items) {
    const data = (items as { data?: unknown }).data;
    if (Array.isArray(data)) {
      for (const item of data) {
        if (item && typeof item === "object") {
          const end = (item as Record<string, unknown>)["current_period_end"];
          if (typeof end === "number") candidates.push(end);
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates) * 1000);
}

async function findCompany(
  customerId: string | null,
  subscriptionId: string | null,
): Promise<Company | null> {
  if (customerId) {
    const [byCustomer] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.stripeCustomerId, customerId));
    if (byCustomer) return byCustomer;
  }
  if (subscriptionId) {
    const [bySub] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.stripeSubscriptionId, subscriptionId));
    if (bySub) return bySub;
  }
  return null;
}

/**
 * Resolve the billing contact: the master admin's current account email,
 * falling back to the company contact email captured at signup.
 */
async function resolveBillingContact(
  company: Company,
): Promise<{ email: string; name: string }> {
  const [masterAdmin] = await db
    .select()
    .from(cloudUsersTable)
    .where(
      and(
        eq(cloudUsersTable.companyId, company.id),
        eq(cloudUsersTable.isMasterAdmin, true),
        eq(cloudUsersTable.active, true),
      ),
    )
    .orderBy(desc(cloudUsersTable.createdAt));
  if (masterAdmin) {
    return { email: masterAdmin.email, name: masterAdmin.name };
  }
  return { email: company.contactEmail, name: company.name };
}

function portalUrl(): string {
  return `${getPublicBaseUrl()}/portal`;
}

async function handlePaymentFailed(
  invoice: Record<string, unknown>,
): Promise<void> {
  const customerId = refId(invoice["customer"]);
  // Older API versions: invoice.subscription; newer: parent.subscription_details
  let subscriptionId = refId(invoice["subscription"]);
  if (!subscriptionId) {
    const parent = invoice["parent"];
    if (parent && typeof parent === "object") {
      const details = (parent as Record<string, unknown>)[
        "subscription_details"
      ];
      if (details && typeof details === "object") {
        subscriptionId = refId(
          (details as Record<string, unknown>)["subscription"],
        );
      }
    }
  }

  const company = await findCompany(customerId, subscriptionId);
  if (!company) {
    logger.warn(
      { customerId, subscriptionId },
      "invoice.payment_failed for unknown company; skipping warning email",
    );
    return;
  }

  const contact = await resolveBillingContact(company);
  const periodEnd = epochToDate(invoice["period_end"]);
  await sendPaymentFailedEmail({
    to: contact.email,
    adminName: contact.name,
    companyName: company.name,
    paidThrough: periodEnd,
    billingUrl: portalUrl(),
  });
}

async function handleSubscriptionUpdated(
  subscription: Record<string, unknown>,
  previousAttributes: Record<string, unknown>,
): Promise<void> {
  // Only notify on the TRANSITION into cancel_at_period_end, not on every
  // subsequent update while the flag stays set.
  const nowScheduled = subscription["cancel_at_period_end"] === true;
  const wasScheduled = !("cancel_at_period_end" in previousAttributes)
    ? nowScheduled
    : previousAttributes["cancel_at_period_end"] === true;
  if (!nowScheduled || wasScheduled) return;

  const customerId = refId(subscription["customer"]);
  const subscriptionId = asString(subscription["id"]);
  const company = await findCompany(customerId, subscriptionId);
  if (!company) {
    logger.warn(
      { customerId, subscriptionId },
      "cancel-at-period-end for unknown company; skipping warning email",
    );
    return;
  }

  const contact = await resolveBillingContact(company);
  const accessEndsAt =
    epochToDate(subscription["cancel_at"]) ??
    subscriptionPeriodEnd(subscription);
  await sendCancellationScheduledEmail({
    to: contact.email,
    adminName: contact.name,
    companyName: company.name,
    accessEndsAt,
    billingUrl: portalUrl(),
  });
}

/**
 * Inspect a verified Stripe webhook payload and send billing warning emails
 * where relevant. Never throws.
 */
export async function dispatchBillingNotifications(
  payload: Buffer,
): Promise<void> {
  try {
    const event = JSON.parse(payload.toString("utf8")) as StripeEventPayload;
    const object = event.data?.object;
    if (!event.type || !object) return;

    if (event.type === "invoice.payment_failed") {
      await handlePaymentFailed(object);
    } else if (event.type === "customer.subscription.updated") {
      await handleSubscriptionUpdated(
        object,
        event.data?.previous_attributes ?? {},
      );
    }
  } catch (err) {
    logger.warn(
      { err },
      "Billing notification dispatch failed; webhook processing unaffected",
    );
  }
}
