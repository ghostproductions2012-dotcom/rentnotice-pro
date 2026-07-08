---
name: Dev DB schema drift & drizzle push renames
description: drizzle-kit push cannot run non-interactively on column renames; dev DB can silently lag behind schema renames.
---

# Dev DB schema drift & drizzle push renames

`drizzle-kit push` opens an interactive TTY prompt when it detects a possible
column rename (e.g. old column vs. new column with same type). In this
environment there is no TTY, so push errors out and the rename never lands —
the dev database can silently stay on the old column name while the code and
schema use the new one.

**Why:** the licensing DB was found still using an old column name long after
the schema had renamed it; push had been failing on the rename prompt.

**How to apply:** when `pnpm --filter @workspace/db run push` fails with
"Interactive prompts require a TTY", apply the rename/add directly with SQL
(`executeSql`), then re-run push to confirm "Changes applied" (no diff).
After schema changes, sanity-check `information_schema.columns` against the
drizzle schema if anything behaves oddly.
