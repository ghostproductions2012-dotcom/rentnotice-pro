# RentNotice Pro — Notice Suite

## Overview
Offline-first, desktop-ready eviction-notice preparation suite for California property managers. Prepares CA 3-Day Notices (and other CA notice types), imports rent ledgers from PM software exports, performs rent-only demand calculations, runs two-level legal validation (warnings vs blockers), computes court-day deadlines with CA judicial holidays, and generates finished PDF document packets — all client-side with no server dependency for core features. NOT legal advice; all output gated behind a prominent legal disclaimer and attorney-review flags for non-CA templates.

## Architecture
- **Web app**: `artifacts/rentnotice-pro` (React + Vite, previewPath `/`), package `@workspace/rentnotice-pro`.
- **Local-first data**: sql.js (SQLite WASM) persisted to IndexedDB (`src/lib/db/`), versioned migrations, seeded demo data, JSON + SQLite backup export/import.
- **Shared contract** (do not change without updating all consumers): `src/lib/types.ts` (domain types; money = integer cents; dates = ISO strings), `src/lib/api/services.ts` (AppServices interface + registry), `src/lib/api/hooks.ts` (TanStack Query hooks).
- **Service implementation**: `src/lib/api/impl.ts` — registered via `registerServicesFactory` at module load (imported in `main.tsx`).
- **Engines** (pure functions): `src/lib/engine/` — classification, rent-only calculation, validation, CA judicial holidays, deadline counting, notice-type + 50-state rules.
- **Import**: `src/lib/import/` — CSV (PapaParse), Excel (SheetJS), text PDF (pdfjs-dist), OCR (tesseract.js), column auto-mapping, PM vendor presets (AppFolio/Buildium/Yardi/Propertyware/Rent Manager).
- **Documents**: `src/lib/documents/` — pdf-lib generators for all document kinds, DRAFT watermark, merge-field templates, packet assembly. Template data in `src/lib/templates-data/` (CA full templates; 50-state attorney-review-gated).
- **Frontend**: `src/pages/`, `src/components/`, wouter routing. Login = username-or-email + PIN/password form (no pre-auth user list; generic error on failure). Demo accounts: `arivera`/1234 (admin), `mlee`/2345 (manager), `jchen`/3456 (staff), emails `@goldenstatepm.com`. Usernames/emails live in `users` table (migration v3 backfills first-initial+lastname for pre-existing DBs).
- **Desktop packaging**: `artifacts/rentnotice-pro/src-tauri/` (Tauri v2, config-only) + `.github/workflows/release.yml` (installers) and `ci.yml`. See `artifacts/rentnotice-pro/BUILDING.md`.
- **Mobile companion (deferred)**: Expo app "rentnotice-field" + sync routes in `artifacts/api-server` (Postgres) — only for field assignment/evidence relay, not DB replication. Creation was platform-blocked (mobile artifacts cannot be created when the project is opened from the iOS Replit app; requires replit.com). Tracked as a follow-up task.
- **Tests**: `pnpm run test` inside `artifacts/rentnotice-pro` (Vitest, standalone `vitest.config.ts` — the main `vite.config.ts` requires PORT/BASE_PATH env and cannot be reused). 52 tests: `src/lib/engine/__tests__/` (classification, calculation, deadlines, validation) + `src/lib/import/__tests__/` (money/date parsing, CSV pipeline, vendor presets; fixture in `fixtures/generic-ledger.csv`). `pnpm run typecheck` must also stay green.

## Legal-Logic Invariants (keep tests in sync)
- 3-day notices count **court days** (day after service = day 1; weekends + CA judicial holidays skipped). 30/60-day notices count calendar days and roll forward off weekends/holidays. Built-in holiday dataset covers 2024–2030; out-of-range years are computed on demand and flagged in `DeadlineResult.warnings`.
- Fee keywords always beat the generic "rent" keyword; negative amounts are authoritatively money-in. Rent-only calculation never includes non-rent charges, never auto-applies deposits, and only carries overpayments forward when explicitly enabled.
- Rent increases >10% of the tenant's scheduled rent raise validation warning `rent_increase_over_10_percent` (Civ. Code §827(b)(2) requires 90 days' notice; the deadline rule itself still computes 30 days — deeper fix tracked as follow-up).

## User Preferences
(none recorded yet)
