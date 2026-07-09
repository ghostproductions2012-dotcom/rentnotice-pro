---
name: Express behind Replit proxy
description: trust proxy is required for any per-IP logic (rate limits) in api-server
---

Rule: any Express per-IP logic (login rate limiting, abuse throttles) requires `app.set("trust proxy", 1)` because all traffic arrives via the Replit proxy.

**Why:** Without it `req.ip` is the proxy address, so every visitor shares one rate-limit bucket — an anonymous attacker could lock the real admin out of login, and per-IP limits don't function at all. Caught in architect review of the admin panel.

**How to apply:** Already set in api-server's app.ts. If a new Express service is added to this monorepo, set it there too before adding any per-IP feature.
