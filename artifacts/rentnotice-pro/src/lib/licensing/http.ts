// ---------------------------------------------------------------------------
// Real HTTP adapter to the cloud licensing service (artifacts/api-server).
//
// Contract: docs/desktop-license-api.md
//   POST /api/license/activate — bind this installation to a license key
//   POST /api/license/verify   — re-check status + pull the user directory
//   POST /api/www/auth/login   — verify a directory member's credentials
//
// Every transport-level failure (network error, timeout, 5xx) is mapped to
// LicensingUnavailableError, which callers treat as "offline — keep cached
// state, the grace period applies". All other errors are real failures.
// ---------------------------------------------------------------------------

import {
  activateLicense,
  verifyLicense,
  redeemInvite,
  login,
  changeCloudPassword,
  ApiError,
  setBaseUrl,
  type LicenseInfo,
  type DirectoryUser as ApiDirectoryUser,
} from "@workspace/api-client-react";
import type { LicenseStatus } from "../types";
import {
  CloudCredentialsError,
  InviteCodeInvalidError,
  LicenseInvalidError,
  LicensingUnavailableError,
  type DirectoryUser,
  type LicenseSummary,
  type LicensingClient,
} from "./types";

// Standalone (e.g. packaged desktop) builds point at the hosted API server;
// in the Replit workspace the API artifact is reachable at the same origin.
const configuredBase = import.meta.env.VITE_LICENSE_API_URL as string | undefined;
if (configuredBase) setBaseUrl(configuredBase.replace(/\/api\/?$/, ""));

// ------------------------------ device identity -----------------------------

const DEVICE_ID_KEY = "rentnotice-pro:device-id";

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Stable identifier for this installation, minted once and kept forever. */
export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage unavailable (private mode?) — still send *something* stable-ish.
    return "unknown-device";
  }
}

function deviceName(): string {
  try {
    const platform = navigator?.platform || navigator?.userAgent?.split(" ")[0];
    return platform ? `RentNotice Pro Desktop (${platform})` : "RentNotice Pro Desktop";
  } catch {
    return "RentNotice Pro Desktop";
  }
}

// ------------------------------ wire mapping --------------------------------

function tierLabel(tier: string, seats: number): string {
  const name = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : "Company";
  return seats > 0 ? `${name} (${seats} seats)` : name;
}

function toSummary(info: LicenseInfo): LicenseSummary {
  return {
    companyId: info.company.id,
    companyName: info.company.name,
    plan: tierLabel(info.tier, info.seats),
    status: info.status as LicenseStatus,
    statusReason: info.statusReason || null,
    graceDays: info.graceDays,
  };
}

/**
 * The cloud directory identifies people by email; the desktop app also lets
 * them sign in with a short username. An admin can pick one explicitly on the
 * customer website — that always wins. Anyone without one gets a username
 * derived deterministically from the email local part (collisions get a
 * numeric suffix, ordered by cloud id so the result is stable across syncs).
 */
export function deriveUsernames(users: ApiDirectoryUser[]): Map<string, string> {
  const result = new Map<string, string>();
  const taken = new Set<string>();
  const ordered = [...users].sort((a, b) => a.id.localeCompare(b.id));

  // Pass 1: admin-chosen usernames are reserved first so derived names can
  // never collide with them.
  for (const user of ordered) {
    const explicit = (user.username ?? "").trim().toLowerCase();
    if (explicit && !taken.has(explicit)) {
      taken.add(explicit);
      result.set(user.id, explicit);
    }
  }

  // Pass 2: derive from the email local part for everyone else.
  for (const user of ordered) {
    if (result.has(user.id)) continue;
    const local = (user.email.split("@")[0] ?? "").toLowerCase();
    const base = local.replace(/[^a-z0-9._-]/g, "") || "user";
    let candidate = base;
    let i = 2;
    while (taken.has(candidate)) candidate = `${base}${i++}`;
    taken.add(candidate);
    result.set(user.id, candidate);
  }
  return result;
}

function toDirectoryUsers(users: ApiDirectoryUser[]): DirectoryUser[] {
  const usernames = deriveUsernames(users);
  return users.map((u) => ({
    cloudUserId: u.id,
    name: u.name,
    username: usernames.get(u.id) ?? u.email,
    email: u.email,
    role: u.role,
    active: u.active,
    isMasterAdmin: u.isMasterAdmin,
  }));
}

// ------------------------------- error mapping ------------------------------

function errorCode(err: ApiError): string | null {
  const data = err.data as { code?: unknown } | null;
  return data && typeof data.code === "string" ? data.code : null;
}

function errorMessage(err: ApiError): string | null {
  const data = err.data as { error?: unknown } | null;
  return data && typeof data.error === "string" ? data.error : null;
}

/** Maps a failed licensing call to the domain error the caller expects. */
function mapLicenseError(err: unknown): never {
  if (err instanceof ApiError) {
    if (err.status >= 500) throw new LicensingUnavailableError();
    if (err.status === 404 && errorCode(err) === "unknown_key") throw new LicenseInvalidError();
    throw new Error(errorMessage(err) ?? "The licensing service rejected the request.");
  }
  // fetch TypeError, DNS failure, timeout, unparseable response, …
  throw new LicensingUnavailableError();
}

// ------------------------------ verify cache --------------------------------

