import { Router, type IRouter } from "express";
import {
  getRecentReleases,
  getAssetRedirectUrl,
  GithubCredentialError,
  type GithubRelease,
} from "../lib/githubReleases";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ASSET_PATH_PREFIX = "/api/www/downloads/assets/";

/**
 * Resolve per-platform assets using the Tauri asset naming conventions:
 *   Windows NSIS  -> *-setup.exe
 *   Windows MSI   -> *.msi
 *   macOS         -> *_aarch64.dmg (Apple Silicon) / *_x64.dmg (Intel)
 *
 * Each platform slot falls back to the newest published release that
 * actually contains that installer. This keeps (for example) Mac downloads
 * working while a new release's Mac builds are still in CI -- customers get
 * the previous Mac installer instead of a dead button.
 */
function resolveDownloadUrls(releases: GithubRelease[]) {
  const find = (pred: (name: string) => boolean) => {
    for (const release of releases) {
      const asset = release.assets.find((a) => pred(a.name.toLowerCase()));
      if (asset) {
        return {
          url: `${ASSET_PATH_PREFIX}${asset.id}`,
          version: release.tagName,
        };
      }
    }
    return null;
  };

  const windowsExe = find(
    (n) => n.endsWith("-setup.exe") || n.endsWith(".exe"),
  );
  const windowsMsi = find((n) => n.endsWith(".msi"));
  const macAppleSilicon = find(
    (n) => n.endsWith(".dmg") && n.includes("aarch64"),
  );
  const macIntel = find(
    (n) => n.endsWith(".dmg") && (n.includes("x64") || n.includes("x86_64")),
  );

  // Surface the Mac installers' version when it trails the latest release,
  // so the UI can be honest about what the buttons deliver.
  const latestVersion = releases[0]?.tagName ?? "";
  const macVersions = [macAppleSilicon?.version, macIntel?.version].filter(
    (v): v is string => typeof v === "string" && v !== latestVersion,
  );

  return {
    version: latestVersion,
    windowsExe: windowsExe?.url ?? null,
    windowsMsi: windowsMsi?.url ?? null,
    macAppleSilicon: macAppleSilicon?.url ?? null,
    macIntel: macIntel?.url ?? null,
    macVersion: macVersions[0] ?? null,
  };
}

router.get("/www/downloads/latest", async (_req, res) => {
  try {
    const releases = await getRecentReleases();
    res.json(resolveDownloadUrls(releases));
  } catch (err) {
    logger.error({ err }, "Failed to resolve latest desktop release");
    res.status(503).json({
      error: "Downloads are temporarily unavailable. Please check back soon.",
      code: "downloads_unavailable",
    });
  }
});

router.get("/www/downloads/assets/:assetId", async (req, res) => {
  const assetId = Number(req.params.assetId);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    res.status(404).json({ error: "Unknown download", code: "not_found" });
    return;
  }

  try {
    // Only serve assets that belong to a recent published release -- this
    // endpoint is a download proxy for the Download page, not a general
    // GitHub proxy.
    const releases = await getRecentReleases();
    const known = releases.some((r) => r.assets.some((a) => a.id === assetId));
    if (!known) {
      res.status(404).json({
        error: "This download is not part of a recent release.",
        code: "not_found",
      });
      return;
    }

    const signedUrl = await getAssetRedirectUrl(assetId);
    res.redirect(302, signedUrl);
  } catch (err) {
    if (err instanceof GithubCredentialError) {
      logger.error({ err }, "GitHub credential unavailable for download");
    } else {
      logger.error({ err, assetId }, "Failed to proxy release asset download");
    }
    res.status(503).json({
      error: "Downloads are temporarily unavailable. Please check back soon.",
      code: "downloads_unavailable",
    });
  }
});

export default router;
