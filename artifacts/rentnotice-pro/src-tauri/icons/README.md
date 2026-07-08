# App Icons

This directory holds the platform icon set that Tauri bundles into the desktop
installers. The icons **are committed** so GitHub Actions release builds work
without any extra setup. They are generated from the single source image
`source-icon.svg` / `source-icon.png` (RentNotice Pro brand: orange #FF3C00
rounded square with a white notice document).

## Regenerate the icon set (after changing the branding)

1. Edit `source-icon.svg`, then re-render the 1024×1024 PNG:

   ```bash
   magick -background none src-tauri/icons/source-icon.svg -resize 1024x1024 src-tauri/icons/source-icon.png
   ```

   (Any SVG-to-PNG tool works; keep the transparent background and ≥1024×1024 size.)

2. From the app package directory (`artifacts/rentnotice-pro`) run:

   ```bash
   pnpm run desktop:icon
   ```

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

   The Tauri CLI also emits `android/` and `ios/` icon folders — delete those,
   they are not used by the desktop app.

4. Commit the regenerated binaries.

## Notes

- Keep the file list in `bundle.icon` in sync if you add or remove icon sizes.
- Do not hand-edit the generated binaries; re-run `pnpm run desktop:icon` to
  update them.
