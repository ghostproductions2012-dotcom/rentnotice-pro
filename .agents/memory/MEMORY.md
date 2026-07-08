# Memory Index

- [Platform limits](platform-limits.md) — mobile (Expo) artifacts cannot be created when the project is opened from the iOS Replit app; plan mobile work for replit.com sessions.
- [RentNotice e2e testing quirks](rentnotice-e2e-testing.md) — in-memory session: page.goto logs you out; use SPA sidebar navigation in test plans; fresh context = fresh IndexedDB app.
- Licensing adapter contract: transport failures MUST become LicensingUnavailableError ("offline, keep cached state"); anything else is a real error. Detail in replit.md licensing section.
- TS gotcha (sql.js app): assignments inside `db.transaction(() => {...})` closures aren't tracked by narrowing — read results back after the transaction instead.
