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
    "RentNotice Pro <onboarding@resend.dev>";

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

export interface InviteEmailInput {
  to: string;
  companyName: string;
  role: string;
  invitedByName: string;
  inviteUrl: string;
}

/**
 * Sends a team invite email. Best-effort: returns true when the email was
 * sent, false when sending failed (the copyable invite link remains the
 * fallback). Never throws.
 */
export async function sendInviteEmail(
  input: InviteEmailInput,
): Promise<boolean> {
  const subject = `You've been invited to join ${input.companyName} on RentNotice Pro`;
  const bodyHtml = `
    <p style="margin:0 0 12px;line-height:1.6;">
      ${escapeHtml(input.invitedByName)} has invited you to join
      <strong>${escapeHtml(input.companyName)}</strong> on RentNotice Pro
      as <strong>${escapeHtml(input.role)}</strong>.
    </p>
    <p style="margin:0 0 24px;line-height:1.6;">
      Click the button below to accept the invitation and set your password.
      You'll use this account to log into the RentNotice Pro desktop app.
    </p>
    <p style="text-align:center;margin:0 0 24px;">
      <a href="${escapeHtml(input.inviteUrl)}"
         style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:bold;">
        Accept Invitation
      </a>
    </p>
    <p style="margin:0;color:#71717a;font-size:13px;line-height:1.6;">
      Or copy this link into your browser:<br />
      <a href="${escapeHtml(input.inviteUrl)}" style="color:#2563eb;word-break:break-all;">${escapeHtml(input.inviteUrl)}</a>
    </p>`;
  const text =
    `${input.invitedByName} has invited you to join ${input.companyName} ` +
    `on RentNotice Pro as ${input.role}.\n\n` +
    `Accept the invitation and set your password here:\n${input.inviteUrl}\n\n` +
    `You'll use this account to log into the RentNotice Pro desktop app.`;

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
      Enter this key in the RentNotice Pro desktop app to unlock it.
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
    `Enter this key in the RentNotice Pro desktop app to unlock it. ` +
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
