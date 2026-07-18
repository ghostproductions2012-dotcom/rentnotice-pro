/**
 * Chat sign-in token expiry check against the live api-server.
 *
 * Verifies the 60-day member-token expiry contract:
 *   1. Minting a token via POST /api/comms/identity/token returns an
 *      `expiresAt` roughly 60 days in the future.
 *   2. The freshly minted token authenticates member routes.
 *   3. (DB-backed environments only) A token whose expires_at is in the
 *      past is rejected with 401, and a legacy row with an empty
 *      expires_at inherits created_at + 60 days and keeps working.
 *
 * Runs against the dev proxy by default. For a post-publish live check,
 * point it at production and supply real member credentials:
 *
 *   CHAT_EXPIRY_BASE_URL=https://<prod-domain> \
 *   CHAT_EXPIRY_LICENSE_KEY=... \
 *   CHAT_EXPIRY_IDENTIFIER=... CHAT_EXPIRY_SECRET=... \
 *   pnpm --filter @workspace/scripts run check:chat-token-expiry
 *
 * Steps needing direct DB access (seeding expired/legacy rows) are
 * skipped automatically when DATABASE_URL is not set, so the script is
 * safe to run against production where only steps 1-2 apply. All rows
 * the check creates are deleted afterwards.
 */

import pg from "pg";

const BASE_URL = process.env.CHAT_EXPIRY_BASE_URL ?? "http://127.0.0.1:80";
const LICENSE_KEY =
  process.env.CHAT_EXPIRY_LICENSE_KEY ?? "RNP-KX88-NHUR-ZZYQ-CCPS";
const IDENTIFIER = process.env.CHAT_EXPIRY_IDENTIFIER ?? "admin@admin.com";
const SECRET = process.env.CHAT_EXPIRY_SECRET ?? "admin";
const TTL_DAYS = 60;
const RUN_TAG = `chatexpirycheck-${Date.now()}`;

const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
  console.error(`  FAIL  ${message}`);
}

function pass(message: string): void {
  console.log(`  ok    ${message}`);
}

async function api<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  opts?: { token?: string },
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-license-key": LICENSE_KEY,
  };
  if (opts?.token) headers["x-member-token"] = opts.token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE_URL}/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON response; leave json null
  }
  return { status: res.status, json: json as T };
}

interface MintResponse {
  token?: string;
  memberKey?: string;
  memberName?: string;
  expiresAt?: string;
  error?: string;
}

async function main(): Promise<void> {
  console.log(`chat-token-expiry check against ${BASE_URL}`);

  // 1. Mint a token and validate expiresAt.
  const mint = await api<MintResponse>("POST", "/comms/identity/token", {
    identifier: IDENTIFIER,
    secret: SECRET,
  });
  if (mint.status !== 200 || !mint.json.token) {
    fail(
      `mint returned ${mint.status} ${JSON.stringify(mint.json)} — expected 200 with a token`,
    );
    report();
    return;
  }
  pass("mint returned 200 with a token");

  const expiresAt = mint.json.expiresAt ?? "";
  const expiresMs = Date.parse(expiresAt);
  if (!expiresAt || Number.isNaN(expiresMs)) {
    fail(`mint response has no parseable expiresAt (got ${JSON.stringify(expiresAt)})`);
  } else {
    const days = (expiresMs - Date.now()) / (24 * 60 * 60 * 1000);
    if (days > TTL_DAYS - 1 && days <= TTL_DAYS + 1) {
      pass(`expiresAt is ~${TTL_DAYS} days out (${expiresAt})`);
    } else {
      fail(`expiresAt is ${days.toFixed(1)} days out, expected ~${TTL_DAYS} (${expiresAt})`);
    }
  }

  // 2. Fresh token authenticates member routes.
  const members = await api("GET", "/comms/members", undefined, {
    token: mint.json.token,
  });
  if (members.status === 200) {
    pass("fresh token authenticates GET /comms/members");
  } else {
    fail(`fresh token got ${members.status} from GET /comms/members, expected 200`);
  }

  // 3. Expired / legacy row behavior — needs direct DB access to seed rows.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.log(
      "  skip  expired/legacy row checks (DATABASE_URL not set — expected when targeting production)",
    );
  } else {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    const expiredToken = `${RUN_TAG}-expired`;
    const legacyToken = `${RUN_TAG}-legacy`;
    try {
      const companyRow = await pool.query(
        "SELECT company_id, member_key, member_name FROM chat_member_tokens WHERE token = $1",
        [mint.json.token],
      );
      if (companyRow.rowCount !== 1) {
        fail("minted token row not found in chat_member_tokens");
      } else {
        const { company_id, member_key, member_name } = companyRow.rows[0] as {
          company_id: string;
          member_key: string;
          member_name: string;
        };
        const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const longAgo = new Date(
          Date.now() - (TTL_DAYS + 10) * 24 * 60 * 60 * 1000,
        ).toISOString();
        const recent = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        await pool.query(
          `INSERT INTO chat_member_tokens (token, company_id, member_key, member_name, created_at, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6), ($7,$2,$3,$4,$8,'')`,
          [expiredToken, company_id, member_key, member_name, longAgo, past, legacyToken, recent],
        );

        const expired = await api("GET", "/comms/members", undefined, {
          token: expiredToken,
        });
        if (expired.status === 401) {
          pass("expired token is rejected with 401");
        } else {
          fail(`expired token got ${expired.status}, expected 401`);
        }

        const legacy = await api("GET", "/comms/members", undefined, {
          token: legacyToken,
        });
        if (legacy.status === 200) {
          pass("legacy empty-expiry token (recent created_at) still works");
        } else {
          fail(`legacy token got ${legacy.status}, expected 200`);
        }
      }
    } finally {
      await pool.query(
        "DELETE FROM chat_member_tokens WHERE token = ANY($1::text[])",
        [[expiredToken, legacyToken, mint.json.token]],
      );
      await pool.end();
    }
  }

  report();
}

function report(): void {
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall chat-token-expiry checks passed");
}

main().catch((err) => {
  console.error("check crashed:", err);
  process.exit(1);
});
