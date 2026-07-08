import { randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import type { Company, LicenseKey } from "@workspace/db";
import { getPlanConfig } from "./plans";

/** Days the desktop app may keep working offline before re-verification. */
export const LICENSE_GRACE_DAYS = 14;

const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

export function generateLicenseKey(): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    const bytes = randomBytes(4);
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length];
    }
    groups.push(group);
  }
  return `RNP-${groups.join("-")}`;
}

/** Days a team invite code stays redeemable after it is (re)generated. */
export const INVITE_CODE_TTL_DAYS = 14;

/** Expiry timestamp for an invite code generated right now. */
export function inviteCodeExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_CODE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Effective expiry for a pending invite. Codes created before expiry tracking
 * existed have a NULL stored expiry; they fall back to creation time + TTL so
 * no invite code is ever redeemable indefinitely.
 */
export function effectiveInviteExpiry(user: {
  inviteCodeExpiresAt: Date | null;
  createdAt: Date;
}): Date {
  return user.inviteCodeExpiresAt ?? inviteCodeExpiry(user.createdAt);
}

/**
 * Short, human-typeable single-use invite code for a team member. The INV-
 * prefix keeps it visually distinct from company license keys (RNP-...).
 */
export function generateInviteCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 2; g++) {
    const bytes = randomBytes(4);
    let group = "";
    for (let i = 0; i < 4; i++) {
      group += KEY_ALPHABET[bytes[i]! % KEY_ALPHABET.length];
    }
    groups.push(group);
  }
  return `INV-${groups.join("-")}`;
}

export type LicenseStatus = "active" | "paused" | "cancelled";

export interface ComputedLicenseStatus {
  status: LicenseStatus;
  statusReason: string;
  paidThrough: Date | null;
  subscriptionStatus: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  priceMonthlyCents: number | null;
}

interface SyncedSubscriptionRow {
  status: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | number | Date | null;
  ended_at: string | number | Date | null;
}

function toDate(value: string | number | Date | null): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value * 1000);
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && asNumber > 1_000_000_000) {
    return new Date(asNumber * 1000);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function fetchSyncedSubscription(
  subscriptionId: string,
): Promise<SyncedSubscriptionRow | null> {
  try {
    // Newer Stripe API versions report current_period_end on the
    // subscription ITEMS, not the subscription itself -- fall back to the
    // latest item period end when the subscription-level column is null.
    const result = await db.execute(
      sql`SELECT s.status,
                 s.cancel_at_period_end,
                 COALESCE(
                   s.current_period_end,
                   (SELECT MAX(si.current_period_end)
                    FROM stripe.subscription_items si
                    WHERE si.subscription = s.id)
                 ) AS current_period_end,
                 s.ended_at
          FROM stripe.subscriptions s
          WHERE s.id = ${subscriptionId}`,
    );
    return (result.rows[0] as unknown as SyncedSubscriptionRow) ?? null;
  } catch {
    // stripe schema not migrated yet (Stripe not connected)
    return null;
  }
}

async function fetchSubscriptionPriceCents(
  subscriptionId: string,
): Promise<number | null> {
  try {
    const result = await db.execute(
      sql`SELECT p.unit_amount
          FROM stripe.subscription_items si
          JOIN stripe.prices p ON p.id = si.price
          WHERE si.subscription = ${subscriptionId}
          LIMIT 1`,
    );
    const row = result.rows[0] as { unit_amount?: number | string } | undefined;
    if (!row || row.unit_amount === null || row.unit_amount === undefined) {
      return null;
    }
    return Number(row.unit_amount);
  } catch {
    return null;
  }
}

/**
 * Derive the effective license status from the synced Stripe subscription.
 *
 * Lifecycle rules:
 * - Cancellation or non-payment pauses the key at the END of the last paid
 *   period (customers keep access through what they paid for).
 * - Payment resolution / reactivation resumes the key IMMEDIATELY, because
 *   status is computed live from the subscription on every read.
 * - A subscription that has fully ended (ended_at set, past paid period)
 *   yields "cancelled".
 */
export async function computeLicenseStatus(
  company: Company,
): Promise<ComputedLicenseStatus> {
  const plan = getPlanConfig(company.tier);
  const fallbackPrice = plan ? plan.priceMonthlyCents : null;

  if (!company.stripeSubscriptionId) {
    return {
      status: "active",
      statusReason: "Subscription is being set up",
      paidThrough: null,
      subscriptionStatus: "unknown",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      priceMonthlyCents: fallbackPrice,
    };
  }

  const sub = await fetchSyncedSubscription(company.stripeSubscriptionId);
  if (!sub) {
    return {
      status: "active",
      statusReason: "Subscription data is syncing",
      paidThrough: null,
      subscriptionStatus: "unknown",
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      priceMonthlyCents: fallbackPrice,
    };
  }

  const priceCents =
    (await fetchSubscriptionPriceCents(company.stripeSubscriptionId)) ??
    fallbackPrice;

  const now = new Date();
  const periodEnd = toDate(sub.current_period_end);
  const endedAt = toDate(sub.ended_at);
  const subStatus = sub.status ?? "unknown";
  const cancelAtPeriodEnd = Boolean(sub.cancel_at_period_end);
  const base = {
    subscriptionStatus: subStatus,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd,
    priceMonthlyCents: priceCents,
  };

  if (subStatus === "active" || subStatus === "trialing") {
    return {
      ...base,
      status: "active",
      statusReason: cancelAtPeriodEnd
        ? "Subscription cancels at the end of the current period"
        : "Subscription in good standing",
      paidThrough: periodEnd,
    };
  }

  const withinPaidPeriod =
    periodEnd !== null && periodEnd.getTime() > now.getTime();

  if (subStatus === "past_due" || subStatus === "unpaid") {
    if (withinPaidPeriod) {
      return {
        ...base,
        status: "active",
        statusReason:
          "Payment issue detected - access continues through the paid period",
        paidThrough: periodEnd,
      };
    }
    return {
      ...base,
      status: "paused",
      statusReason:
        "Paused: payment failed and the paid period has ended. Update billing to resume immediately.",
      paidThrough: periodEnd,
    };
  }

  if (subStatus === "canceled" || subStatus === "incomplete_expired") {
    const paidThrough = periodEnd ?? endedAt;
    const stillPaid =
      paidThrough !== null && paidThrough.getTime() > now.getTime();
    if (stillPaid) {
      return {
        ...base,
        status: "active",
        statusReason:
          "Subscription cancelled - access continues through the paid period",
        paidThrough,
      };
    }
    return {
      ...base,
      status: "cancelled",
      statusReason:
        "Subscription cancelled and the paid period has ended. Resubscribe to reactivate this license.",
      paidThrough,
    };
  }

  // incomplete, paused, or anything unexpected
  if (withinPaidPeriod) {
    return {
      ...base,
      status: "active",
      statusReason: "Access continues through the paid period",
      paidThrough: periodEnd,
    };
  }
  return {
    ...base,
    status: "paused",
    statusReason: `Paused: subscription is ${subStatus}. Resolve billing to resume immediately.`,
    paidThrough: periodEnd,
  };
}

/** Persist the derived status on the license row (audit/fallback value). */
export async function syncStoredLicenseStatus(
  license: LicenseKey,
  computed: ComputedLicenseStatus,
): Promise<void> {
  if (license.status === computed.status) return;
  const { licenseKeysTable } = await import("@workspace/db");
  const { eq } = await import("drizzle-orm");
  await db
    .update(licenseKeysTable)
    .set({ status: computed.status, updatedAt: new Date() })
    .where(eq(licenseKeysTable.id, license.id));
}
