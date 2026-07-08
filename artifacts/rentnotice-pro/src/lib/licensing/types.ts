// ---------------------------------------------------------------------------
// Licensing domain types — the ONLY shapes the rest of the app may depend on.
//
// The cloud licensing service (companies, subscriptions, license keys, user
// directory) is being built separately. Every adapter implementation maps its
// wire format into these domain types so nothing outside src/lib/licensing
// ever sees an HTTP response shape.
// ---------------------------------------------------------------------------

import type { LicenseStatus, UserRole } from "../types";

/** What the licensing service says about a license key. */
export interface LicenseSummary {
  companyId: string;
  companyName: string;
  plan: string | null;
  status: LicenseStatus;
  /** Days the workspace keeps working offline before re-verification is required. */
  graceDays: number;
}

/** A member of the company's cloud user directory. */
export interface DirectoryUser {
  cloudUserId: string;
  name: string;
  username: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  isMasterAdmin: boolean;
}

/** The license key was not recognized (or is revoked beyond recovery). */
export class LicenseInvalidError extends Error {
  constructor(message = "This license key was not recognized.") {
    super(message);
    this.name = "LicenseInvalidError";
  }
}

/** Credentials rejected by the cloud directory. Message is intentionally generic. */
export class CloudCredentialsError extends Error {
  constructor(message = "Invalid username/email or PIN/password") {
    super(message);
    this.name = "CloudCredentialsError";
  }
}

/** The licensing service could not be reached (offline, DNS, outage…). */
export class LicensingUnavailableError extends Error {
  constructor(message = "Could not reach the licensing service. Check your internet connection and try again.") {
    super(message);
    this.name = "LicensingUnavailableError";
  }
}

/**
 * Adapter interface to the cloud licensing service. A deterministic mock ships
 * today (see mock.ts); the real HTTP implementation will be added once the
 * licensing API and its documented contract are published.
 */
export interface LicensingClient {
  /** Check a license key before activation; returns the company it belongs to. */
  validateKey(licenseKey: string): Promise<LicenseSummary>;
  /**
   * Verify a directory member's credentials online. Used at activation and for
   * each user's FIRST sign-in on a device; afterwards a local hash allows
   * offline sign-in. Server password hashes are never sent to devices.
   */
  verifyCredentials(licenseKey: string, identifier: string, secret: string): Promise<DirectoryUser>;
  /** Fetch the company's user directory (names, roles — never secrets). */
  fetchDirectory(licenseKey: string): Promise<DirectoryUser[]>;
  /** Re-check the license status (launch-time re-verification). */
  checkStatus(licenseKey: string): Promise<LicenseSummary>;
}
