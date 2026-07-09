import { beforeEach, describe, expect, it, vi } from "vitest";

const { activateLicense, verifyLicense, login, redeemInvite, changeCloudPassword } = vi.hoisted(
  () => ({
    activateLicense: vi.fn(),
    verifyLicense: vi.fn(),
    login: vi.fn(),
    redeemInvite: vi.fn(),
    changeCloudPassword: vi.fn(),
  }),
);

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return { ...actual, activateLicense, verifyLicense, login, redeemInvite, changeCloudPassword };
});

import { ApiError, type LicenseInfo } from "@workspace/api-client-react";
import { deriveUsernames, httpLicensingClient } from "../http";
import {
  CloudCredentialsError,
  InviteCodeInvalidError,
  LicenseInvalidError,
  LicensingUnavailableError,
} from "../types";

function apiError(status: number, body: Record<string, unknown>): ApiError {
  const response = new Response(JSON.stringify(body), {
    status,
    statusText: String(status),
  });
  return new ApiError(response, body, { method: "POST", url: "/api/license/activate" });
}

const INFO: LicenseInfo = {
  status: "active",
  statusReason: "Subscription in good standing",
  company: { id: "co-1", name: "Acme Property Mgmt" },
  tier: "professional",
  seats: 10,
  paidThrough: "2026-08-01T00:00:00.000Z",
  users: [
    {
      id: "u-1",
      email: "Jane.Doe@acme.test",
      name: "Jane Doe",
      role: "admin",
      active: true,
      isMasterAdmin: true,
    },
    {
      id: "u-2",
      email: "jane.doe@other.test",
      name: "Jane D. Other",
      role: "staff",
      active: true,
      isMasterAdmin: false,
    },
    {
      id: "u-3",
      email: "bob@acme.test",
      name: "Bob",
      role: "readonly",
      active: false,
      isMasterAdmin: false,
    },
  ],
  graceDays: 14,
  verifiedAt: "2026-07-08T00:00:00.000Z",
};

beforeEach(() => {
  vi.resetAllMocks();
  // Bust the module-level verify cache by using a different key per test where
  // it matters; simplest is unique keys via this counter.
});

let keyCounter = 0;
function freshKey(): string {
  return `RNP-TEST-${String(keyCounter++).padStart(4, "0")}-AAAA-BBBB`;
}

describe("deriveUsernames", () => {
  it("derives lowercase usernames from email local parts, suffixing collisions deterministically", () => {
    const names = deriveUsernames(INFO.users);
    expect(names.get("u-1")).toBe("jane.doe");
    expect(names.get("u-2")).toBe("jane.doe2");
    expect(names.get("u-3")).toBe("bob");
  });

  it("prefers an admin-chosen username over derivation", () => {
    const users = INFO.users.map((u) =>
      u.id === "u-2" ? { ...u, username: "janed" } : u,
    );
    const names = deriveUsernames(users);
    expect(names.get("u-1")).toBe("jane.doe");
    expect(names.get("u-2")).toBe("janed");
    expect(names.get("u-3")).toBe("bob");
  });

  it("never derives a username that collides with an admin-chosen one", () => {
    // u-2 explicitly claims "jane.doe"; u-1 would derive the same name and
    // must be suffixed instead, regardless of id ordering.
    const users = INFO.users.map((u) =>
      u.id === "u-2" ? { ...u, username: "jane.doe" } : u,
    );
    const names = deriveUsernames(users);
    expect(names.get("u-2")).toBe("jane.doe");
    expect(names.get("u-1")).toBe("jane.doe2");
  });

  it("normalizes explicit usernames and falls back to derivation on duplicates", () => {
    const users = INFO.users.map((u) => {
      if (u.id === "u-1") return { ...u, username: "  SHARED " };
      if (u.id === "u-2") return { ...u, username: "shared" };
      return u;
    });
    const names = deriveUsernames(users);
    // u-1 sorts first, wins the explicit name (trimmed + lowercased).
    expect(names.get("u-1")).toBe("shared");
    // u-2's duplicate explicit name is ignored; it derives from its email.
    expect(names.get("u-2")).toBe("jane.doe");
  });
});

