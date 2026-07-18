// In-app update checker for the packaged desktop app.
//
// The Tauri auto-updater plugin is intentionally not bundled (see
// BUILDING.md §4), so updates are manual-but-guided: ask the Rust side which
// version/platform this binary is, compare against the release feed the
// marketing site already uses (`/api/www/downloads/latest` on the relay),
// then download the matching installer through the relay's same-origin proxy
// and hand the bytes to a native "Save as…" dialog. The user quits the app
// and runs the installer to finish.

import { tauriInvoke } from "./download";
import { relayUrl } from "./field-sync";

export interface DesktopAppInfo {
  version: string;
  os: string; // "macos" | "windows" | "linux" (std::env::consts::OS)
  arch: string; // "aarch64" | "x86_64" | ...
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  /** Relay asset path for this platform's installer; null when the feed has no matching installer. */
  assetPath: string | null;
  /** Suggested file name for the saved installer. */
  installerName: string | null;
}

interface LatestDownloads {
  version: string;
  windowsExe: string | null;
  windowsMsi: string | null;
  macAppleSilicon: string | null;
  macIntel: string | null;
  /** Set when the Mac installers belong to an older release than `version` (Mac CI trailing). */
  macVersion: string | null;
}

/** True when running inside the packaged desktop app. */
export function isDesktopApp(): boolean {
  return tauriInvoke() !== null;
}

export async function getDesktopAppInfo(): Promise<DesktopAppInfo> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running inside the desktop app.");
  return (await invoke("app_info")) as DesktopAppInfo;
}

function parseVersion(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** True when `latest` is strictly newer than `current` (numeric per-part compare). */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

function pickAsset(info: DesktopAppInfo, latest: LatestDownloads): { path: string | null; ext: string | null } {
  if (info.os === "macos") {
    // While a release's Mac builds are still in CI, the feed falls back to the
    // previous release's DMGs and flags it via `macVersion`. Don't offer that
    // older installer as if it were the update — report "not available yet".
    if (latest.macVersion) return { path: null, ext: null };
    const path = info.arch === "aarch64" ? latest.macAppleSilicon : latest.macIntel;
    return { path, ext: "dmg" };
  }
  if (info.os === "windows") {
    if (latest.windowsExe) return { path: latest.windowsExe, ext: "exe" };
    return { path: latest.windowsMsi, ext: "msi" };
  }
  return { path: null, ext: null };
}

export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const info = await getDesktopAppInfo();
  const res = await fetch(relayUrl("/api/www/downloads/latest"));
  if (!res.ok) {
    throw new Error("The update server is temporarily unavailable. Please try again later.");
  }
  const latest = (await res.json()) as LatestDownloads;
  const latestVersion = (latest.version || "").replace(/^v/i, "");
  if (!latestVersion) {
    throw new Error("The update server returned no release information.");
  }
  const updateAvailable = isNewerVersion(latestVersion, info.version);
  const { path, ext } = pickAsset(info, latest);
  return {
    currentVersion: info.version,
    latestVersion,
    updateAvailable,
    assetPath: updateAvailable ? path : null,
    installerName:
      updateAvailable && path && ext ? `RentNotice-Pro-${latestVersion}-installer.${ext}` : null,
  };
}

export type InstallerSaveResult = { status: "saved"; path: string } | { status: "cancelled" };

/**
 * Download the installer through the relay proxy and show a native
 * "Save as…" dialog. Returns where it was saved, or that the user cancelled.
 */
export async function downloadInstaller(
  assetPath: string,
  installerName: string,
): Promise<InstallerSaveResult> {
  const invoke = tauriInvoke();
  if (!invoke) throw new Error("Not running inside the desktop app.");
  const sep = assetPath.includes("?") ? "&" : "?";
  const res = await fetch(relayUrl(`${assetPath}${sep}proxy=1`));
  if (!res.ok) {
    throw new Error("The installer download failed. Please try again.");
  }
  const bytes = Array.from(new Uint8Array(await res.arrayBuffer()));
  const savedPath = (await invoke("save_installer", {
    fileName: installerName,
    bytes,
  })) as string | null;
  return savedPath ? { status: "saved", path: savedPath } : { status: "cancelled" };
}
