import { Router, type IRouter } from "express";
import {
  getLatestRelease,
  getAssetRedirectUrl,
  GithubCredentialError,
  type GithubLatestRelease,
} from "../lib/githubReleases";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const ASSET_PATH_PREFIX = "/api/www/downloads/assets/";

/**
 * Resolve per-platform assets from the latest release using the Tauri asset
 * naming conventions:
 *   Windows NSIS  -> *-setup.exe
 *   Windows MSI   -> *.msi
 *   macOS         -> *_aarch64.dmg (Apple Silicon) / *_x64.dmg (Intel)
 */
function resolveDownloadUrls(release: GithubLatestRelease) {
  const find = (pred: (name: string) => boolean) => {
    const asset = release.assets.find((a) => pred(a.name.toLowerCase()));
    return asset ? `${ASSET_PATH_PREFIX}${asset.id}` : null;
  };

  return {
    version: release.tagName,
    windowsExe: find((n) => n.endsWith("-setup.exe") || n.endsWith(".exe")),
    windowsMsi: find((n) => n.endsWith(".msi")),
    macAppleSilicon: find((n) => n.endsWith(".dmg") && n.includes("aarch64")),
    macIntel: find(
      (n) => n.endsWith(".dmg") && (n.includes("x64") || n.includes("x86_64")),
    ),
  };
}

router.get("/www/downloads/latest", async (_req, res) => {
  try {
    const release = await getLatestRelease();
    res.json(resolveDownloadUrls(release));
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
    // Only serve assets that belong to the latest release -- this endpoint is
    // a download proxy for the Download page, not a general GitHub proxy.
    const release = await getLatestRelease();
    if (!release.assets.some((a) => a.id === assetId)) {
      res.status(404).json({
        error: "This download is not part of the latest release.",
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
