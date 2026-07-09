---
name: Stale composite lib dist breaks per-package typechecks
description: Why per-package tsc can fail on types that look correct in lib source, and how it self-heals
---

# Stale composite lib dist breaks per-package typechecks

Rule: if a per-package `tsc -p . --noEmit` reports a missing property/export from a `@workspace/*` lib but the lib's `src/generated` types clearly have it, suspect stale `lib/*/dist` declarations — run `pnpm run typecheck:libs` (root `tsc --build`) before touching any code.

**Why:** Leaf tsconfigs use project references, so command-line tsc reads the lib's emitted `dist/*.d.ts`, not its source — even though package.json `exports` point at `src/index.ts`. `dist/` and `.tsbuildinfo` are gitignored, so every environment (including main after merges) has its own copy that silently drifts after codegen or lib edits land via merge. The canonical `pnpm run typecheck` self-heals because it runs `typecheck:libs` first; the narrower per-package command does not.

**How to apply:** Always prefer `pnpm run typecheck` (or run `typecheck:libs` first) when validating. `scripts/post-merge.sh` now rebuilds lib declarations after every merge so main's copy stays fresh (~2s incremental).
