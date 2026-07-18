# Chat sign-in token expiry — production rollout

Chat member sign-in tokens (`chat_member_tokens`) expire 60 days after minting.
Enforcement lives in `artifacts/api-server/src/routes/comms.ts`; the schema
column is `expires_at` (`lib/db/src/schema/communications.ts`, text, default
`''`).

## How this reaches production

Production schema changes are applied exclusively by Replit's Publish flow,
which diffs the development schema against production and applies the result
alongside the new server build. Nothing in this repo runs DDL against
production, and it must stay that way (no deploy hooks, no startup DDL).

Current state (verified July 18, 2026):

- Dev database has `expires_at` (applied via `pnpm --filter db push`,
  non-interactive — plain column add, no rename prompt).
- Production does not have the `chat_member_tokens` table at all yet, so the
  next publish creates it fresh with `expires_at`. There are no legacy prod
  rows to migrate.

## Post-publish verification

Run the executable check against production (steps that need direct DB access
skip automatically when `DATABASE_URL` is not set):

```
CHAT_EXPIRY_BASE_URL=https://<prod-domain> \
CHAT_EXPIRY_LICENSE_KEY=<live license key> \
CHAT_EXPIRY_IDENTIFIER=<member email> CHAT_EXPIRY_SECRET=<password> \
pnpm --filter @workspace/scripts run check:chat-token-expiry
```

Manual checklist equivalent:

1. Read-only prod query: `chat_member_tokens` exists and has `expires_at`
   (`information_schema.columns`).
2. Mint a token on the live site (`POST /api/comms/identity/token` with a valid
   member login) — response includes `expiresAt` roughly 60 days out.
3. Expired-token behavior: a token whose `expires_at` is in the past gets 401
   from member-authenticated routes (e.g. `GET /api/comms/members`). Rows with
   empty `expires_at` inherit `created_at` + 60 days.

All three were verified against the development server on July 18, 2026.
