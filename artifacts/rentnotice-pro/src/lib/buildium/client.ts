// ---------------------------------------------------------------------------
// Thin wrapper around the api-server's Buildium proxy endpoints.
//
// The proxy (artifacts/api-server /api/buildium/*) forwards requests to the
// Buildium Open API. Credentials are supplied per-request via headers and are
// never stored server-side — the desktop keeps them in the local settings
// table only. All calls require an activated workspace (license key).
// ---------------------------------------------------------------------------

import {
  buildiumPing,
  buildiumListRentals,
  buildiumListUnits,
  buildiumListLeases,
  buildiumListOutstandingBalances,
  buildiumListLeaseTransactions,
  ApiError,
  type BuildiumPingResult,
  type BuildiumRecord,
  type BuildiumListRentalsParams,
  type BuildiumListUnitsParams,
  type BuildiumListLeasesParams,
  type BuildiumListOutstandingBalancesParams,
  type BuildiumListLeaseTransactionsParams,
} from "@workspace/api-client-react";

export interface BuildiumCredentials {
  licenseKey: string;
  clientId: string;
  clientSecret: string;
}

/** Error with a message that is safe/useful to show in the UI. */
export class BuildiumClientError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "BuildiumClientError";
    this.code = code;
  }
}

function headers(creds: BuildiumCredentials): RequestInit {
  return {
    headers: {
      "x-license-key": creds.licenseKey.trim().toUpperCase(),
      "x-buildium-client-id": creds.clientId.trim(),
      "x-buildium-client-secret": creds.clientSecret.trim(),
    },
  };
}

/** Maps proxy/transport failures to a BuildiumClientError with a friendly message. */
function mapError(err: unknown): never {
  if (err instanceof BuildiumClientError) throw err;
  if (err instanceof ApiError) {
    const data = err.data as { error?: unknown; code?: unknown } | null;
    const code = data && typeof data.code === "string" ? data.code : "buildium_error";
    const message =
      data && typeof data.error === "string"
        ? data.error
        : "The Buildium connection failed. Please try again.";
    throw new BuildiumClientError(message, code);
  }
  throw new BuildiumClientError(
    "Could not reach the connection service. Check your internet connection and try again.",
    "network",
  );
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    mapError(err);
  }
}

/** Verifies credentials with a minimal round-trip to Buildium. */
export function pingBuildium(creds: BuildiumCredentials): Promise<BuildiumPingResult> {
  return call(() => buildiumPing(headers(creds)));
}

export function listRentals(
  creds: BuildiumCredentials,
  params?: BuildiumListRentalsParams,
): Promise<BuildiumRecord[]> {
  return call(() => buildiumListRentals(params, headers(creds)));
}

export function listUnits(
  creds: BuildiumCredentials,
  params?: BuildiumListUnitsParams,
): Promise<BuildiumRecord[]> {
  return call(() => buildiumListUnits(params, headers(creds)));
}

export function listLeases(
  creds: BuildiumCredentials,
  params?: BuildiumListLeasesParams,
): Promise<BuildiumRecord[]> {
  return call(() => buildiumListLeases(params, headers(creds)));
}

export function listOutstandingBalances(
  creds: BuildiumCredentials,
  params?: BuildiumListOutstandingBalancesParams,
): Promise<BuildiumRecord[]> {
  return call(() => buildiumListOutstandingBalances(params, headers(creds)));
}

export function listLeaseTransactions(
  creds: BuildiumCredentials,
  leaseId: number,
  params?: BuildiumListLeaseTransactionsParams,
): Promise<BuildiumRecord[]> {
  return call(() => buildiumListLeaseTransactions(leaseId, params, headers(creds)));
}

/**
 * Fetches every page of a paged endpoint. Buildium caps page size at 1000;
 * we use a smaller default page to keep each request quick.
 */
export async function fetchAllPages(
  fetchPage: (limit: number, offset: number) => Promise<BuildiumRecord[]>,
  pageSize = 200,
  maxRecords = 10_000,
): Promise<BuildiumRecord[]> {
  const all: BuildiumRecord[] = [];
  for (let offset = 0; offset < maxRecords; offset += pageSize) {
    const page = await fetchPage(pageSize, offset);
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}