describe("validateKey", () => {
  it("activates and maps the license summary", async () => {
    activateLicense.mockResolvedValue(INFO);
    const key = freshKey();
    const summary = await httpLicensingClient.validateKey(key);
    expect(summary).toEqual({
      companyId: "co-1",
      companyName: "Acme Property Mgmt",
      plan: "Professional (10 seats)",
      status: "active",
      statusReason: "Subscription in good standing",
      graceDays: 14,
    });
    expect(activateLicense).toHaveBeenCalledWith(
      expect.objectContaining({ licenseKey: key, deviceId: expect.any(String) }),
    );
  });

  it("uppercases and trims the key before sending", async () => {
    activateLicense.mockResolvedValue(INFO);
    await httpLicensingClient.validateKey("  rnp-lower-case-key-aaaa  ");
    expect(activateLicense).toHaveBeenCalledWith(
      expect.objectContaining({ licenseKey: "RNP-LOWER-CASE-KEY-AAAA" }),
    );
  });

  it("maps unknown_key 404 to LicenseInvalidError", async () => {
    activateLicense.mockRejectedValue(
      apiError(404, { error: "Unknown license key", code: "unknown_key" }),
    );
    await expect(httpLicensingClient.validateKey(freshKey())).rejects.toBeInstanceOf(
      LicenseInvalidError,
    );
  });

  it("falls back to verify when activation is refused for a paused license", async () => {
    activateLicense.mockRejectedValue(
      apiError(403, { error: "License is paused", code: "license_paused" }),
    );
    verifyLicense.mockResolvedValue({
      ...INFO,
      status: "paused",
      statusReason: "Payment failed",
    });
    const summary = await httpLicensingClient.validateKey(freshKey());
    expect(summary.status).toBe("paused");
    expect(summary.statusReason).toBe("Payment failed");
  });

  it("maps network failures to LicensingUnavailableError", async () => {
    activateLicense.mockRejectedValue(new TypeError("fetch failed"));
    await expect(httpLicensingClient.validateKey(freshKey())).rejects.toBeInstanceOf(
      LicensingUnavailableError,
    );
  });

  it("maps 5xx to LicensingUnavailableError", async () => {
    activateLicense.mockRejectedValue(apiError(503, { error: "down" }));
    await expect(httpLicensingClient.validateKey(freshKey())).rejects.toBeInstanceOf(
      LicensingUnavailableError,
    );
  });
});

describe("checkStatus / fetchDirectory", () => {
  it("shares one verify round-trip via the short-lived cache", async () => {
    verifyLicense.mockResolvedValue(INFO);
    const key = freshKey();
    const status = await httpLicensingClient.checkStatus(key);
    const directory = await httpLicensingClient.fetchDirectory(key);
    expect(status.status).toBe("active");
    expect(directory).toHaveLength(3);
    expect(directory[0]).toEqual({
      cloudUserId: "u-1",
      name: "Jane Doe",
      username: "jane.doe",
      email: "Jane.Doe@acme.test",
      role: "admin",
      active: true,
      isMasterAdmin: true,
    });
    expect(verifyLicense).toHaveBeenCalledTimes(1);
  });

  it("maps unknown_key on verify to LicenseInvalidError", async () => {
    verifyLicense.mockRejectedValue(apiError(404, { error: "nope", code: "unknown_key" }));
    await expect(httpLicensingClient.checkStatus(freshKey())).rejects.toBeInstanceOf(
      LicenseInvalidError,
    );
  });
});

