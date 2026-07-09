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
- **Workspace git history and the GitHub repo history diverge by SHA** (platform task-merges rewrite commits; CI fixes were committed directly on GitHub's main). To sync: `git diff FETCH_HEAD HEAD` to confirm content parity, then force-push workspace main. Existing tags/releases survive a force-push.
- **First-ever Apple notarization for a team can take 2+ hours** (v1.0.1's macOS jobs sat in "Build desktop installers" ~2h13m and then succeeded). Do NOT cancel — resubmitting restarts the queue wait from zero. Subsequent notarizations are typically minutes.
- **Publishing a draft release via `PATCH draft=false` does not make it `releases/latest`** — follow with a second `PATCH` setting `make_latest="true"` (string), then re-check `releases/latest`.
- **macOS signed+notarized release jobs are SLOW (~45–60 min each) and that's normal** — the release profile uses full LTO (`lto=true`, `codegen-units=1`), so the cold Rust compile dominates, then Apple's notary queue adds more. All 6 `APPLE_*` secrets are set on the repo (Developer ID: Christopher Oliveri, Team `B8A686T795`, cert expires 2027-02-01). If the "Enable Apple code signing" step goes green, the credentials are good; a later failure in "Build desktop installers" points at notary auth (app-specific password / Team ID), not the cert.
- **The release is created as a DRAFT** (`releaseDraft: true`) and the downloads API only serves the latest PUBLISHED release — so a signed build isn't live to customers until the owner clicks Publish on the draft in GitHub Releases.
- Repo: `ghostproductions2012-dotcom/rentnotice-pro`. Customer downloads are proxied through the API server (`/api/www/downloads/*`, authenticated via the GitHub connector with `GITHUB_TOKEN` secret fallback), so the repo can be private. Private-repo assets must be fetched by asset id with `Accept: application/octet-stream` (GitHub 302s to a signed URL) — `browser_download_url` does not work unauthenticated. CI typecheck job fails due to the pre-existing rentnotice-pro licensing http.ts type errors (separate task).
