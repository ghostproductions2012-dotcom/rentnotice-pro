# App Icons

This directory holds the platform icon set that Tauri bundles into the desktop
installers. **The binary icon files are intentionally _not_ committed here** —
they are generated from a single source image with the Tauri CLI.

## Generate the icon set

1. Create a square source image (PNG, transparent background, **at least
   1024×1024 px**). Name it something like `source-icon.png` and keep it out of
   version control, or store it under `src-tauri/icons/source-icon.png`.

2. From the app package directory (`artifacts/rentnotice-pro`) run:

   ```bash
   pnpm tauri icon ./src-tauri/icons/source-icon.png
   ```

   (or, if you have the CLI installed globally, `tauri icon ./src-tauri/icons/source-icon.png`)

3. This regenerates every file referenced by `bundle.icon` in
   `src-tauri/tauri.conf.json`, including:

   | File                 | Used by                     |
   | -------------------- | --------------------------- |
   | `32x32.png`          | Linux / general             |
   | `128x128.png`        | Linux / general             |
   | `128x128@2x.png`     | Linux / general (HiDPI)     |
   | `icon.icns`          | macOS `.dmg`                |
   | `icon.ico`           | Windows `.msi` / `.nsis`    |
   | `Square*Logo*.png`   | Windows Store / tiles       |

## Notes

- Keep the file list in `bundle.icon` in sync if you add or remove icon sizes.
- `tauri build` will fail until this icon set exists, so run `tauri icon` once
  before your first desktop build.
- Do not hand-edit the generated binaries; re-run `tauri icon` to update them.
