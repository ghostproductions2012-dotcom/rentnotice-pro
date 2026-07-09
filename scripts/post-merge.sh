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

pnpm --filter db push

# Seed the admin@admin.com / admin test account (idempotent upsert).
# Remove these two lines once the owner is done testing and deletes the account,
# otherwise it will be recreated on the next merge.
(cd artifacts/api-server && node_modules/.bin/esbuild scripts/seed-admin.ts --bundle --platform=node --format=esm --outfile=/tmp/seed-admin.mjs --external:pg-native --external:stripe-replit-sync --log-level=warning --banner:js="import { createRequire as __cr } from 'node:module'; globalThis.require = __cr(import.meta.url);")
node /tmp/seed-admin.mjs
