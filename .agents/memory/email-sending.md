---
name: Email sending via Resend
description: How outbound email is configured in this project and why deliverability is limited until a domain is verified
---

# Email sending (Resend)

- The user **dismissed the Replit Resend connector** and instead provided a `RESEND_API_KEY` secret. The email module prefers the env var and only falls back to the connector lookup.
- **Why:** user preference — don't re-propose the Resend connector; the secret is the chosen setup.
- The domain **rentnoticepro.com is verified** on Resend (July 2026) and `EMAIL_FROM` is set (shared env) to `RentNotice Pro <noreply@rentnoticepro.com>` — emails deliver to any recipient now.
- The `RESEND_API_KEY` is **send-only** (restricted): it cannot list domains or use other Resend API endpoints; a 401 `restricted_api_key` on non-send endpoints is expected.
- **How to apply:** verify sends with a real send call, not the domains endpoint. If a send returns 403 "domain is not verified", the from-address domain doesn't match a verified domain in the key's team.
- All email sends are best-effort by design: failures log a warning and return `false`; UI fallbacks (copyable invite link, license key on the success page) must remain.
