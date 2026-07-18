#!/bin/bash
set -e
pnpm install --frozen-lockfile

# Rebuild composite lib declarations (dist/ is gitignored, so each env's
# copy can go stale after merges and break per-package tsc typechecks).
pnpm run typecheck:libs

# Reconcile the invite_token -> invite_code rename before drizzle push:
# push prompts interactively on renames and dies when stdin is closed.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'cloud_users' AND column_name = 'invite_token')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'cloud_users' AND column_name = 'invite_code') THEN
    ALTER TABLE cloud_users RENAME COLUMN invite_token TO invite_code;
  END IF;
END
\$\$;"

# Migrate legacy plaintext field sync tokens to hashed storage before drizzle
# push (rename-like change would otherwise hit an interactive prompt, and the
# backfill must run while the plaintext column still exists).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'field_sync_tokens' AND column_name = 'token') THEN
    ALTER TABLE field_sync_tokens ADD COLUMN IF NOT EXISTS token_hash text;
    ALTER TABLE field_sync_tokens ADD COLUMN IF NOT EXISTS token_suffix text NOT NULL DEFAULT '';
    UPDATE field_sync_tokens
      SET token_hash = encode(sha256(convert_to(upper(trim(token)), 'UTF8')), 'hex'),
          token_suffix = right(upper(trim(token)), 4)
      WHERE token_hash IS NULL;
    ALTER TABLE field_sync_tokens ALTER COLUMN token_hash SET NOT NULL;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                   WHERE conname = 'field_sync_tokens_token_hash_unique') THEN
      ALTER TABLE field_sync_tokens
        ADD CONSTRAINT field_sync_tokens_token_hash_unique UNIQUE (token_hash);
    END IF;
    ALTER TABLE field_sync_tokens DROP COLUMN token;
  END IF;
END
\$\$;"

pnpm --filter db push

# Provision the secure owner master-admin account from MASTER_ADMIN_EMAIL /
# MASTER_ADMIN_PASSWORD and retire the legacy admin@admin.com test login
# (idempotent; skips owner provisioning with a log line if secrets are unset).
# The bundle must live inside the package dir (external deps can't resolve
# from /tmp), and LOG_PRETTY=0 keeps the pino logger off its pino-pretty
# transport — transports spawn worker threads that break inside an ESM bundle.
(cd artifacts/api-server \
  && node_modules/.bin/esbuild scripts/seed-admin.ts --bundle --platform=node --format=esm --outfile=.seed-admin.mjs --external:pg-native --external:stripe-replit-sync --log-level=warning --banner:js="import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);" \
  && LOG_PRETTY=0 node .seed-admin.mjs \
  && rm -f .seed-admin.mjs)

# Seed Stripe products/prices from the tier catalog and sync them into this
# environment's local stripe schema (idempotent; task-env DB state does not
# carry over, so the sync must run here too). The bundle must live inside the
# package dir: stripe-replit-sync stays external and can't resolve from /tmp.
(cd artifacts/api-server \
  && node_modules/.bin/esbuild scripts/seed-products.ts --bundle --platform=node --format=esm --outfile=.seed-products.mjs --external:pg-native --external:stripe-replit-sync --log-level=warning --banner:js="import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);" \
  && node .seed-products.mjs \
  && rm -f .seed-products.mjs)
