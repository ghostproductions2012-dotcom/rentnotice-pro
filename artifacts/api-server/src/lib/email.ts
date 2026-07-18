import { logger } from "./logger";

/**
 * Resolves Resend credentials. Prefers the RESEND_API_KEY secret; falls back
 * to the Replit Resend connection API.
 * Not cached -- tokens can rotate, so fetch fresh each time.
 */
async function getResendCredentials(): Promise<{
  apiKey: string;
  fromEmail: string | undefined;
}> {
  const envKey = process.env.RESEND_API_KEY;
  if (envKey) {
    return { apiKey: envKey, fromEmail: undefined };
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new Error(
      "Missing Replit environment variables. " +
        "Ensure the Resend integration is connected via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=resend`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new Error(
      `Failed to fetch Resend credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as {
    items?: Array<{
      settings?: {
        api_key?: string;
        secret?: string;
        secret_key?: string;
        from_email?: string;
      };
    }>;
  };
  const settings = data.items?.[0]?.settings;
  const apiKey = settings?.api_key ?? settings?.secret ?? settings?.secret_key;

  if (!apiKey) {
    throw new Error(
      "Resend integration not connected or missing API key. " +
        "Connect Resend via the Integrations tab first.",
    );
  }

  return { apiKey, fromEmail: settings?.from_email };
}

interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Sends an email via Resend. Throws on failure.
 */
async function sendEmail(input: SendEmailInput): Promise<void> {
  const { apiKey, fromEmail } = await getResendCredentials();
  const from =
    process.env.EMAIL_FROM ??
    fromEmail ??
    "RentNotice Pro <noreply@rentnoticepro.com>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Resend API error ${resp.status}: ${body}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function emailShell(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#18181b;">
    <div style="max-width:560px;margin:0 auto;padding:32px 16px;">
      <div style="background:#ffffff;border:1px solid #e4e4e7;border-radius:8px;padding:32px;">
        <h1 style="margin:0 0 16px;font-size:20px;">${escapeHtml(title)}</h1>
        ${bodyHtml}
      </div>
      <p style="text-align:center;color:#71717a;font-size:12px;margin-top:16px;">
        RentNotice Pro &mdash; Professional notice management for property managers
      </p>
    </div>
  </body>
</html>`;
}

export interface TenantMessageEmailInput {
  to: string;
  subject: string;
  bodyText: string;
  companyName: string;
}

/**
 * Sends a tenant-facing message composed in the Communications hub.
 * The plain-text body is rendered into the standard email shell with
 * paragraphs preserved. Best-effort: returns true when sent, false on
 * failure. Never throws.
 */
export async function sendTenantMessageEmail(
  input: TenantMessageEmailInput,
): Promise<boolean> {
  const paragraphs = input.bodyText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;line-height:1.6;">${escapeHtml(p).replace(/\n/g, "<br />")}</p>`,
    )
    .join("\n");
  const bodyHtml = `${paragraphs}
    <p style="margin:24px 0 0;color:#71717a;font-size:13px;line-height:1.6;">
      Sent by ${escapeHtml(input.companyName)} via RentNotice Pro.
    </p>`;

  try {
    await sendEmail({
      to: input.to,
      subject: input.subject,
      html: emailShell(input.subject, bodyHtml),
      text: `${input.bodyText}\n\n— ${input.companyName}`,
    });
    logger.info({ to: input.to }, "Sent tenant message email");
    return true;
  } catch (err) {
    logger.warn({ err, to: input.to }, "Failed to send tenant message email");
    return false;
  }
}

export interface InviteEmailInput {
  to: string;
  companyName: string;
  role: string;
  invitedByName: string;
  inviteCode: string;
  /** Public URL of the website's download page; omitted if unresolvable. */
  downloadUrl?: string;
}

/**
 * Sends a team invite email carrying the single-use invite code.
 * Best-effort: returns true when the email was sent, false when sending
 * failed (the copyable invite code remains the fallback). Never throws.
 */
export async function sendInviteEmail(
  input: InviteEmailInput,
): Promise<boolean> {
  const subject = `You've been invited to join ${input.companyName} on RentNotice Pro`;
  const downloadHtml = input.downloadUrl
    ? `
    <p style="text-align:center;margin:0 0 24px;">
      <a href="${escapeHtml(input.downloadUrl)}"
         style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">
        Download RentNotice Pro
      </a>
    </p>
    <p style="margin:0 0 24px;color:#71717a;font-size:13px;line-height:1.6;text-align:center;">
      Don't have the desktop software yet? Download it free, then use your invite
      code to sign in.
    </p>`
    : "";
  const bodyHtml = `
    <p style="margin:0 0 12px;line-height:1.6;">
      ${escapeHtml(input.invitedByName)} has invited you to join
      <strong>${escapeHtml(input.companyName)}</strong> on RentNotice Pro
      as <strong>${escapeHtml(input.role)}</strong>.
    </p>
    <p style="margin:0 0 8px;line-height:1.6;">Your invite code:</p>
    <p style="margin:0 0 24px;">
      <code style="display:block;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:6px;padding:12px 16px;font-size:15px;letter-spacing:1px;text-align:center;">
        ${escapeHtml(input.inviteCode)}
      </code>
    </p>
    <p style="margin:0 0 24px;color:#71717a;font-size:13px;line-height:1.6;">
      Open the RentNotice Pro desktop software, choose
      <strong>"I have an invite code"</strong>, and enter this code to set up
      your account. The code can only be used once and expires in 14 days.
    </p>${downloadHtml}`;
  const downloadText = input.downloadUrl
    ? `\n\nDon't have the desktop software yet? Download RentNotice Pro:\n${input.downloadUrl}`
    : "";
  const text =
    `${input.invitedByName} has invited you to join ${input.companyName} ` +
    `on RentNotice Pro as ${input.role}.\n\n` +
    `Your invite code:\n${input.inviteCode}\n\n` +
    `Open the RentNotice Pro desktop software, choose "I have an invite code", ` +
    `and enter this code to set up your account. The code can only be used ` +
    `once and expires in 14 days.${downloadText}`;

  try {
    await sendEmail({
      to: input.to,
      subject,
      html: emailShell("You're invited to RentNotice Pro", bodyHtml),
      text,
    });
    logger.info({ to: input.to }, "Sent team invite email");
    return true;
  } catch (err) {
    logger.warn(
      { err, to: input.to },
      "Failed to send invite email; copyable invite link remains available",
    );
    return false;
  }
}

export interface PaymentFailedEmailInput {
  to: string;
  adminName: string;
  companyName: string;
  paidThrough: Date | null;
  billingUrl: string;
}

/**
 * Warns the billing contact that a subscription payment failed so they can
 * update their card before the license pauses.
 * Best-effort: returns true when sent, false on failure. Never throws.
 */
export async function sendPaymentFailedEmail(
  input: PaymentFailedEmailInput,
): Promise<boolean> {
  const subject = "Action needed: payment failed for RentNotice Pro";
  const paidThroughLine = input.paidThrough
    ? `Your team keeps full access through <strong>${escapeHtml(formatDateLong(input.paidThrough))}</strong>. If payment isn't resolved by then, the desktop software will pause until billing is fixed.`
    : `If payment isn't resolved soon, the desktop software will pause until billing is fixed.`;
  const paidThroughText = input.paidThrough
    ? `Your team keeps full access through ${formatDateLong(input.paidThrough)}. ` +
      `If payment isn't resolved by then, the desktop software will pause until billing is fixed.`
    : `If payment isn't resolved soon, the desktop software will pause until billing is fixed.`;

  const bodyHtml = `
    <p style="margin:0 0 12px;line-height:1.6;">
      Hi ${escapeHtml(input.adminName)},
    </p>
    <p style="margin:0 0 12px;line-height:1.6;">
      We couldn't process the latest subscription payment for
      <strong>${escapeHtml(input.companyName)}</strong> on RentNotice Pro.
      This usually means the card on file expired or was declined.
    </p>
    <p style="margin:0 0 24px;line-height:1.6;">
      ${paidThroughLine}
    </p>
    <p style="text-align:center;margin:0 0 8px;">
      <a href="${escapeHtml(input.billingUrl)}"
         style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">
        Update Payment Method
      </a>
    </p>
    <p style="margin:0;color:#71717a;font-size:13px;line-height:1.6;text-align:center;">
      Open your customer portal and choose &ldquo;Manage billing&rdquo; to
      update your card. Stripe retries failed payments automatically once
      billing is fixed.
    </p>`;
  const text =
    `Hi ${input.adminName},\n\n` +
    `We couldn't process the latest subscription payment for ` +
    `${input.companyName} on RentNotice Pro. This usually means the card ` +
    `on file expired or was declined.\n\n` +
    `${paidThroughText}\n\n` +
    `Update your payment method from your customer portal:\n${input.billingUrl}\n\n` +
    `Stripe retries failed payments automatically once billing is fixed.`;

  try {
    await sendEmail({
      to: input.to,
      subject,
      html: emailShell("Payment failed — action needed", bodyHtml),
      text,
    });
    logger.info({ to: input.to }, "Sent payment-failed warning email");
    return true;
  } catch (err) {
    logger.warn(
      { err, to: input.to },
      "Failed to send payment-failed warning email",
    );
    return false;
  }
}

export interface CancellationScheduledEmailInput {
  to: string;
  adminName: string;
  companyName: string;
  accessEndsAt: Date | null;
  billingUrl: string;
}

/**
 * Notifies the billing contact that their subscription is set to cancel at
 * the end of the current period, with a link to resume it.
 * Best-effort: returns true when sent, false on failure. Never throws.
 */
export async function sendCancellationScheduledEmail(
  input: CancellationScheduledEmailInput,
): Promise<boolean> {
  const subject = "Your RentNotice Pro subscription is set to cancel";
  const endsLineHtml = input.accessEndsAt
    ? `Your team keeps full access through <strong>${escapeHtml(formatDateLong(input.accessEndsAt))}</strong>. After that, the desktop software will pause until you resubscribe.`
    : `Your team keeps full access through the end of the current billing period. After that, the desktop software will pause until you resubscribe.`;
  const endsLineText = input.accessEndsAt
    ? `Your team keeps full access through ${formatDateLong(input.accessEndsAt)}. ` +
      `After that, the desktop software will pause until you resubscribe.`
    : `Your team keeps full access through the end of the current billing period. ` +
      `After that, the desktop software will pause until you resubscribe.`;

  const bodyHtml = `
    <p style="margin:0 0 12px;line-height:1.6;">
      Hi ${escapeHtml(input.adminName)},
    </p>
    <p style="margin:0 0 12px;line-height:1.6;">
      The RentNotice Pro subscription for
      <strong>${escapeHtml(input.companyName)}</strong> is scheduled to
      cancel at the end of the current billing period.
    </p>
    <p style="margin:0 0 24px;line-height:1.6;">
      ${endsLineHtml}
    </p>
    <p style="margin:0 0 24px;line-height:1.6;">
      Changed your mind? You can resume the subscription any time before it
      ends &mdash; no data is lost.
    </p>
    <p style="text-align:center;margin:0 0 8px;">
      <a href="${escapeHtml(input.billingUrl)}"
         style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">
        Manage Your Subscription
      </a>
    </p>
    <p style="margin:0;color:#71717a;font-size:13px;line-height:1.6;text-align:center;">
      Open your customer portal and choose &ldquo;Manage billing&rdquo; to
      resume your subscription.
    </p>`;
  const text =
    `Hi ${input.adminName},\n\n` +
    `The RentNotice Pro subscription for ${input.companyName} is scheduled ` +
    `to cancel at the end of the current billing period.\n\n` +
    `${endsLineText}\n\n` +
    `Changed your mind? You can resume the subscription any time before it ` +
    `ends -- no data is lost.\n\n` +
    `Manage your subscription from your customer portal:\n${input.billingUrl}`;

  try {
    await sendEmail({
      to: input.to,
      subject,
      html: emailShell("Subscription set to cancel", bodyHtml),
      text,
    });
    logger.info({ to: input.to }, "Sent cancellation-scheduled email");
    return true;
  } catch (err) {
    logger.warn(
      { err, to: input.to },
      "Failed to send cancellation-scheduled email",
    );
    return false;
  }
}

export interface WelcomeEmailInput {
  to: string;
  adminName: string;
  companyName: string;
  planName: string;
  licenseKey: string;
  portalUrl: string;
}

/**
 * Sends the post-purchase welcome email containing the license key.
 * Best-effort: returns true when sent, false on failure. Never throws.
 */
export async function sendWelcomeEmail(
  input: WelcomeEmailInput,
): Promise<boolean> {
  const subject = "Welcome to RentNotice Pro — your license key inside";
  const bodyHtml = `
    <p style="margin:0 0 12px;line-height:1.6;">
      Hi ${escapeHtml(input.adminName)},
    </p>
    <p style="margin:0 0 12px;line-height:1.6;">
      Thanks for purchasing RentNotice Pro for
      <strong>${escapeHtml(input.companyName)}</strong>
      (${escapeHtml(input.planName)} plan). Your account is ready.
    </p>
    <p style="margin:0 0 8px;line-height:1.6;">Your license key:</p>
    <p style="margin:0 0 24px;">
      <code style="display:block;background:#f4f4f5;border:1px solid #e4e4e7;border-radius:6px;padding:12px 16px;font-size:15px;letter-spacing:1px;text-align:center;">
        ${escapeHtml(input.licenseKey)}
      </code>
    </p>
    <p style="margin:0 0 24px;line-height:1.6;">
      Enter this key in the RentNotice Pro desktop software to unlock it.
      Keep this email for your records.
    </p>
    <p style="text-align:center;margin:0 0 8px;">
      <a href="${escapeHtml(input.portalUrl)}"
         style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">
        Open Your Customer Portal
      </a>
    </p>
    <p style="margin:0;color:#71717a;font-size:13px;line-height:1.6;text-align:center;">
      Manage your team, billing, and license any time from the portal.
    </p>`;
  const text =
    `Hi ${input.adminName},\n\n` +
    `Thanks for purchasing RentNotice Pro for ${input.companyName} ` +
    `(${input.planName} plan). Your account is ready.\n\n` +
    `Your license key:\n${input.licenseKey}\n\n` +
    `Enter this key in the RentNotice Pro desktop software to unlock it. ` +
    `Keep this email for your records.\n\n` +
    `Manage your team, billing, and license any time:\n${input.portalUrl}`;

  try {
    await sendEmail({
      to: input.to,
      subject,
      html: emailShell("Welcome to RentNotice Pro", bodyHtml),
      text,
    });
    logger.info({ to: input.to }, "Sent welcome email with license key");
    return true;
  } catch (err) {
    logger.warn(
      { err, to: input.to },
      "Failed to send welcome email; license key shown on success page",
    );
    return false;
  }
}