describe("verifyCredentials", () => {
  it("logs in with the resolved email and returns the directory user", async () => {
    verifyLicense.mockResolvedValue(INFO);
    login.mockResolvedValue({
      id: "u-1",
      email: "jane.doe@acme.test",
      name: "Jane Doe",
      role: "admin",
      isMasterAdmin: true,
      companyId: "co-1",
      companyName: "Acme Property Mgmt",
    });
    const user = await httpLicensingClient.verifyCredentials(freshKey(), "jane.doe", "pw12345678");
    expect(login).toHaveBeenCalledWith(
      { email: "Jane.Doe@acme.test", password: "pw12345678" },
      { credentials: "omit" },
    );
    expect(user.cloudUserId).toBe("u-1");
    expect(user.username).toBe("jane.doe");
  });

  it("signs in with an admin-chosen username from the directory", async () => {
    verifyLicense.mockResolvedValue({
      ...INFO,
      users: INFO.users.map((u) =>
        u.id === "u-1" ? { ...u, username: "janed" } : u,
      ),
    });
    login.mockResolvedValue({
      id: "u-1",
      email: "jane.doe@acme.test",
      name: "Jane Doe",
      role: "admin",
      isMasterAdmin: true,
      companyId: "co-1",
      companyName: "Acme Property Mgmt",
    });
    const user = await httpLicensingClient.verifyCredentials(freshKey(), "janed", "pw12345678");
    expect(login).toHaveBeenCalledWith(
      { email: "Jane.Doe@acme.test", password: "pw12345678" },
      { credentials: "omit" },
    );
    expect(user.cloudUserId).toBe("u-1");
    expect(user.username).toBe("janed");
  });

  it("accepts an email identifier case-insensitively", async () => {
    verifyLicense.mockResolvedValue(INFO);
    login.mockResolvedValue({
      id: "u-1",
      email: "jane.doe@acme.test",
      name: "Jane Doe",
      role: "admin",
      isMasterAdmin: true,
      companyId: "co-1",
      companyName: "Acme Property Mgmt",
    });
    const user = await httpLicensingClient.verifyCredentials(
      freshKey(),
      "JANE.DOE@ACME.TEST",
      "pw12345678",
    );
    expect(user.cloudUserId).toBe("u-1");
  });

  it("rejects unknown identifiers without calling login", async () => {
    verifyLicense.mockResolvedValue(INFO);
    await expect(
      httpLicensingClient.verifyCredentials(freshKey(), "nobody", "pw12345678"),
    ).rejects.toBeInstanceOf(CloudCredentialsError);
    expect(login).not.toHaveBeenCalled();
  });

  it("rejects inactive directory members without calling login", async () => {
    verifyLicense.mockResolvedValue(INFO);
    await expect(
      httpLicensingClient.verifyCredentials(freshKey(), "bob", "pw12345678"),
    ).rejects.toBeInstanceOf(CloudCredentialsError);
    expect(login).not.toHaveBeenCalled();
  });

  it("maps 401 from login to CloudCredentialsError", async () => {
    verifyLicense.mockResolvedValue(INFO);
    login.mockRejectedValue(apiError(401, { error: "Invalid email or password" }));
    await expect(
      httpLicensingClient.verifyCredentials(freshKey(), "jane.doe", "wrong"),
    ).rejects.toBeInstanceOf(CloudCredentialsError);
  });

  it("rejects when the session does not match the directory entry", async () => {
    verifyLicense.mockResolvedValue(INFO);
    login.mockResolvedValue({
      id: "someone-else",
      email: "jane.doe@acme.test",
      name: "Jane Doe",
      role: "admin",
      isMasterAdmin: true,
      companyId: "co-other",
      companyName: "Other Co",
    });
    await expect(
      httpLicensingClient.verifyCredentials(freshKey(), "jane.doe", "pw12345678"),
    ).rejects.toBeInstanceOf(CloudCredentialsError);
  });

  it("maps login transport failures to LicensingUnavailableError", async () => {
    verifyLicense.mockResolvedValue(INFO);
    login.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      httpLicensingClient.verifyCredentials(freshKey(), "jane.doe", "pw12345678"),
    ).rejects.toBeInstanceOf(LicensingUnavailableError);
  });
});

