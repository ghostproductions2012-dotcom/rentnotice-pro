---
name: RentNotice Pro e2e testing quirks
description: How to write Playwright testing-subagent plans for the offline-first RentNotice Pro SPA (in-memory session, IndexedDB state)
---

# E2E testing quirks for RentNotice Pro

- **Login session is in-memory only.** Any full page load (`page.goto`) after signing in returns the app to the lock screen. Test plans must say: navigate via sidebar clicks (SPA navigation) only, and if a login form appears, re-authenticate with the seeded demo admin (see the demo seed data in src/lib/db for identifiers).
  - **Why:** e2e runs derail on the surprise lock screen unless the plan warns about it up front.
- **Fresh browser context = fresh app.** All state is sql.js/IndexedDB per context, so `[New Context]` gives an un-provisioned first-run state — no DB cleanup steps needed.
- Licensing defaults to the **real HTTP adapter** (api-server at /api). The deterministic mock is opt-in, dev builds only: set localStorage `rentnotice-pro:licensing` = `"mock"` first. Mock behavior is then steered via localStorage keys (`rentnotice-pro:mock-status`, `rentnotice-pro:mock-network`) executed as in-page JS with **no reload** — they take effect on the next sync call.
- Quick admin seeding for curl e2e: generate a password hash with `node -e` (scrypt, `salt:hash` hex format matching api-server's lib/auth.ts) and insert companies/license_keys/cloud_users rows via psql — no tsx runner exists in api-server, so plain node + psql is the path. Delete the seeded rows (web_sessions first, FK) when done.
- For real-HTTP licensing e2e: seed a company + cloud_users + license_keys row in the dev Postgres DB. License status is computed live from the linked stripe.subscriptions row (`companies.stripe_subscription_id`); stripe.* is read-only via the SQL tool but writable with a direct pg client (columns are generated from `_raw_data` jsonb; `_account_id` NOT NULL).
- Desktop app CRUD is dialog-based (no create/edit routes): Add/Edit property & tenant, manual statement entry, and ledger view are all dialogs with data-testid'd fields. "View Ledger" opens a dialog, not a route.
- The testing subagent CAN upload local files: give it the absolute path and the hidden file input's data-testid; it sets it via setInputFiles despite the "no filesystem access" caveat in the skill doc.
- **Platform-admin pages (www /admin) e2e:** real credentials are secrets and unreadable to test plans; instead have the plan seed a session row in the admin sessions table via a `[DB]` step and set the matching session cookie in the browser context. Clean up the row afterwards.
- The www marketing site is a separate wouter SPA with normal cookie sessions (a seeded dev portal account exists — see scripts/post-merge.sh) — unlike the desktop app, page reloads do NOT log you out there.
