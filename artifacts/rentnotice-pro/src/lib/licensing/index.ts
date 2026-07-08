// ---------------------------------------------------------------------------
// Licensing client selector.
//
// Development (and e2e) use the deterministic mock. The real HTTP client will
// be registered here once the cloud licensing API and its documented contract
// are available; until then, production builds report the service as not yet
// configured instead of silently pretending to activate.
// ---------------------------------------------------------------------------

import { mockLicensingClient } from "./mock";
import { LicensingUnavailableError, type LicensingClient } from "./types";

// NOTE for the future HTTP adapter: it MUST map every transport-level failure
// (fetch TypeError, timeout, 5xx, DNS) to LicensingUnavailableError. Callers
// treat that error as "offline — keep cached state / grace period applies";
// any other error is surfaced as a real failure (e.g. invalid credentials).
export function getLicensingClient(): LicensingClient {
  // The mock is strictly dev-only: shipping a way to force it in production
  // builds would be a built-in license bypass.
  if (import.meta.env.DEV) return mockLicensingClient;
  throw new LicensingUnavailableError(
    "The licensing service is not available in this build yet. Please update the app.",
  );
}

export * from "./types";
