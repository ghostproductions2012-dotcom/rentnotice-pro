import { eq } from "drizzle-orm";
import {
  db,
  companyIntegrationsTable,
  INTEGRATION_EVENTS,
  type CompanyIntegrationsRow,
  type IntegrationEvent,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Outbound webhook dispatcher for per-company Slack / Google Chat
 * integrations.
 *
 * Security posture:
 *  - Webhook URLs are restricted to the official Slack / Google Chat
 *    incoming-webhook hosts (SSRF guard, enforced on write AND on send).
 *  - Deliveries are fire-and-forget with a short timeout; failures never
 *    block or fail the triggering request.
 *  - Webhook URLs are never logged — they embed bearer-equivalent secrets.
 */

export const SLACK_WEBHOOK_PREFIX = "https://hooks.slack.com/";
export const GOOGLE_CHAT_WEBHOOK_PREFIX = "https://chat.googleapis.com/";

const WEBHOOK_TIMEOUT_MS = 5_000;
const MAX_TEXT_LENGTH = 1_000;

export function isAllowedSlackUrl(url: string): boolean {
  return url.startsWith(SLACK_WEBHOOK_PREFIX);
}

export function isAllowedGoogleChatUrl(url: string): boolean {
  return url.startsWith(GOOGLE_CHAT_WEBHOOK_PREFIX);
}

/** Masks a stored webhook URL for display: host + trailing 4 characters. */
export function maskWebhookUrl(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/…${url.slice(-4)}`;
  } catch {
    return "…" + url.slice(-4);
  }
}

export function isIntegrationEvent(v: unknown): v is IntegrationEvent {
  return (
    typeof v === "string" &&
    (INTEGRATION_EVENTS as readonly string[]).includes(v)
  );
}

export async function getCompanyIntegrations(
  companyId: string,
): Promise<CompanyIntegrationsRow | null> {
  const [row] = await db
    .select()
    .from(companyIntegrationsTable)
    .where(eq(companyIntegrationsTable.companyId, companyId));
  return row ?? null;
}

function truncateText(text: string): string {
  return text.length > MAX_TEXT_LENGTH
    ? `${text.slice(0, MAX_TEXT_LENGTH - 1)}…`
    : text;
}

/**
 * Posts a `{ text }` payload (accepted by both Slack and Google Chat
 * incoming webhooks). Returns delivery outcome; never throws.
 */
async function postWebhook(
  url: string,
  target: "slack" | "google_chat",
  text: string,
): Promise<{ ok: boolean; message: string }> {
  const allowed =
    target === "slack" ? isAllowedSlackUrl(url) : isAllowedGoogleChatUrl(url);
  if (!allowed) {
    return { ok: false, message: "Webhook URL is not allowed" };
  }
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: truncateText(text) }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return { ok: false, message: `Webhook responded ${resp.status}` };
    }
    return { ok: true, message: "Delivered" };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? "Timed out"
        : "Network error";
    return { ok: false, message: reason };
  }
}

async function deliverToCompany(
  row: CompanyIntegrationsRow,
  text: string,
): Promise<void> {
  const deliveries: Array<Promise<{ ok: boolean; message: string }>> = [];
  if (row.slackWebhookUrl) {
    deliveries.push(postWebhook(row.slackWebhookUrl, "slack", text));
  }
  if (row.googleChatWebhookUrl) {
    deliveries.push(
      postWebhook(row.googleChatWebhookUrl, "google_chat", text),
    );
  }
  const results = await Promise.all(deliveries);
  for (const result of results) {
    if (!result.ok) {
      logger.warn(
        { companyId: row.companyId, reason: result.message },
        "Webhook delivery failed",
      );
    }
  }
}

/**
 * Fire-and-forget delivery of a company event to its configured webhooks.
 * No-ops when the company has no integration row or the event is toggled off.
 */
export function dispatchCompanyEvent(
  companyId: string,
  event: IntegrationEvent,
  text: string,
): void {
  void (async () => {
    const row = await getCompanyIntegrations(companyId);
    if (!row) return;
    if (!row.events.includes(event)) return;
    await deliverToCompany(row, text);
  })().catch((err) => {
    logger.warn({ err, companyId }, "Webhook dispatch failed");
  });
}

/**
 * Fire-and-forget mirroring of a team-chat channel message. DMs are never
 * mirrored — callers must only pass channel messages.
 */
export function mirrorTeamChatMessage(
  companyId: string,
  channelName: string,
  senderName: string,
  body: string,
): void {
  void (async () => {
    const row = await getCompanyIntegrations(companyId);
    if (!row || !row.mirrorTeamChat) return;
    await deliverToCompany(row, `#${channelName} — ${senderName}: ${body}`);
  })().catch((err) => {
    logger.warn({ err, companyId }, "Chat mirror dispatch failed");
  });
}

/** Awaited test delivery used by the integrations settings screen. */
export async function sendTestMessage(
  companyId: string,
  target: "slack" | "google_chat",
): Promise<{ ok: boolean; message: string }> {
  const row = await getCompanyIntegrations(companyId);
  const url =
    target === "slack" ? row?.slackWebhookUrl : row?.googleChatWebhookUrl;
  if (!url) {
    return { ok: false, message: "This integration is not connected yet" };
  }
  return postWebhook(
    url,
    target,
    "RentNotice Pro test message — your integration is working.",
  );
}
