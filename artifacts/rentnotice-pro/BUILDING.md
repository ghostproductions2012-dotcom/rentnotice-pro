# Building RentNotice Pro Desktop Installers

This guide covers building the native desktop installers (macOS `.dmg`,
Windows `.msi` + NSIS `.exe`, Linux `.AppImage` + `.deb`) both **locally** and
through **GitHub Actions CI**, plus code signing, notarization, and the
auto-updater signing keys.

The desktop shell is [Tauri v2](https://v2.tauri.app). All Tauri config and Rust
source live in [`src-tauri/`](./src-tauri).

---

## 0. One-time repo setup a maintainer must do

Because this is a shared pnpm monorepo, a few Tauri-specific pieces are **not**
committed automatically. Add them once before your first desktop build.

### 0.1 Add the Tauri scripts + dev deps to `package.json`

Add the following to `artifacts/rentnotice-pro/package.json`. These scripts are
referenced by `src-tauri/tauri.conf.json` (`beforeDevCommand` /
`beforeBuildCommand`) and by the maintainer commands below.

```jsonc
{
  "scripts": {
    // ...existing scripts (dev, build, serve, typecheck) stay as-is...

    "tauri": "tauri",

    // Regenerate the icon set from a source PNG (see src-tauri/icons/README.md)
    "desktop:icon": "tauri icon ./src-tauri/icons/source-icon.png",

    // Frontend commands Tauri calls internally. They pin PORT + BASE_PATH so the
    // shared vite.config.ts works without edits. BASE_PATH must be relative (./)
    // for the packaged app to load assets from the local filesystem.
    "desktop:dev:web": "cross-env PORT=5000 BASE_PATH=/ vite --config vite.config.ts --host 0.0.0.0 --port 5000",
    "desktop:build:web": "cross-env PORT=5000 BASE_PATH=./ vite build --config vite.config.ts",

    // Maintainer entry points
    "desktop:dev": "cross-env PORT=5000 BASE_PATH=/ tauri dev",
    "desktop:build": "cross-env PORT=5000 BASE_PATH=./ tauri build"
  },
  "devDependencies": {
    // ...existing devDependencies stay as-is...
    "@tauri-apps/cli": "^2",
    "cross-env": "^7"
  }
}
```

> **Why `cross-env`?** `vite.config.ts` requires `PORT` and `BASE_PATH` to be set
> (it throws otherwise), and Windows `cmd` cannot use inline `VAR=value` syntax.
> `cross-env` sets them portably across macOS/Windows/Linux.

> **Note on the frontend output path.** `vite.config.ts` builds to `dist/public`
> (not `dist`), so `frontendDist` in `tauri.conf.json` is `"../dist/public"`.
> Do not change `vite.config.ts`; the Tauri config already points at the correct
> folder.

After editing `package.json`, run `pnpm install` from the repo root.

### 0.2 Generate the application icons

Tauri needs a real icon set (the binaries are not committed — see
[`src-tauri/icons/README.md`](./src-tauri/icons/README.md)):

```bash
pnpm --filter @workspace/rentnotice-pro run desktop:icon
```

---

## 1. Prerequisites

### 1.1 All platforms

- **Node.js 20+** and **pnpm** (via `corepack enable`)
- **Rust** (stable) + Cargo — install from <https://rustup.rs>:
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **Tauri CLI** — used through the `@tauri-apps/cli` dev dependency (added in
  step 0.1). You can also install it standalone:
  ```bash
  cargo install tauri-cli --version "^2"   # provides `cargo tauri ...`
  # or globally via npm/pnpm:
  pnpm add -g @tauri-apps/cli@^2            # provides `tauri ...`
  ```

### 1.2 macOS

- **Xcode Command Line Tools**: `xcode-select --install`
- To build **both** Apple Silicon and Intel binaries, add the Rust targets:
  ```bash
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  ```

### 1.3 Windows

- **Microsoft Visual Studio C++ Build Tools** (Desktop development with C++)
- **WebView2 Runtime** (preinstalled on Windows 11; installer available from
  Microsoft for Windows 10)
- NSIS support is handled by the Tauri bundler; no manual NSIS install required.

### 1.4 Linux (Debian/Ubuntu 22.04)

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  libappindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  patchelf \
  build-essential \
  file
```

---

## 2. Build installers locally

From the **repository root**:

```bash
corepack enable
pnpm install
```

Then, from the app package directory `artifacts/rentnotice-pro` (or with
`pnpm --filter @workspace/rentnotice-pro run ...` from anywhere):

```bash
# Optional: run the desktop app in dev mode against the Vite dev server
pnpm --filter @workspace/rentnotice-pro run desktop:dev

# Build the frontend + native installers for the current OS
pnpm --filter @workspace/rentnotice-pro run desktop:build
```

`desktop:build` runs Tauri, which:

1. runs `desktop:build:web` (the Vite build → `dist/public`), then
2. compiles the Rust shell and produces installers under
   `src-tauri/target/release/bundle/`:
   - macOS → `dmg/`
   - Windows → `nsis/` and `msi/`
   - Linux → `appimage/` and `deb/`

### Building a specific target

```bash
# Example: Intel macOS from an Apple Silicon machine
pnpm --filter @workspace/rentnotice-pro exec tauri build --target x86_64-apple-darwin
```

> **First build is slow** — Cargo compiles the full dependency tree. Subsequent
> builds are incremental.

---

## 3. Build & release via CI (GitHub Actions)

Two workflows live in [`.github/workflows/`](../../.github/workflows):

| Workflow      | Trigger                        | What it does                                            |
| ------------- | ------------------------------ | ------------------------------------------------------- |
| `ci.yml`      | pull requests, push to `main`  | `pnpm install` + typecheck the RentNotice Pro package   |
| `release.yml` | push a tag matching `v*`       | Matrix-builds installers and attaches them to a **draft** GitHub Release |

### 3.1 Cut a release

```bash
# Bump the version in src-tauri/tauri.conf.json (and src-tauri/Cargo.toml) first,
# then tag and push:
git tag v1.0.0
git push origin v1.0.0
```

The `release.yml` matrix builds on:

- `macos-latest` — Apple Silicon (`aarch64-apple-darwin`)
- `macos-latest` — Intel (`x86_64-apple-darwin`)
- `windows-latest`
- `ubuntu-22.04`

When the builds finish, a **draft** GitHub Release is created with all installers
attached. Review it and click **Publish** when ready.

### 3.2 Required / optional secrets

All signing secrets are **optional**. If a secret is unset, that signing/
notarization step is skipped and the build still produces working **unsigned**
installers (nothing hard-fails). Add secrets under
**Repo → Settings → Secrets and variables → Actions**.

| Secret                                | Platform | Purpose                                                        | Required? |
| ------------------------------------- | -------- | -------------------------------------------------------------- | --------- |
| `GITHUB_TOKEN`                        | all      | Create the draft Release / upload assets (provided automatically) | Automatic |
| `TAURI_SIGNING_PRIVATE_KEY`           | all      | Sign auto-updater artifacts (`.sig`) — see §4                   | Optional* |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  | all      | Password for the updater private key                           | Optional  |
| `APPLE_CERTIFICATE`                   | macOS    | Base64 of the `.p12` Developer ID Application certificate      | Optional  |
| `APPLE_CERTIFICATE_PASSWORD`          | macOS    | Password for the `.p12`                                        | Optional  |
| `APPLE_SIGNING_IDENTITY`             | macOS    | e.g. `Developer ID Application: Company (TEAMID)`              | Optional  |
| `APPLE_ID`                            | macOS    | Apple ID email used for notarization                          | Optional  |
| `APPLE_PASSWORD`                      | macOS    | App-specific password for notarization                        | Optional  |
| `APPLE_TEAM_ID`                       | macOS    | Apple Developer Team ID                                       | Optional  |
| `WINDOWS_CERTIFICATE`                 | Windows  | Base64 of the code-signing `.pfx`                             | Optional  |
| `WINDOWS_CERTIFICATE_PASSWORD`        | Windows  | Password for the `.pfx`                                       | Optional  |

\* If `TAURI_SIGNING_PRIVATE_KEY` is **not** set, `release.yml` automatically
disables updater artifact generation for that run
(`--config {"bundle":{"createUpdaterArtifacts":false}}`) so the build succeeds
without it.

**Windows signing note:** `release.yml` imports `WINDOWS_CERTIFICATE` into the
runner's certificate store (only when set) and exports its thumbprint as
`WINDOWS_SIGN_THUMBPRINT`. To actually sign the Windows bundles, add the
thumbprint to `src-tauri/tauri.conf.json` under `bundle.windows`:

```jsonc
"windows": {
  "certificateThumbprint": "<your-thumbprint>",
  "digestAlgorithm": "sha256",
  "timestampUrl": "http://timestamp.digicert.com"
}
```

Leave it unset for unsigned CI builds.

---

## 4. Auto-updater signing keys

The updater plugin is pre-wired in `src-tauri/tauri.conf.json` with a
**placeholder** endpoint and public key:

```jsonc
"plugins": {
  "updater": {
    "endpoints": ["https://releases.rentnotice.pro/updater/{{target}}/{{arch}}/{{current_version}}"],
    "pubkey": "REPLACE_WITH_YOUR_TAURI_UPDATER_PUBLIC_KEY_BASE64"
  }
}
```

To enable real auto-updates:

1. **Generate a keypair** with the Tauri signer:

   ```bash
   pnpm --filter @workspace/rentnotice-pro exec tauri signer generate -w ~/.tauri/rentnotice-pro.key
   ```

   This prints a **public key** and writes a **private key** file.

2. **Set the public key** — paste the printed public key into
   `tauri.conf.json` → `plugins.updater.pubkey`.

3. **Set the private key as CI secrets:**
   - `TAURI_SIGNING_PRIVATE_KEY` = the contents of the private key file
     (or its base64), and
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you chose.

4. **Point `endpoints`** at wherever you host `latest.json` and the signed
   artifacts.

> Keep the private key secret and backed up. Losing it means you cannot ship
> updates that existing installs will accept.

With the key present, CI produces signed updater artifacts and a `latest.json`
manifest alongside the installers.
