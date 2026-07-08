// ---------------------------------------------------------------------------
// Licensing client selector.
//
// The real HTTP adapter (http.ts) talks to the cloud licensing API and is the
// default everywhere. The deterministic mock remains available for automated
// tests, but only in development builds and only when explicitly requested —
// shipping a way to force it in production would be a built-in license bypass.
//
//   localStorage["rentnotice-pro:licensing"] = "mock"   (dev builds only)
// ---------------------------------------------------------------------------

import { mockLicensingClient } from "./mock";
import { httpLicensingClient } from "./http";
import type { LicensingClient } from "./types";

// The HTTP adapter maps every transport-level failure (fetch TypeError,
// timeout, 5xx, DNS) to LicensingUnavailableError. Callers treat that error
// as "offline — keep cached state / grace period applies"; any other error
// is surfaced as a real failure (e.g. invalid credentials).
export function getLicensingClient(): LicensingClient {
  if (import.meta.env.DEV) {
    try {
      if (localStorage.getItem("rentnotice-pro:licensing") === "mock") {
        return mockLicensingClient;
      }
    } catch {
      // localStorage unavailable — fall through to the real client.
    }
  }
  return httpLicensingClient;
}

export * from "./types";
