---
name: Email sending via Resend
description: How outbound email is configured in this project and why deliverability is limited until a domain is verified
---

# Email sending (Resend)

- The user **dismissed the Replit Resend connector** and instead provided a `RESEND_API_KEY` secret. The email module prefers the env var and only falls back to the connector lookup.
- **Why:** user preference — don't re-propose the Resend connector; the secret is the chosen setup.
- The Resend account is in **test mode**: emails only deliver to the account owner's own address until a domain is verified at resend.com/domains. Sends to any other recipient fail with a 403 `validation_error`.
- **How to apply:** when testing email flows, send to the Resend account owner's address; treat 403s to other recipients as expected, not a bug. Once a domain is verified, set `EMAIL_FROM` to an address on that domain (code already reads it).
- All email sends are best-effort by design: failures log a warning and return `false`; UI fallbacks (copyable invite link, license key on the success page) must remain.
