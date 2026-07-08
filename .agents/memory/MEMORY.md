# Memory Index

- [Platform limits](platform-limits.md) — mobile (Expo) artifacts cannot be created when the project is opened from the iOS Replit app; plan mobile work for replit.com sessions.
- [RentNotice e2e testing quirks](rentnotice-e2e-testing.md) — in-memory session: page.goto logs you out; use SPA sidebar navigation in test plans; fresh context = fresh IndexedDB app.
- Licensing adapter contract: transport failures MUST become LicensingUnavailableError ("offline, keep cached state"); anything else is a real error. Detail in replit.md licensing section.
- TS gotcha (sql.js app): assignments inside `db.transaction(() => {...})` closures aren't tracked by narrowing — read results back after the transaction instead.
- [stripe-replit-sync gotchas](stripe-replit-sync.md) — must be esbuild-external (silent migration skip when bundled); connector settings use `secret` not `secret_key`.
- [@types/react version split](types-react-split.md) — Expo app pins older @types/react; libs without an @types/react peer and files using global `React` resolve the hoisted old copy and break web typechecks.
- [Email via Resend](email-sending.md) — user chose RESEND_API_KEY secret over the connector; rentnoticepro.com verified, EMAIL_FROM set; key is send-only (can't list domains).
- [Dev DB schema drift](dev-db-schema-drift.md) — drizzle push dies on rename prompts (no TTY); apply renames via SQL, then re-run push to confirm no diff.
- [Task-env dev DB is isolated](isolated-env-dev-db.md) — data seeded in a task env's dev Postgres never reaches main; run seeds from scripts/post-merge.sh. No prod DB until first publish.
