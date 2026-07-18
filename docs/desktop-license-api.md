# RentNotice Pro — Desktop License API Contract

This document defines the HTTP API the RentNotice Pro **desktop app** uses to
activate a license key, re-verify its status, and sync the company user
directory. It is served by the API server artifact (`artifacts/api-server`).

- **Base URL (development):** `https://<repl-domain>/api`
- **Content type:** `application/json` for requests and responses
- **Authentication:** the license key itself is the credential. Always send it
  in the request **body** (never in the URL) so it stays out of logs.

---

## License lifecycle

A license key is provisioned automatically when a company completes a Stripe
subscription checkout on the website. Its **effective status** is derived live
from the Stripe subscription on every request:

| Status      | Meaning                                                                                       |
| ----------- | --------------------------------------------------------------------------------------------- |
| `active`    | Subscription in good standing, **or** still inside the last paid billing period.               |
| `paused`    | Payment failed or subscription lapsed **and** the paid period has ended. Resumes immediately once billing is resolved. |
| `cancelled` | Subscription fully cancelled and the paid period has ended. Requires resubscribing.            |

Key rules:

- **Cancellation or non-payment pauses the key only at the end of the last paid
  period** — customers keep access to what they paid for.
- **Payment resolution / reactivation resumes the key immediately** — status is
  computed from the live subscription state on every `activate`/`verify` call,
  so there is no delay waiting for a batch job.
- Every response includes a human-readable `statusReason` suitable for display.

### Offline grace period

Every successful response includes `graceDays` (currently **14**). The desktop
app should:

1. Store the full response of the last successful `verify` locally, along with
   its `verifiedAt` timestamp.
2. Keep working offline while `now - verifiedAt < graceDays`.
3. Re-verify on every app launch when online, and at least once every 24h while
   running.
4. If re-verification has not succeeded within `graceDays`, lock the workspace
   until a successful `verify` (or show the paused/cancelled reason).

---

## Endpoints

### POST `/license/activate`

Called once when the user first enters the license key in the desktop app
(Settings → License), and again whenever the app is reinstalled or moved to a
new machine.

**Request body**

```json
{
  "licenseKey": "RNP-XXXX-XXXX-XXXX-XXXX",
  "deviceId": "stable-machine-identifier",
  "deviceName": "Front Office PC" // optional
}
```

| Field        | Type   | Required | Notes                                              |
| ------------ | ------ | -------- | -------------------------------------------------- |
| `licenseKey` | string | yes      | Case-insensitive; server normalizes to upper case.  |
| `deviceId`   | string | yes      | Any stable identifier for the installation.         |
| `deviceName` | string | no       | Friendly label shown in the customer portal.        |

**Responses**

