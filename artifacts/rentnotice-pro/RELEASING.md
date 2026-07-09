# How to release a new version of RentNotice Pro (plain-language guide)

Installers for Windows and Mac are built automatically by GitHub Actions —
nothing is compiled on your computer. A release takes about 3 small steps and
20–30 minutes of waiting.

## 1. Bump the version number

Change the version in **two files** (keep them identical):

1. `artifacts/rentnotice-pro/src-tauri/tauri.conf.json` → `"version": "1.0.1"`
2. `artifacts/rentnotice-pro/src-tauri/Cargo.toml` → `version = "1.0.1"`

Commit and push that change to GitHub (`main` branch).

## 2. Tag the release

From the repository, create and push a tag that starts with `v`:

```bash
git tag v1.0.1
git push origin v1.0.1
```

That tag push is the trigger — GitHub Actions immediately starts building:

- Windows installer (`.exe`) and package (`.msi`)
- Mac disk images (`.dmg`) for Apple Silicon (M1–M4) and Intel
- Linux packages (built as a sanity check; you don't need to ship them)

Watch progress under the repo's **Actions** tab. Expect ~20–30 minutes.

## 3. Publish the draft release

When the builds finish, GitHub creates a **draft release** with all installers
attached:

1. Go to the repo → **Releases** → you'll see "RentNotice Pro v1.0.1 (Draft)".
2. Open it, check the installers are attached, edit the notes if you like.
3. Click **Publish release**.

The website's Download page always points at the **latest published** release,
so as soon as you publish, customers get the new version automatically — no
website change needed.

## Things to know

- **Mac builds are signed & notarized:** the six `APPLE_*` GitHub Actions
  secrets are configured, so every release's `.dmg` files are Developer ID
  signed and notarized by Apple automatically — Macs open them with no
  warnings. (If the Apple certificate is ever renewed, update the secrets —
  see `BUILDING.md` §3.2/§3.3.)
- **Windows is still unsigned:** Windows shows a SmartScreen warning
  ("More info" → "Run anyway") until a Windows code-signing certificate or
  cloud signing service is set up. The Download page explains this to
  customers. See `BUILDING.md` §3.3.
- **If the licensing server URL ever changes:** edit the single
  `VITE_LICENSE_API_URL` value at the top of `.github/workflows/release.yml`,
  then cut a new release.
- **No auto-updates in v1:** installed apps do not update themselves; customers
  download new versions from the website. `BUILDING.md` §4 explains how to
  enable auto-updates later.
