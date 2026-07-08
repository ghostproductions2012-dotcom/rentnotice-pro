---
name: Task-env dev DB is isolated
description: Data seeded in a task environment's dev Postgres does not reach the main app's dev DB; route seeds through the post-merge script.
---

# Task-environment dev database is isolated

Each isolated task environment gets its own dev Postgres (fresh copy). Rows inserted there do NOT appear in the main app's dev database after merge — only code merges, not data.

**Why:** Verified during admin-account seeding: the task env's dev DB contained only rows created in that session, none of the project's prior data.

**How to apply:** Any data seed that must exist in the main environment (test accounts, reference data) must run from `scripts/post-merge.sh` (idempotent, non-interactive). Bundle TS seed scripts with the api-server's esbuild (external: pg-native, stripe-replit-sync; include a createRequire banner for CJS deps like pg — without it the bundle crashes on dynamic require). Also: production SQL access is read-only, and no production DB exists until the project is first published.
