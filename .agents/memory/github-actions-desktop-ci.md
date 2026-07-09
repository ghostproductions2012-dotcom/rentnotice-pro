---
name: GitHub Actions CI for this monorepo
description: Gotchas when building this pnpm monorepo (and Tauri installers) on GitHub-hosted runners
---

# GitHub Actions + pnpm monorepo gotchas

- **Replit GitHub connector token cannot push workflow files** (OAuth app lacks `workflow` scope). Pushing `.github/workflows/**` requires the user's classic PAT with `repo` + `workflow` scopes — stored as the `GITHUB_PERSONAL_ACCESS_TOKEN` secret.
  **How to apply:** push via `git -c credential.helper='!f() { echo username=x-access-token; echo password=$GITHUB_PERSONAL_ACCESS_TOKEN; }; f'` — never bake the token into remotes or argv.
- **Pin `packageManager` in root package.json.** Without it, corepack on CI grabs the newest pnpm major, which can differ from the local version and change behavior (pnpm 11 needs Node 22+ for `node:sqlite`, and hard-fails on ignored build scripts where pnpm 10 only warns).
- **The workspace's platform-binary exclusions (`"pkg>@pkg/darwin-*": "-"` overrides) break macOS/Windows runners.** They are a Replit linux-x64 size optimization; darwin-arm64/darwin-x64/win32-x64 binaries for esbuild, rollup, lightningcss, and @tailwindcss/oxide must stay installable or `vite build` dies on mac/windows CI. **Why:** rollup has no download fallback when its native module is missing.
- **Tauri macOS bundling treats an EMPTY `APPLE_CERTIFICATE` env var as present** and fails importing the keychain cert. Never map unset secrets to job-level env; inject signing env only inside steps guarded by a boolean flag (`HAS_X: ${{ secrets.X != '' }}` at job env — `secrets` context is NOT allowed in step `if:`).
- **A workflow run named after the file path with 0 jobs = workflow parse error** (e.g. using `secrets` in a step `if:`).
- **Tag pushes sometimes don't trigger `on: push: tags` on a brand-new repo** — delete the remote tag and re-push it to trigger.
- Repo: `ghostproductions2012-dotcom/rentnotice-pro` (public — required so customers can download release assets without a GitHub login). CI typecheck job fails due to the pre-existing rentnotice-pro licensing http.ts type errors (separate task).
