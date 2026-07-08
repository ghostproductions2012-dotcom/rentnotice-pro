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
- Several list pages have "Add ..." buttons that are non-functional stubs (no onClick). Don't write test steps that assume create dialogs exist; check the page source first.
