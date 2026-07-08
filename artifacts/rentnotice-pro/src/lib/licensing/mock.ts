// ---------------------------------------------------------------------------
// Deterministic mock licensing service — used in development and e2e tests
// until the real licensing API ships. Behaves like a tiny hosted service:
// fixed license keys, one company, a small user directory with credentials.
//
// Test keys (any other key is rejected as invalid):
//   RNP-TEST-ACTIVE      → active license, activation succeeds
//   RNP-TEST-PAUSED      → paused (payment lapsed) — cannot activate
//   RNP-TEST-CANCELLED   → cancelled — cannot activate
//   RNP-TEST-OFFLINE     → simulates an unreachable licensing service
//
// Directory credentials (mock only): arivera/1234 (master admin),
// mlee/2345 (manager), jchen/3456 (staff); emails @goldenstatepm.com.
//
// localStorage overrides for tests:
//   rentnotice-pro:mock-network = "offline"  → every call fails as unreachable
//   rentnotice-pro:mock-status  = "paused" | "cancelled" | "active"
//                                → overrides checkStatus() for valid keys
// ---------------------------------------------------------------------------

import type { LicenseStatus } from "../types";
import {
  CloudCredentialsError,
  LicenseInvalidError,
  LicensingUnavailableError,
  type DirectoryUser,
  type LicenseSummary,
  type LicensingClient,
} from "./types";

const MOCK_LATENCY_MS = 250;

const COMPANY = {
  companyId: "co-goldenstate",
  companyName: "Golden State Property Management, Inc.",
  plan: "Team plan (10 seats)",
  graceDays: 14,
};

const KEY_STATUS: Record<string, LicenseStatus> = {
  "RNP-TEST-ACTIVE": "active",
  "RNP-TEST-PAUSED": "paused",
  "RNP-TEST-CANCELLED": "cancelled",
};

const OFFLINE_KEY = "RNP-TEST-OFFLINE";

interface MockDirectoryEntry extends DirectoryUser {
  secret: string; // mock-only; a real service never returns secrets
}

const DIRECTORY: MockDirectoryEntry[] = [
  {
    cloudUserId: "cu-arivera",
    name: "Alex Rivera",
    username: "arivera",
    email: "arivera@goldenstatepm.com",
    role: "admin",
    active: true,
    isMasterAdmin: true,
    secret: "1234",
  },
  {
    cloudUserId: "cu-mlee",
    name: "Morgan Lee",
    username: "mlee",
    email: "mlee@goldenstatepm.com",
    role: "manager",
    active: true,
    isMasterAdmin: false,
    secret: "2345",
  },
  {
    cloudUserId: "cu-jchen",
    name: "Jamie Chen",
    username: "jchen",
    email: "jchen@goldenstatepm.com",
    role: "staff",
    active: true,
    isMasterAdmin: false,
    secret: "3456",
  },
];

function readOverride(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeKey(licenseKey: string): string {
  return licenseKey.trim().toUpperCase();
}

async function connect(licenseKey?: string): Promise<void> {
  await delay(MOCK_LATENCY_MS);
  if (readOverride("rentnotice-pro:mock-network") === "offline") {
    throw new LicensingUnavailableError();
  }
  if (licenseKey !== undefined && normalizeKey(licenseKey) === OFFLINE_KEY) {
    throw new LicensingUnavailableError();
  }
}

function requireKnownKey(licenseKey: string): LicenseStatus {
  const status = KEY_STATUS[normalizeKey(licenseKey)];
  if (!status) throw new LicenseInvalidError();
  return status;
}

function summary(status: LicenseStatus): LicenseSummary {
  return { ...COMPANY, status };
}

function stripSecret(entry: MockDirectoryEntry): DirectoryUser {
  const { secret: _secret, ...user } = entry;
  return user;
}

export const mockLicensingClient: LicensingClient = {
  async validateKey(licenseKey) {
    await connect(licenseKey);
    return summary(requireKnownKey(licenseKey));
  },

  async verifyCredentials(licenseKey, identifier, secret) {
    await connect(licenseKey);
    requireKnownKey(licenseKey);
    const needle = identifier.trim().toLowerCase();
    const entry = DIRECTORY.find(
      (u) => u.username === needle || (u.email ?? "").toLowerCase() === needle,
    );
    if (!entry || !entry.active || entry.secret !== secret) {
      throw new CloudCredentialsError();
    }
    return stripSecret(entry);
  },

  async fetchDirectory(licenseKey) {
    await connect(licenseKey);
    requireKnownKey(licenseKey);
    return DIRECTORY.map(stripSecret);
  },

  async checkStatus(licenseKey) {
    await connect(licenseKey);
    const base = requireKnownKey(licenseKey);
    const override = readOverride("rentnotice-pro:mock-status");
    const status: LicenseStatus =
      override === "active" || override === "paused" || override === "cancelled"
        ? override
        : base;
    return summary(status);
  },
};
