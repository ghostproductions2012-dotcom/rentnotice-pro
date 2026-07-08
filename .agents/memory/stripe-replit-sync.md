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
- **`syncBackfill()` with no params syncs NOTHING** — you must pass explicit object types or call `syncProducts()` / `syncPrices()` / `syncSubscriptions()` individually. A seed script that calls bare `syncBackfill()` looks successful but leaves the `stripe` schema empty.
- **Newer Stripe API versions put `current_period_end` on subscription *items*, not the subscription** — `stripe.subscriptions.current_period_end` can be NULL in the synced tables. Any paid-through calculation must COALESCE with the max `current_period_end` from `stripe.subscription_items`.
- **Synced `stripe.subscriptions` columns are generated from `_raw_data` jsonb** — to simulate states in tests (e.g. an ended period), UPDATE the `_raw_data` jsonb, not the columns directly.
- **Dev-only webhook tug-of-war:** parallel Replit task environments share one Stripe test account; each api-server startup registers a managed webhook for its own `REPLIT_DOMAINS` and deletes the others as "orphaned". Events land in whichever environment holds the endpoint, so webhook-driven sync in dev is unreliable while parallel tasks run. **How to apply:** don't debug this as a product bug — re-register the webhook (or restart the server) immediately before a delivery test, or trigger an explicit `syncSubscriptions()`. Production (single stable domain) is unaffected.