// syncLicense() calls checkStatus() and fetchDirectory() back to back; both
// map to POST /license/verify. A tiny TTL cache collapses the pair into one
// network round-trip without ever serving meaningfully stale data.
const VERIFY_CACHE_TTL_MS = 3_000;
let verifyCache: { key: string; info: LicenseInfo; at: number } | null = null;

async function verifyCached(licenseKey: string): Promise<LicenseInfo> {
  const key = licenseKey.trim().toUpperCase();
  if (verifyCache && verifyCache.key === key && Date.now() - verifyCache.at < VERIFY_CACHE_TTL_MS) {
    return verifyCache.info;
  }
  try {
    const info = await verifyLicense({ licenseKey: key, deviceId: getDeviceId() });
    verifyCache = { key, info, at: Date.now() };
    return info;
  } catch (err) {
    mapLicenseError(err);
  }
}

// --------------------------------- client -----------------------------------

export const httpLicensingClient: LicensingClient = {
  /**
   * Called when the user enters a key: attempts the real activation (binding
   * this device). A paused/cancelled key cannot activate (403) — fall back to
   * /license/verify so the caller still gets a summary with the status.
   */
  async validateKey(licenseKey) {
    const key = licenseKey.trim().toUpperCase();
    try {
      const info = await activateLicense({
        licenseKey: key,
        deviceId: getDeviceId(),
        deviceName: deviceName(),
      });
      verifyCache = { key, info, at: Date.now() };
      return toSummary(info);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status === 403 &&
        (errorCode(err) === "license_paused" || errorCode(err) === "license_cancelled")
      ) {
        return toSummary(await verifyCached(key));
      }
      mapLicenseError(err);
    }
  },

  /**
   * The cloud has no per-desktop credentials API; directory members use the
   * same email + password as the customer website. The identifier may be an
   * email or the derived username shown in the app.
   */
  async verifyCredentials(licenseKey, identifier, secret) {
    const info = await verifyCached(licenseKey);
    const needle = identifier.trim().toLowerCase();
    let entry: ApiDirectoryUser | undefined;
    if (needle.includes("@")) {
      entry = info.users.find((u) => u.email.toLowerCase() === needle);
    } else {
      const usernames = deriveUsernames(info.users);
      entry = info.users.find((u) => usernames.get(u.id) === needle);
    }
    if (!entry || !entry.active) throw new CloudCredentialsError();

    try {
      // credentials:"omit" — never store the website session cookie; the
      // desktop only needs the yes/no answer.
      const session = await login(
        { email: entry.email, password: secret },
        { credentials: "omit" },
      );
      if (session.id !== entry.id || session.companyId !== info.company.id) {
        throw new CloudCredentialsError();
      }
    } catch (err) {
      if (err instanceof CloudCredentialsError) throw err;
      if (err instanceof ApiError) {
        if (err.status >= 500) throw new LicensingUnavailableError();
        throw new CloudCredentialsError();
      }
      throw new LicensingUnavailableError();
    }

    const [user] = toDirectoryUsers([entry]);
    // Preserve the collision-suffixed username from the full directory.
    const usernames = deriveUsernames(info.users);
    return { ...user, username: usernames.get(entry.id) ?? user.username };
  },

  async fetchDirectory(licenseKey) {
    const info = await verifyCached(licenseKey);
    return toDirectoryUsers(info.users);
  },

  async checkStatus(licenseKey) {
    return toSummary(await verifyCached(licenseKey));
  },

  /**
   * Redeem a single-use invite code: the server sets the invitee's
   * name/password, consumes the code, and returns the company license
   * context in one round-trip.
   */
  async redeemInvite(input) {
    try {
      const result = await redeemInvite({
        inviteCode: input.inviteCode.trim().toUpperCase(),
        name: input.name,
        password: input.password,
        deviceId: getDeviceId(),
        deviceName: deviceName(),
      });
      const key = result.licenseKey.trim().toUpperCase();
      verifyCache = { key, info: result.license, at: Date.now() };
      const directory = toDirectoryUsers(result.license.users);
      const me = directory.find((u) => u.cloudUserId === result.user.id);
      if (!me) throw new LicensingUnavailableError();
      return {
        licenseKey: key,
        license: toSummary(result.license),
        me,
        directory,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) throw new LicensingUnavailableError();
        if (err.status === 400 && errorCode(err) === "invalid_invite_code") {
          throw new InviteCodeInvalidError();
        }
        throw new Error(errorMessage(err) ?? "The licensing service rejected the request.");
      }
      if (err instanceof LicensingUnavailableError) throw err;
      throw new LicensingUnavailableError();
    }
  },

  /**
   * Change the member's own cloud password. The server verifies the current
   * password before changing anything and revokes existing website sessions.
   */
  async changePassword(licenseKey, email, currentPassword, newPassword) {
    try {
      await changeCloudPassword({
        licenseKey: licenseKey.trim().toUpperCase(),
        email,
        currentPassword,
        newPassword,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status >= 500) throw new LicensingUnavailableError();
        if (err.status === 401) {
          throw new CloudCredentialsError("Current password is incorrect");
        }
        if (err.status === 404 && errorCode(err) === "unknown_key") {
          throw new LicenseInvalidError();
        }
        throw new Error(errorMessage(err) ?? "The licensing service rejected the request.");
      }
      throw new LicensingUnavailableError();
    }
  },
};
