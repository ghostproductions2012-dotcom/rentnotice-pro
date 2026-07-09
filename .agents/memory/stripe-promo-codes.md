---
name: Stripe promo code gotchas
description: Creating/testing Stripe promotion codes — new API param shape, and why automated browsers can't redeem codes in live Checkout
---

# Stripe promotion code gotchas

## New API param shape (2026-06-24 "dahlia")
`stripe.promotionCodes.create({ coupon })` fails with "unknown parameter: coupon".
The new shape is `{ promotion: { type: "coupon", coupon: couponId }, code }`.
Pinning an older `apiVersion` on the client restores the classic `coupon` param.

## Automated browsers cannot redeem promo codes in live Checkout
**Rule:** Do not try to verify manual promo-code entry on a live-mode Stripe Checkout page with the Playwright testing subagent — Stripe returns "This code is invalid." for EVERY code (verified with 100% and 50% codes, old- and new-style, all valid via API).
**Why:** Live-mode Checkout risk/bot detection rejects redemptions from the automated/headless browser environment; the same codes apply fine server-side (`discounts: [{ promotion_code }]` yields amount_total 0) and work for real humans.
**How to apply:** To e2e-test a discounted flow, create the Checkout Session with `discounts` pre-applied (mutually exclusive with `allow_promotion_codes`) and let the test complete that session; verify the promo code object itself via the API.

## 100% off checkout details
- `payment_method_collection: "if_required"` lets a $0 subscription checkout complete without a card.
- A fully discounted session completes with `payment_status: "no_payment_required"` (not "paid") — completion handlers must accept both.
- The owner test code is TESTFREE100 (coupon `testfree100`, 100% off forever, live Stripe account); seeded by `artifacts/api-server/scripts/seed-promo.ts` (idempotent).
