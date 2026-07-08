// Where the desktop installers live. This is the ONLY place to update if the
// GitHub repository ever moves.
export const GITHUB_REPO = "ghostproductions2012-dotcom/rentnotice-pro";

export const RELEASES_LATEST_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;
export const RELEASES_API_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

export interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface LatestRelease {
  tag_name: string;
  html_url: string;
  assets: ReleaseAsset[];
}

export interface DownloadLinks {
  version: string | null;
  windowsExe: string | null;
  windowsMsi: string | null;
  macAppleSilicon: string | null;
  macIntel: string | null;
}

/**
 * Resolve direct download links from the latest published GitHub release.
 * Tauri asset naming conventions:
 *   Windows NSIS  → *-setup.exe
 *   Windows MSI   → *.msi
 *   macOS         → *_aarch64.dmg (Apple Silicon) / *_x64.dmg (Intel)
 */
export function resolveDownloadLinks(release: LatestRelease): DownloadLinks {
  const find = (pred: (name: string) => boolean) =>
    release.assets.find((a) => pred(a.name.toLowerCase()))?.browser_download_url ?? null;

  return {
    version: release.tag_name ?? null,
    windowsExe: find((n) => n.endsWith("-setup.exe") || n.endsWith(".exe")),
    windowsMsi: find((n) => n.endsWith(".msi")),
    macAppleSilicon: find((n) => n.endsWith(".dmg") && n.includes("aarch64")),
    macIntel: find((n) => n.endsWith(".dmg") && (n.includes("x64") || n.includes("x86_64"))),
  };
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(RELEASES_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
  return (await res.json()) as LatestRelease;
}
