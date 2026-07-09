---
name: License revocation semantics
description: How revoked license keys must behave across api-server endpoints
---

Rule: a license key status of "revoked" is an admin-issued kill switch that must never be overwritten or leaked back to customers.

**Why:** The stored key status is normally synced from the Stripe subscription, which would silently resurrect a revoked key. And the desktop app only understands active|paused|cancelled, so revoked keys must present as "cancelled" on verify (200) and reject activate (403).

**How to apply:** Every query that picks "the company's license key" (portal overview, invite redemption, checkout idempotent replay, future endpoints) must filter `ne(status, "revoked")` and order by createdAt. The status-sync helper must early-return on revoked. If adding a new key-selection call site, copy the portal.ts pattern.