- `200 OK` — activation succeeded; body is a [LicenseInfo](#licenseinfo-response-shape).
- `403 Forbidden` — key exists but is not usable:

  ```json
  { "error": "License is paused: ...", "code": "license_paused" }
  ```

  `code` is `license_paused` or `license_cancelled`.
- `404 Not Found` — `{ "error": "Unknown license key", "code": "unknown_key" }`
- `400 Bad Request` — `{ "error": "Invalid input", "code": "invalid_input" }`

### POST `/license/change-password`

Called when a signed-in desktop user changes their own password from
Settings → My Account. The cloud directory is the source of truth for
credentials in activated workspaces (the same password is used on the customer
website), so the desktop app updates the cloud first and only then refreshes
its local offline sign-in hash. The server verifies the current password
before changing anything and revokes the user's existing customer-website
sessions on success.

**Request body**

```json
{
  "licenseKey": "RNP-XXXX-XXXX-XXXX-XXXX",
  "email": "jane@acme.test",
  "currentPassword": "old-password",
  "newPassword": "new-password-min-8"
}
```

| Field             | Type   | Required | Notes                                            |
| ----------------- | ------ | -------- | ------------------------------------------------ |
| `licenseKey`      | string | yes      | Case-insensitive; server normalizes to upper case. |
| `email`           | string | yes      | The member's directory email (case-insensitive). |
| `currentPassword` | string | yes      | Verified server-side before any change.          |
| `newPassword`     | string | yes      | Minimum 8 characters.                            |

**Responses**

- `204 No Content` — password changed; existing website sessions revoked.
- `401 Unauthorized` — `{ "error": "Current password is incorrect", "code": "bad_credentials" }`
  (also returned for unknown/inactive/never-set-up accounts so the endpoint
  does not reveal which emails exist).
- `404 Not Found` — `{ "error": "Unknown license key", "code": "unknown_key" }`
- `400 Bad Request` — `{ "error": "Invalid input (new password must be at least 8 characters)", "code": "invalid_input" }`

### POST `/license/verify`

Called on app launch and periodically (recommended: every 24 hours) to
re-verify the key and pull the latest user directory.

**Request body**

```json
{
  "licenseKey": "RNP-XXXX-XXXX-XXXX-XXXX",
  "deviceId": "stable-machine-identifier" // optional
}
```

**Responses**

- `200 OK` — **always returned for a known key, even when paused/cancelled**,
  so the desktop app can show the reason and enter its locked state. Body is a
  [LicenseInfo](#licenseinfo-response-shape); check the `status` field.
- `404 Not Found` — `{ "error": "Unknown license key", "code": "unknown_key" }`
- `400 Bad Request` — `{ "error": "Invalid input", "code": "invalid_input" }`

---

## LicenseInfo response shape

```json
{
  "status": "active",
  "statusReason": "Subscription in good standing",
  "company": { "id": "uuid", "name": "Acme Property Management" },
  "tier": "professional",
  "seats": 10,
  "paidThrough": "2026-08-01T00:00:00.000Z",
  "users": [
    {
      "id": "uuid",
      "email": "owner@acme.com",
      "name": "Alex Owner",
      "role": "admin",
      "active": true,
      "isMasterAdmin": true
    },
    {
      "id": "uuid",
      "email": "staff@acme.com",
      "name": "Sam Staff",
      "role": "staff",
      "active": true,
      "isMasterAdmin": false
    }
  ],
  "graceDays": 14,
  "verifiedAt": "2026-07-08T12:00:00.000Z"
}
```

| Field          | Type                | Notes                                                            |
| -------------- | ------------------- | ---------------------------------------------------------------- |
| `status`       | `active \| paused \| cancelled` | Effective status derived from the Stripe subscription. |
| `statusReason` | string              | Display-ready explanation.                                        |
| `company`      | `{ id, name }`      | The subscribing company.                                          |
| `tier`         | string              | `starter`, `professional`, `enterprise`, or `unlimited`.          |
| `seats`        | integer \| null     | Seat limit for the tier; `null` means unlimited (no seat cap).    |
| `paidThrough`  | ISO datetime \| null | End of the last paid billing period.                             |
| `users`        | DirectoryUser[]     | All **active** company users (including invited, not-yet-accepted users). Deactivated users are omitted. |
| `graceDays`    | integer             | Offline grace window (see above).                                 |
| `verifiedAt`   | ISO datetime        | Server timestamp of this verification.                            |

### User directory & desktop RBAC

`users[].role` uses exactly the same role vocabulary as the desktop app's RBAC
(`artifacts/rentnotice-pro/src/lib/api/permissions.ts`):

| Role       | Desktop meaning                       |
| ---------- | ------------------------------------- |
| `admin`    | Full access, user management          |
| `manager`  | Manage tenants/notices, no user admin |
| `staff`    | Day-to-day notice creation            |
| `readonly` | View-only                             |

The desktop app should treat the directory as the source of truth for **who**
belongs to the company and **which role** each person holds. Local login (PIN)
and per-user data remain desktop concerns — no tenant data is synced through
this API.

`isMasterAdmin` marks the account created from the original purchase; the
website prevents demoting or deactivating it.

---

## Error handling summary

All errors are JSON: `{ "error": "<human message>", "code": "<machine code>" }`.

| HTTP | `code`              | When                                     |
| ---- | ------------------- | ---------------------------------------- |
| 400  | `invalid_input`     | Malformed body                           |
| 403  | `license_paused`    | Activation attempted on a paused key     |
| 403  | `license_cancelled` | Activation attempted on a cancelled key  |
| 404  | `unknown_key`       | Key does not exist                       |
| 500  | `internal`          | Unexpected server error                  |

Recommended desktop behavior on network failure or 5xx: keep the last known
state and retry with backoff, honoring the `graceDays` window.