describe("redeemInvite", () => {
  const INVITED_INFO: LicenseInfo = {
    ...INFO,
    users: [
      ...INFO.users,
      {
        id: "u-4",
        email: "newbie@acme.test",
        name: "New Bee",
        role: "staff",
        active: true,
        isMasterAdmin: false,
      },
    ],
  };

  it("normalizes the code, returns the redemption context, and warms the verify cache", async () => {
    redeemInvite.mockResolvedValue({
      licenseKey: freshKey(),
      license: INVITED_INFO,
      user: { id: "u-4", email: "newbie@acme.test", name: "New Bee", role: "staff" },
    });
    const result = await httpLicensingClient.redeemInvite({
      inviteCode: "  inv-abcd-1234 ",
      name: "New Bee",
      password: "pw12345678",
    });
    expect(redeemInvite).toHaveBeenCalledWith(
      expect.objectContaining({ inviteCode: "INV-ABCD-1234", name: "New Bee" }),
    );
    expect(result.me.cloudUserId).toBe("u-4");
    expect(result.me.username).toBe("newbie");
    expect(result.directory).toHaveLength(4);
    expect(result.license.status).toBe("active");
    // The verify cache is warmed: checkStatus must not hit the network again.
    verifyLicense.mockRejectedValue(new TypeError("fetch failed"));
    const status = await httpLicensingClient.checkStatus(result.licenseKey);
    expect(status.status).toBe("active");
    expect(verifyLicense).not.toHaveBeenCalled();
  });

  it("maps invalid_invite_code to InviteCodeInvalidError", async () => {
    redeemInvite.mockRejectedValue(
      apiError(400, { error: "Invalid invite code", code: "invalid_invite_code" }),
    );
    await expect(
      httpLicensingClient.redeemInvite({
        inviteCode: "INV-NOPE-NOPE",
        name: "X",
        password: "pw12345678",
      }),
    ).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });

  it("surfaces license-state refusals as plain errors with the server message", async () => {
    redeemInvite.mockRejectedValue(
      apiError(403, { error: "License is paused", code: "license_paused" }),
    );
    await expect(
      httpLicensingClient.redeemInvite({
        inviteCode: "INV-ABCD-1234",
        name: "X",
        password: "pw12345678",
      }),
    ).rejects.toThrow("License is paused");
  });

  it("maps transport failures and 5xx to LicensingUnavailableError", async () => {
    redeemInvite.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      httpLicensingClient.redeemInvite({
        inviteCode: "INV-ABCD-1234",
        name: "X",
        password: "pw12345678",
      }),
    ).rejects.toBeInstanceOf(LicensingUnavailableError);

    redeemInvite.mockRejectedValue(apiError(500, { error: "boom" }));
    await expect(
      httpLicensingClient.redeemInvite({
        inviteCode: "INV-ABCD-1234",
        name: "X",
        password: "pw12345678",
      }),
    ).rejects.toBeInstanceOf(LicensingUnavailableError);
  });
});

describe("changePassword", () => {
  it("normalizes the key and forwards credentials", async () => {
    changeCloudPassword.mockResolvedValue(undefined);
    await httpLicensingClient.changePassword(
      "  rnp-test-1234-aaaa-bbbb ",
      "jane.doe@acme.test",
      "old-pass-123",
      "new-pass-456",
    );
    expect(changeCloudPassword).toHaveBeenCalledWith({
      licenseKey: "RNP-TEST-1234-AAAA-BBBB",
      email: "jane.doe@acme.test",
      currentPassword: "old-pass-123",
      newPassword: "new-pass-456",
    });
  });

  it("maps 401 bad_credentials to CloudCredentialsError", async () => {
    changeCloudPassword.mockRejectedValue(
      apiError(401, { error: "Current password is incorrect", code: "bad_credentials" }),
    );
    await expect(
      httpLicensingClient.changePassword(freshKey(), "a@b.test", "wrong", "new-pass-456"),
    ).rejects.toBeInstanceOf(CloudCredentialsError);
  });

  it("maps 404 unknown_key to LicenseInvalidError", async () => {
    changeCloudPassword.mockRejectedValue(
      apiError(404, { error: "Unknown license key", code: "unknown_key" }),
    );
    await expect(
      httpLicensingClient.changePassword(freshKey(), "a@b.test", "old", "new-pass-456"),
    ).rejects.toBeInstanceOf(LicenseInvalidError);
  });

  it("maps transport failures and 5xx to LicensingUnavailableError", async () => {
    changeCloudPassword.mockRejectedValue(new TypeError("fetch failed"));
    await expect(
      httpLicensingClient.changePassword(freshKey(), "a@b.test", "old", "new-pass-456"),
    ).rejects.toBeInstanceOf(LicensingUnavailableError);

    changeCloudPassword.mockRejectedValue(apiError(500, { error: "boom" }));
    await expect(
      httpLicensingClient.changePassword(freshKey(), "a@b.test", "old", "new-pass-456"),
    ).rejects.toBeInstanceOf(LicensingUnavailableError);
  });
});
