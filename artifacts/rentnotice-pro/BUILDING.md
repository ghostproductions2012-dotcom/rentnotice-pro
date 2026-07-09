# Building RentNotice Pro Desktop Installers

This guide covers building the native desktop installers (macOS `.dmg`,
Windows `.msi` + NSIS `.exe`, Linux `.AppImage` + `.deb`) both **locally** and
through **GitHub Actions CI**, plus code signing, notarization, and the
auto-updater signing keys.

The desktop shell is [Tauri v2](https://v2.tauri.app). All Tauri config and Rust
source live in [`src-tauri/`](./src-tauri).

---

## 0. One-time repo setup — DONE

The maintainer setup this section used to describe is complete and committed:

- The `tauri`, `desktop:icon`, `desktop:dev(:web)`, and `desktop:build(:web)`
  scripts plus the `@tauri-apps/cli` and `cross-env` dev dependencies live in
  `artifacts/rentnotice-pro/package.json`.
- The full application icon set is generated and committed under
  [`src-tauri/icons/`](./src-tauri/icons) (see its README to regenerate after a
  branding change).

> **Why `cross-env`?** `vite.config.ts` requires `PORT` and `BASE_PATH` to be set
> (it throws otherwise), and Windows `cmd` cannot use inline `VAR=value` syntax.
> `cross-env` sets them portably across macOS/Windows/Linux. `BASE_PATH` must be
> relative (`./`) for the packaged app to load assets from the local filesystem.

> **Note on the frontend output path.** `vite.config.ts` builds to `dist/public`
> (not `dist`), so `frontendDist` in `tauri.conf.json` is `"../dist/public"`.
> Do not change `vite.config.ts`; the Tauri config already points at the correct
> folder.

### 0.1 The production API URL

Installed desktop apps must talk to the hosted licensing server, not
"same origin" (there is no same origin inside a packaged app). The URL is baked
in at build time from the `VITE_LICENSE_API_URL` environment variable (read in
`src/lib/licensing/http.ts`).

- **CI releases:** `release.yml` sets it at the top of the workflow (`env:` →
  `VITE_LICENSE_API_URL`). Change that ONE value if the server moves.
- **Local desktop builds:** export it yourself before `desktop:build`, e.g.
  `VITE_LICENSE_API_URL=https://cross-platform-ghost-music.replit.app`.

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
| `APPLE_CERTIFICATE`                   | macOS    | Base64 of the `.p12` Developer ID Application certificate      | Optional  |
| `APPLE_CERTIFICATE_PASSWORD`          | macOS    | Password for the `.p12`                                        | Optional  |
| `APPLE_SIGNING_IDENTITY`             | macOS    | e.g. `Developer ID Application: Company (TEAMID)`              | Optional  |
| `APPLE_ID`                            | macOS    | Apple ID email used for notarization                          | Optional  |
| `APPLE_PASSWORD`                      | macOS    | App-specific password for notarization                        | Optional  |
| `APPLE_TEAM_ID`                       | macOS    | Apple Developer Team ID                                       | Optional  |
| `WINDOWS_CERTIFICATE`                 | Windows  | Base64 of the code-signing `.pfx`                             | Optional  |
| `WINDOWS_CERTIFICATE_PASSWORD`        | Windows  | Password for the `.pfx`                                       | Optional  |

**Windows signing note:** `release.yml` imports `WINDOWS_CERTIFICATE` into the
runner's certificate store (only when set) and automatically patches
`bundle.windows` in `src-tauri/tauri.conf.json` **during the CI build** with the
certificate thumbprint, `sha256` digest, and a DigiCert timestamp URL. No
manual config edit is needed — just set the two `WINDOWS_*` secrets and the
MSI/NSIS installers come out signed. Leave the secrets unset for unsigned CI
builds. (Do not commit a thumbprint to `tauri.conf.json`; it is machine/cert
specific and CI injects it per-build.)

**macOS signing/notarization note:** when the six `APPLE_*` secrets are set,
`tauri-action` signs the app with the Developer ID Application certificate and
submits it to Apple for notarization automatically (this adds ~5–15 minutes to
the macOS jobs). All six secrets must be set together for notarization to work.

### 3.3 Obtaining the signing certificates (owner checklist)

Both certificates require enrollment/purchases only the business owner can do.

**Apple (removes the macOS "cannot verify the developer" warning):**

1. Enroll in the [Apple Developer Program](https://developer.apple.com/programs/enroll/)
   — 99 USD/year. Enrolling as an organization requires a D-U-N-S number.
2. In your Apple Developer account (Certificates → +), create a
   **Developer ID Application** certificate. Generate the CSR with Keychain
   Access on any Mac, download the certificate, and install it into the keychain.
3. Export the certificate + private key from Keychain Access as a `.p12` with a
   password, then base64-encode it: `base64 -i cert.p12 | pbcopy`.
4. Create an **app-specific password** for your Apple ID at
   <https://account.apple.com> (Sign-In & Security → App-Specific Passwords).
5. Find your **Team ID** on the Apple Developer membership page.
6. Set the GitHub secrets: `APPLE_CERTIFICATE` (the base64),
   `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`
   (`Developer ID Application: <Name> (<TEAMID>)`), `APPLE_ID`,
   `APPLE_PASSWORD` (the app-specific password), `APPLE_TEAM_ID`.

**Windows (removes the SmartScreen "Windows protected your PC" warning):**

- Buy an **OV or EV code-signing certificate** from a CA such as Sectigo,
  DigiCert, or SSL.com (roughly 200–500 USD/year; identity/business validation
  takes a few days). Ask for a certificate you can export as a password-protected
  `.pfx` file. Base64-encode it (`base64 -w0 cert.pfx` on Linux/macOS, or
  `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx"))` in
  PowerShell) and set `WINDOWS_CERTIFICATE` and `WINDOWS_CERTIFICATE_PASSWORD`.
- **Caveat:** since June 2023, CAs must deliver most code-signing certificates
  on hardware tokens or in cloud HSMs, which cannot be exported as a `.pfx`.
  If your CA cannot provide an exportable file, the current CI signing step
  won't work as-is — cloud signing services (e.g. Azure Trusted Signing at
  ~9.99 USD/month, or SSL.com eSigner) are the modern alternative but need a
  different CI step. Confirm delivery format **before** buying.
- Note: with an OV certificate, SmartScreen warnings fade only after the signed
  app builds download reputation (days to weeks). EV certificates and Azure
  Trusted Signing generally get immediate reputation.

After the secrets are in place, cut a new release (bump the version, push a
`v*` tag), verify a fresh download installs without warnings on both OSes, and
update the security-warning copy on the website's `/download` page.

---

## 4. Auto-updater (disabled in v1)

The auto-updater is **fully disabled** for v1 so installed apps never contact a
placeholder endpoint: the `tauri-plugin-updater` dependency is removed from
`src-tauri/Cargo.toml`, the plugin is not registered in `src-tauri/src/lib.rs`,
`updater:default` is removed from `src-tauri/capabilities/default.json`, and
`bundle.createUpdaterArtifacts` is `false` in `tauri.conf.json`. Customers get
new versions by downloading them from the website's Download page.

To enable real auto-updates later:

1. **Re-add the plugin:**
   - `src-tauri/Cargo.toml` → add
     `[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]`
     with `tauri-plugin-updater = "2"`.
   - `src-tauri/src/lib.rs` → register
     `tauri_plugin_updater::Builder::new().build()` behind `#[cfg(desktop)]`.
   - `src-tauri/capabilities/default.json` → add `"updater:default"`.
   - `tauri.conf.json` → set `bundle.createUpdaterArtifacts` to `true` and add a
     `plugins.updater` section with your real endpoint + public key.

2. **Generate a keypair** with the Tauri signer:

   ```bash
   pnpm --filter @workspace/rentnotice-pro exec tauri signer generate -w ~/.tauri/rentnotice-pro.key
   ```

   This prints a **public key** and writes a **private key** file.

3. **Set the public key** — paste the printed public key into
   `tauri.conf.json` → `plugins.updater.pubkey`.

4. **Set the private key as CI secrets** (and re-wire them into `release.yml`'s
   job `env`):
   - `TAURI_SIGNING_PRIVATE_KEY` = the contents of the private key file
     (or its base64), and
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = the password you chose.

5. **Point `endpoints`** at wherever you host `latest.json` and the signed
   artifacts.

> Keep the private key secret and backed up. Losing it means you cannot ship
> updates that existing installs will accept.
