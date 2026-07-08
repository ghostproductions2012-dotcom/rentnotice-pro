---
name: Production DB write path
description: How the production database relates to dev and the only ways to change prod data
---

# Production DB is a one-time copy of dev; only the deployed app can write to it

- Prod Postgres (`neondb`) was created as a **copy of the dev DB at first successful publish** (identical row UUIDs/created_at, different current_database from dev's `heliumdb`). It does NOT stay in sync afterwards: post-merge seeds and dev writes never reach prod.
- **Why:** verified July 2026 while provisioning the admin license key — dev seed rows (same UUIDs) existed in prod from the publish-time copy, but rows created after publish never appeared there.
- **How to apply:** to change prod data you must go through the deployed app itself (an idempotent self-heal/lazy-provision code path that activates after the next publish, or a real user-facing flow). Agent-side prod SQL (`executeSql environment:"production"`) is strictly read-only; there is no prod DATABASE_URL available in the workspace. Any task that "must fix prod data" therefore ships code + requires a republish, and verification happens post-publish.
- The portal overview endpoint self-heals a company that has no license_keys row (lazy-provisions an active key) — rely on that rather than seeding keys into prod.
