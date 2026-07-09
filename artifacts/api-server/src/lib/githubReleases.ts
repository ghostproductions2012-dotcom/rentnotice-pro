import { logger } from "./logger";

/**
 * Where the desktop installers live. This is the ONLY place to update if the
 * GitHub repository ever moves.
 */
export const GITHUB_REPO = "ghostproductions2012-dotcom/rentnotice-pro";

/** Thrown when no GitHub credential is available (routes turn this into a 503). */
export class GithubCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GithubCredentialError";
  }
}

/**
 * Resolves a GitHub API token. Prefers a GITHUB_TOKEN secret; falls back to
 * the Replit GitHub connector. Not cached -- connector tokens can rotate,
 * so fetch fresh each time.
 */
async function getGithubToken(): Promise<string> {
  const envToken = process.env.GITHUB_TOKEN;
  if (envToken) {
    return envToken;
  }

  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? "repl " + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
      ? "depl " + process.env.WEB_REPL_RENEWAL
      : null;

  if (!hostname || !xReplitToken) {
    throw new GithubCredentialError(
      "No GitHub credential available. Set a GITHUB_TOKEN secret or connect " +
        "the GitHub integration via the Integrations tab.",
    );
  }

  const resp = await fetch(
    `https://${hostname}/api/v2/connection?include_secrets=true&connector_names=github`,
    {
      headers: { Accept: "application/json", X_REPLIT_TOKEN: xReplitToken },
      signal: AbortSignal.timeout(10_000),
    },
  );

  if (!resp.ok) {
    throw new GithubCredentialError(
      `Failed to fetch GitHub credentials: ${resp.status} ${resp.statusText}`,
    );
  }

  const data = (await resp.json()) as {
    items?: Array<{
      settings?: {
        access_token?: string;
        oauth?: { credentials?: { access_token?: string } };
      };
    }>;
  };
  const settings = data.items?.[0]?.settings;
  const accessToken =
    settings?.access_token ?? settings?.oauth?.credentials?.access_token;

  if (!accessToken) {
    throw new GithubCredentialError(
      "GitHub integration not connected or missing access token. Set a " +
        "GITHUB_TOKEN secret or connect GitHub via the Integrations tab.",
    );
  }

  return accessToken;
}

export interface GithubReleaseAsset {
  id: number;
  name: string;
  size: number;
}

export interface GithubLatestRelease {
  tagName: string;
  assets: GithubReleaseAsset[];
}

// Cache the latest-release lookup for a few minutes to stay well under
// GitHub API rate limits (the Download page is public).
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedRelease: { release: GithubLatestRelease; fetchedAt: number } | null =
  null;

/**
 * Fetches the latest published GitHub release (authenticated, works for
 * private repos). Results are cached in memory for 5 minutes.
 */
export async function getLatestRelease(): Promise<GithubLatestRelease> {
  if (cachedRelease && Date.now() - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease.release;
  }

  const token = await getGithubToken();
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!resp.ok) {
    // Serve a stale cache rather than failing if GitHub is having a moment.
    if (cachedRelease) {
      logger.warn(
        { status: resp.status },
        "GitHub latest-release lookup failed; serving stale cache",
      );
      return cachedRelease.release;
    }
    throw new Error(`GitHub API returned ${resp.status} for latest release`);
  }

  const body = (await resp.json()) as {
    tag_name?: string;
    assets?: Array<{ id?: number; name?: string; size?: number }>;
  };

  const release: GithubLatestRelease = {
    tagName: body.tag_name ?? "",
    assets: (body.assets ?? [])
      .filter((a) => typeof a.id === "number" && typeof a.name === "string")
      .map((a) => ({ id: a.id!, name: a.name!, size: a.size ?? 0 })),
  };

  cachedRelease = { release, fetchedAt: Date.now() };
  return release;
}

/**
 * Resolves the short-lived signed download URL for a release asset by id.
 * Private-repo browser_download_url links do not work unauthenticated --
 * assets must be fetched by id with Accept: application/octet-stream, and
 * GitHub responds with a 302 to a signed CDN URL.
 */
export async function getAssetRedirectUrl(assetId: number): Promise<string> {
  const token = await getGithubToken();
  const resp = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${assetId}`,
    {
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    },
  );

  const location = resp.headers.get("location");
  if ((resp.status === 302 || resp.status === 307) && location) {
    return location;
  }

  throw new Error(
    `GitHub asset download returned ${resp.status} without a redirect`,
  );
}
