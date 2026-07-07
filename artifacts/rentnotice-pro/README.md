# RentNotice Pro

**California 3-Day Pay or Quit notice preparation suite for property managers.**

RentNotice Pro is an **offline-first** desktop application that helps California
property management staff import tenant ledgers, isolate **rent-only** balances,
review every exclusion, and prepare **3-Day Notices to Pay Rent or Quit** together
with supporting service/proof documents — without sending tenant data to the cloud.

It ships both as a web app (React + Vite) and as a signed desktop app (Tauri v2)
for macOS, Windows, and Linux.

---

## ⚠️ Legal Disclaimer — Read First

> **RentNotice Pro is NOT a law firm and does NOT provide legal advice.**
>
> This software is a document-preparation and calculation aid only. It does not
> create an attorney–client relationship and is **not a substitute for advice from
> a qualified California landlord–tenant attorney.**
>
> - Every notice, template, and calculation **must be reviewed by a licensed
>   California attorney before it is served or relied upon.**
> - California and local (e.g. city/county) landlord–tenant law changes frequently.
>   Deadlines, required language, notice periods, and service methods vary by
>   jurisdiction and over time.
> - The **deadline calculator** and any generated dates are **informational
>   estimates only** and are subject to legal review.
> - RentNotice Pro **never silently includes late fees, utilities, deposits, or any
>   other non-rent charges** in a notice amount — but you remain responsible for
>   confirming that the final amount reflects rent only.
> - Use of this software is entirely at your own risk. The authors and contributors
>   accept no liability for how notices produced with this tool are used.
>
> By using this software you acknowledge that you are responsible for compliance
> with all applicable laws and for obtaining independent legal review.

---

## Features

- **Tenant & property files** — capture legal names, addresses, units, owner /
  management company, authorized payment recipient, payment address, accepted
  methods, and office hours, with validation before a notice can be finalized.
- **Ledger import** — PDF, Excel (`.xlsx`), CSV, or manual entry, with a
  column-mapping wizard and saveable mapping presets.
- **Rent classification engine** — detects rent charges, payments, partial
  payments, credits, reversals, and non-rent charges; **all exclusions are always
  visible** (late fees, utilities, deposits, legal fees, parking, pet, admin, etc.).
- **Transparent, auditable calculations** — rent-only balance computed month by
  month, with full-month periods (1st → last day, leap years handled) and clear
  warnings for ambiguous or unapplied payments.
- **Compliance safeguards** — two-tier warnings/blockers stop finalization when
  required data is missing or when non-rent charges would be included.
- **Document generation** — 3-Day Notice, proof of service, posting/mailing
  checklist, internal calculation review, excluded-charge summary, and audit
  summary, exported as a locked PDF package.
- **Deadline calculator** — informational service-to-expiration estimator with an
  editable California court-holiday calendar.
- **Notice status tracking & audit trail** — full lifecycle (Draft → Reviewed →
  Finalized → Served → … → Sent to Attorney) with a tamper-evident action log.
- **Offline-first & private** — data stays on the local machine; no tenant data
  leaves the device without explicit consent.

---

## Tech Stack

| Layer            | Technology                                             |
| ---------------- | ------------------------------------------------------ |
| UI               | React 19 + TypeScript, Tailwind CSS, shadcn/ui, wouter |
| Build tooling    | Vite 7                                                 |
| Local data       | SQLite via `sql.js`, `idb-keyval`                       |
| Ledger parsing   | SheetJS (`xlsx`), PapaParse (CSV), `pdfjs-dist`, `tesseract.js` (OCR) |
| Documents        | `pdf-lib`                                               |
| Dates            | `date-fns`                                              |
| Desktop shell    | **Tauri v2** (Rust) — `dialog`, `fs`, `updater` plugins |
| Monorepo         | pnpm workspaces                                         |
| CI / installers  | GitHub Actions + `tauri-apps/tauri-action`             |

---

## Developer Quickstart

This package lives inside a **pnpm monorepo**. Install dependencies from the
repository root, then run the app through the workspace tooling.

```bash
# From the repository root
corepack enable          # use the repo's pnpm via corepack
pnpm install             # install all workspace packages

# Run the RentNotice Pro web app (dev)
pnpm --filter @workspace/rentnotice-pro run dev
```

> The dev server reads `PORT` and `BASE_PATH` from the environment (configured by
> the workspace tooling). Do not change `vite.config.ts`.

Other useful commands:

```bash
pnpm --filter @workspace/rentnotice-pro run typecheck   # type-check this package
pnpm --filter @workspace/rentnotice-pro run build        # production web build (-> dist/public)
pnpm --filter @workspace/rentnotice-pro run serve        # preview the production build
```

---

## Desktop Builds (Tauri)

The desktop scaffold lives in [`src-tauri/`](./src-tauri). To build native
installers (`.dmg`, `.msi`/NSIS `.exe`, `.AppImage`, `.deb`) locally or via CI —
including code signing, notarization, and the auto-updater keys — see:

### 👉 [BUILDING.md](./BUILDING.md)

`BUILDING.md` also documents the extra `package.json` scripts a maintainer needs
to add for the Tauri workflow (they are intentionally **not** added automatically).
