import { Readable, pipeline } from "node:stream";
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

    // ?proxy=1: stream the bytes through this server instead of redirecting.
    // The desktop app's in-app updater fetches from a tauri:// origin where a
    // cross-origin redirect to GitHub's signed URL would be blocked by CORS;
    // this keeps the download same-origin with the relay.
    if (req.query.proxy === "1") {
      const assetName =
        releases
          .flatMap((r) => r.assets)
          .find((a) => a.id === assetId)?.name ?? `download-${assetId}`;
      const upstream = await fetch(signedUrl);
      if (!upstream.ok || !upstream.body) {
        logger.error(
          { assetId, status: upstream.status },
          "GitHub asset fetch failed while proxying download",
        );
        res.status(502).json({
          error: "The download could not be fetched. Please try again.",
          code: "upstream_failed",
        });
        return;
      }
      res.setHeader(
        "Content-Type",
        upstream.headers.get("content-type") ?? "application/octet-stream",
      );
      const len = upstream.headers.get("content-length");
      if (len) res.setHeader("Content-Length", len);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${assetName.replace(/[^\w.\- ]/g, "_")}"`,
      );
      // pipeline (not .pipe) so a mid-stream GitHub abort or client
      // disconnect destroys both sides instead of surfacing an unhandled
      // 'error' event, and cancels the upstream fetch.
      pipeline(
        Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]),
        res,
        (err) => {
          if (err) {
            logger.warn({ err, assetId }, "Installer proxy stream ended early");
          }
        },
      );
      return;
    }

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
