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
  /** Human-readable explanation of the current status, straight from the service. */
  statusReason: string | null;
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

/** The invite code was not recognized or has already been used. */
export class InviteCodeInvalidError extends Error {
  constructor(message = "This invite code is invalid or has already been used.") {
    super(message);
    this.name = "InviteCodeInvalidError";
  }
}

/** Credentials rejected by the cloud directory. Message is intentionally generic. */
export class CloudCredentialsError extends Error {
  constructor(message = "Invalid email or password") {
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

/** Input for redeeming a single-use team invite code from the desktop app. */
export interface RedeemInviteInput {
  inviteCode: string;
  /** Full name the invitee chooses for their account. */
  name: string;
  /** Password the invitee sets (also their customer-website password). */
  password: string;
}

/** Everything the app needs to provision a workspace after redeeming an invite. */
export interface InviteRedemption {
  /** The company license key this device is now bound to (for later verify/sync). */
  licenseKey: string;
  license: LicenseSummary;
  /** The freshly set-up account of the invitee. */
  me: DirectoryUser;
  /** The full company directory, including the invitee. */
  directory: DirectoryUser[];
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
  /**
   * Redeem a single-use invite code: sets the invitee's name/password in the
   * cloud directory and returns everything needed to provision this device.
   * Throws InviteCodeInvalidError for unknown/used codes.
   */
  redeemInvite(input: RedeemInviteInput): Promise<InviteRedemption>;
  /**
   * Change a directory member's own password (also their customer-website
   * password). The service verifies the current password before changing
   * anything. Throws CloudCredentialsError when the current password is
   * rejected and LicensingUnavailableError when the service is unreachable.
   */
  changePassword(
    licenseKey: string,
    email: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void>;
}
