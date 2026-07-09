---
name: Playwright headless browser on Replit NixOS
description: How to get a working headless Chromium for Playwright scripts/validation checks in this workspace
---

# Playwright on Replit NixOS

Playwright's own downloaded Chromium (`npx playwright install chromium`) launches then immediately dies on NixOS ("Target page, context or browser has been closed") because of missing shared system libraries.

**Fix:** install the `chromium` nix system dependency and launch with `chromium.launch({ executablePath })`, resolving the path at runtime via `which chromium` (nix store paths change between rebuilds, so never hardcode them).

**Why:** validation checks (e.g. the `mobile-layout-www` check in `scripts/`) must work headlessly inside the workspace without the testing-subagent infrastructure.

**How to apply:** any future in-repo browser automation (screenshot diffing, layout checks, smoke tests) should reuse this pattern rather than fighting the bundled browser. The proxy on `http://127.0.0.1:80` routes by artifact path (`/` www, `/api` api-server), and a browser context's `context.request` shares its cookie jar — so API-based login (`POST /api/www/auth/login`) authenticates subsequent page loads with no UI login flow.
