import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, licenseKeysTable, companiesTable } from "@workspace/db";
import { computeLicenseStatus } from "../lib/license";

/**
 * Buildium Open API proxy for the desktop app.
 *
 * The desktop app cannot call api.buildium.com directly from the browser
 * (CORS), so these routes forward a small, fixed set of read-only GET
 * endpoints. Buildium credentials arrive per-request via headers and are
 * never stored or logged server-side. Every call requires a valid
 * RentNotice Pro license key.
 */
const router: IRouter = Router();

const BUILDIUM_BASE = "https://api.buildium.com/v1";
const UPSTREAM_TIMEOUT_MS = 20_000;

interface BuildiumCreds {
  clientId: string;
  clientSecret: string;
}

async function requireLicense(req: Request, res: Response): Promise<boolean> {
  const key = req.header("x-license-key");
  if (!key || !key.trim()) {
    res.status(401).json({
      error: "Missing license key",
      code: "invalid_license",
    });
    return false;
  }
  const [license] = await db
    .select()
    .from(licenseKeysTable)
    .where(eq(licenseKeysTable.key, key.trim().toUpperCase()));
  if (!license || license.status === "revoked") {
    res.status(401).json({
      error: "Invalid or revoked license key",
      code: "invalid_license",
    });
    return false;
  }
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, license.companyId));
  if (!company) {
    res.status(401).json({
      error: "Invalid or revoked license key",
      code: "invalid_license",
    });
    return false;
  }
  const computed = await computeLicenseStatus(company);
  if (computed.status !== "active") {
    res.status(401).json({
      error: `License is ${computed.status}: ${computed.statusReason}`,
      code: `license_${computed.status}`,
    });
    return false;
  }
  return true;
}

function requireCreds(req: Request, res: Response): BuildiumCreds | null {
  const clientId = req.header("x-buildium-client-id");
  const clientSecret = req.header("x-buildium-client-secret");
  if (!clientId || !clientSecret) {
    res.status(401).json({
      error: "Missing Buildium API credentials",
      code: "missing_credentials",
    });
    return null;
  }
  return { clientId, clientSecret };
}

/** Copy only allow-listed query params (Buildium rejects unknown ones politely, but stay tight). */
function pickQuery(req: Request, allowed: string[]): URLSearchParams {
  const out = new URLSearchParams();
  for (const name of allowed) {
    const value = req.query[name];
    if (value == null) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const v of values) {
      if (typeof v === "string" && v.length > 0) out.append(name, v);
    }
  }
  return out;
}

async function forwardToBuildium(
  res: Response,
  creds: BuildiumCreds,
  path: string,
  query: URLSearchParams,
): Promise<void> {
  const qs = query.toString();
  const url = `${BUILDIUM_BASE}${path}${qs ? `?${qs}` : ""}`;
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      headers: {
        "x-buildium-client-id": creds.clientId,
        "x-buildium-client-secret": creds.clientSecret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    res.status(502).json({
      error: "Could not reach the Buildium API. Try again in a moment.",
      code: "buildium_unreachable",
      buildiumStatus: null,
    });
    return;
  }

  if (upstream.status === 401 || upstream.status === 403) {
    res.status(401).json({
      error:
        "Buildium rejected these API credentials. Check the client id and secret, and make sure the key has read access to Rentals and Leases.",
      code: "buildium_auth",
      buildiumStatus: upstream.status,
    });
    return;
  }
  if (upstream.status === 429) {
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) res.setHeader("retry-after", retryAfter);
    res.status(429).json({
      error: "Buildium rate limit reached. Retrying shortly.",
      code: "buildium_rate_limited",
      buildiumStatus: 429,
    });
    return;
  }
  if (!upstream.ok) {
    res.status(502).json({
      error: `Buildium returned an unexpected error (HTTP ${upstream.status}).`,
      code: "buildium_error",
      buildiumStatus: upstream.status,
    });
    return;
  }

  let body: unknown;
  try {
    body = await upstream.json();
  } catch {
    res.status(502).json({
      error: "Buildium returned a response that could not be parsed.",
      code: "buildium_error",
      buildiumStatus: upstream.status,
    });
    return;
  }
  const totalCount = upstream.headers.get("x-total-count");
  if (totalCount) res.setHeader("x-total-count", totalCount);
  res.json(body);
}

