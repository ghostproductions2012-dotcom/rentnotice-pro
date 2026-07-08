---
name: stripe-replit-sync gotchas
description: Bundling and credential-shape pitfalls when using stripe-replit-sync in the api-server
---

# stripe-replit-sync gotchas

- **Must be externalized in esbuild** (`external: ["stripe-replit-sync"]` in the api-server build): it loads its SQL migration files from disk via `__dirname`, and `connectAndMigrate` **silently skips** when the migrations directory is missing — so migrations "succeed" but the `stripe` schema stays empty and later calls fail with `relation "stripe.accounts" does not exist`.
  **How to apply:** any server bundling this package must keep it external; if the stripe schema is empty despite "schema ready" logs, check bundling first.
- **Replit Stripe connector settings shape:** `/api/v2/connection` returns `settings.secret` and `settings.publishable` (NOT `secret_key`); no `webhook_secret` is provided — stripe-replit-sync's managed webhook handles that.
  **Why:** first integration attempt failed with "missing secret key" because code expected `secret_key`.
- Cancelling a Stripe subscription with `stripe.subscriptions.cancel()` ends it immediately (ended_at=now), so a paid-through-period license flips straight to cancelled — use `cancel_at_period_end` to test the pause-at-period-end path.
