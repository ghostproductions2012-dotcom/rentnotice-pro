---
name: RentNotice Pro e2e testing quirks
description: How to write Playwright testing-subagent plans for the offline-first RentNotice Pro SPA (in-memory session, IndexedDB state)
---

# E2E testing quirks for RentNotice Pro

- **Login session is in-memory only.** Any full page load (`page.goto`) after signing in returns the app to the lock screen. Test plans must say: navigate via sidebar clicks (SPA navigation) only, and if a login form appears, re-authenticate (demo admin: arivera/1234).
  - **Why:** two e2e runs failed/derailed on this before the instruction was added; with it, the same flow passed first try.
- **Fresh browser context = fresh app.** All state is sql.js/IndexedDB per context, so `[New Context]` gives an un-provisioned first-run state — no DB cleanup steps needed.
- Mock licensing behavior is steered via localStorage keys (`rentnotice-pro:mock-status`, `rentnotice-pro:mock-network`) executed as in-page JS with **no reload** — they take effect on the next sync call.
- Several list pages have "Add ..." buttons that are non-functional stubs (no onClick). Don't write test steps that assume create dialogs exist; check the page source first.