router.get("/buildium/ping", async (req, res, next) => {
  try {
    if (!(await requireLicense(req, res))) return;
    const creds = requireCreds(req, res);
    if (!creds) return;

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${BUILDIUM_BASE}/rentals?limit=1`, {
        headers: {
          "x-buildium-client-id": creds.clientId,
          "x-buildium-client-secret": creds.clientSecret,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      res.status(502).json({
        error: "Could not reach the Buildium API. Try again in a moment.",
        code: "buildium_unreachable",
        buildiumStatus: null,
      });
      return;
    }
    if (upstream.status === 401 || upstream.status === 403) {
      res.status(401).json({
        error:
          "Buildium rejected these API credentials. Check the client id and secret, and make sure the key has read access to Rentals and Leases.",
        code: "buildium_auth",
        buildiumStatus: upstream.status,
      });
      return;
    }
    if (!upstream.ok) {
      res.status(502).json({
        error: `Buildium returned an unexpected error (HTTP ${upstream.status}).`,
        code: "buildium_error",
        buildiumStatus: upstream.status,
      });
      return;
    }
    const totalHeader = upstream.headers.get("x-total-count");
    const propertyCount = totalHeader ? Number(totalHeader) : null;
    res.json({
      ok: true,
      propertyCount: Number.isFinite(propertyCount as number)
        ? propertyCount
        : null,
    });
  } catch (err) {
    next(err);
  }
});

router.get("/buildium/rentals", async (req, res, next) => {
  try {
    if (!(await requireLicense(req, res))) return;
    const creds = requireCreds(req, res);
    if (!creds) return;
    await forwardToBuildium(
      res,
      creds,
      "/rentals",
      pickQuery(req, ["limit", "offset"]),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/buildium/units", async (req, res, next) => {
  try {
    if (!(await requireLicense(req, res))) return;
    const creds = requireCreds(req, res);
    if (!creds) return;
    await forwardToBuildium(
      res,
      creds,
      "/rentals/units",
      pickQuery(req, ["limit", "offset", "propertyids"]),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/buildium/leases", async (req, res, next) => {
  try {
    if (!(await requireLicense(req, res))) return;
    const creds = requireCreds(req, res);
    if (!creds) return;
    await forwardToBuildium(
      res,
      creds,
      "/leases",
      pickQuery(req, ["limit", "offset", "leasestatuses", "propertyids"]),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/buildium/leases/outstandingbalances", async (req, res, next) => {
  try {
    if (!(await requireLicense(req, res))) return;
    const creds = requireCreds(req, res);
    if (!creds) return;
    await forwardToBuildium(
      res,
      creds,
      "/leases/outstandingbalances",
      pickQuery(req, ["limit", "offset"]),
    );
  } catch (err) {
    next(err);
  }
});

router.get("/buildium/leases/:leaseId/transactions", async (req, res, next) => {
  try {
    if (!(await requireLicense(req, res))) return;
    const creds = requireCreds(req, res);
    if (!creds) return;
    const leaseId = Number(req.params.leaseId);
    if (!Number.isInteger(leaseId) || leaseId <= 0) {
      res.status(400).json({
        error: "Invalid lease id",
        code: "buildium_error",
        buildiumStatus: null,
      });
      return;
    }
    await forwardToBuildium(
      res,
      creds,
      `/leases/${leaseId}/transactions`,
      pickQuery(req, ["limit", "offset"]),
    );
  } catch (err) {
    next(err);
  }
});

export default router;
