/**
 * Communications-hub end-to-end check against the live api-server.
 *
 * Exercises the license-scoped /api/comms/* relay the desktop and mobile
 * apps use, simulating two team members chatting:
 *   1. Auth: requests without an x-license-key header are rejected.
 *   2. Team directory lists at least one member.
 *   3. User A creates a channel and posts a message (idempotent by id).
 *   4. User B sees the channel with an unread badge, reads the message,
 *      marks it read (badge clears), and replies.
 *   5. User A sees the reply as unread, and the DM endpoint is
 *      get-or-create (same conversation for the same pair).
 *   6. A tenant communication is logged and appears in the tenant's
 *      history feed.
 *   7. The channel archives cleanly.
 *
 * All rows created by the check are deleted from Postgres afterwards.
 *
 * Requires the API Server workflow to be running (reachable through the
 * local proxy on port 80) and DATABASE_URL to be set for cleanup.
 */

import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

const BASE_URL = process.env.COMMS_CHECK_BASE_URL ?? "http://127.0.0.1:80";
const LICENSE_KEY =
  process.env.COMMS_CHECK_LICENSE_KEY ?? "RNP-KX88-NHUR-ZZYQ-CCPS";
const RUN_TAG = Date.now();

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
  opts?: { omitLicense?: boolean; token?: string; headers?: Record<string, string> },
): Promise<{ status: number; json: T }> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!opts?.omitLicense) headers["x-license-key"] = LICENSE_KEY;
  if (opts?.token) headers["x-member-token"] = opts.token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts?.headers) Object.assign(headers, opts.headers);
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
    // non-JSON body (or empty) — leave as null
  }
  return { status: res.status, json: json as T };
}

interface Member {
  id: string;
  name: string;
}
interface ChannelSync {
  id: string;
  kind: string;
  name: string;
  archived: boolean;
  unreadCount: number;
  lastMessagePreview: string | null;
}
interface MessageSync {
  id: string;
  body: string;
  senderKey: string;
  createdAt: string;
}
interface TenantComm {
  id: string;
  tenantId: string;
  kind: string;
  status: string;
  subject: string;
}

async function cleanup(ids: {
  channelIds: string[];
  tenantCommIds: string[];
  directoryMemberKeys: string[];
}): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.warn("DATABASE_URL not set — skipping row cleanup");
    return;
  }
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (ids.channelIds.length > 0) {
      // chat_messages + chat_read_state cascade on channel delete.
      await client.query("DELETE FROM chat_channels WHERE id = ANY($1)", [
        ids.channelIds,
      ]);
    }
    if (ids.tenantCommIds.length > 0) {
      await client.query(
        "DELETE FROM tenant_communications WHERE id = ANY($1)",
        [ids.tenantCommIds],
      );
    }
    if (ids.directoryMemberKeys.length > 0) {
      // chat_member_tokens cascade on directory member delete.
      await client.query(
        "DELETE FROM chat_directory_members WHERE member_key = ANY($1)",
        [ids.directoryMemberKeys],
      );
    }
  } finally {
    await client.end();
  }
}

/**
 * Seed throwaway directory members for this run (directly in Postgres, so
 * the company's real replicated directory is untouched), then mint real
 * member tokens through POST /comms/identity/token — the same flow the
 * desktop and mobile apps use.
 */
async function mintTokens(
  users: { key: string; name: string; role: string }[],
): Promise<Map<string, string>> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required to seed chat identities");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let companyId: string;
  try {
    const lic = await client.query(
      "SELECT company_id FROM license_keys WHERE key = $1",
      [LICENSE_KEY],
    );
    companyId = lic.rows[0]?.company_id as string;
    if (!companyId) throw new Error("license key not found in database");
    for (const u of users) {
      const secret = `pw-${u.key}`;
      const secretHash = createHash("sha256").update(secret).digest("hex");
      await client.query(
        `INSERT INTO chat_directory_members
           (id, company_id, member_key, name, username, email, role, active, secret_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, '', $6, true, $7, $8)
         ON CONFLICT (company_id, member_key) DO UPDATE
           SET username = EXCLUDED.username, role = EXCLUDED.role,
               secret_hash = EXCLUDED.secret_hash,
               active = true, updated_at = EXCLUDED.updated_at`,
        [randomUUID(), companyId, u.key, u.name, u.key, u.role, secretHash, new Date().toISOString()],
      );
    }
  } finally {
    await client.end();
  }
  const tokens = new Map<string, string>();
  for (const u of users) {
    const res = await api<{ token: string; memberKey: string }>(
      "POST",
      "/comms/identity/token",
      { identifier: u.key, secret: `pw-${u.key}` },
    );
    if (res.status !== 200 || !res.json?.token || res.json.memberKey !== u.key) {
      throw new Error(
        `token mint failed for ${u.key} (${res.status}: ${JSON.stringify(res.json).slice(0, 200)})`,
      );
    }
    tokens.set(u.key, res.json.token);
  }
  pass(`minted member tokens for ${users.length} seeded chat identities`);
  return tokens;
}

async function main(): Promise<void> {
  console.log(`Communications hub check against ${BASE_URL}/api/comms/*`);
  const createdChannelIds: string[] = [];
  const createdTenantCommIds: string[] = [];

  // User A is an admin (channel create/archive are admin-only, matching the
  // desktop UI); user B and the intruder are regular staff.
  const userA = { key: `e2e-user-a-${RUN_TAG}`, name: "E2E First User", role: "admin" };
  const userB = { key: `e2e-user-b-${RUN_TAG}`, name: "E2E Second User", role: "staff" };
  const intruder = { key: `e2e-intruder-${RUN_TAG}`, name: "E2E Intruder", role: "staff" };
  const directoryMemberKeys = [userA.key, userB.key, intruder.key];

  try {
    // --- 0. seed identities and mint member tokens ---------------------------
    const tokens = await mintTokens([userA, userB, intruder]);
    const tokenA = tokens.get(userA.key)!;
    const tokenB = tokens.get(userB.key)!;
    const tokenIntruder = tokens.get(intruder.key)!;

    // --- 1. auth ------------------------------------------------------------
    {
      const res = await api("GET", "/comms/members", undefined, {
        omitLicense: true,
      });
      if (res.status === 401) pass("request without x-license-key is rejected (401)");
      else fail(`expected 401 without license key, got ${res.status}`);

      const noToken = await api<{ code?: string }>("GET", "/comms/members");
      if (noToken.status === 401 && noToken.json?.code === "member_token_required") {
        pass("request without x-member-token is rejected (401 member_token_required)");
      } else {
        fail(
          `expected 401/member_token_required without member token, got ${noToken.status}/${noToken.json?.code}`,
        );
      }

      const badToken = await api("GET", "/comms/members", undefined, {
        token: "not-a-real-token",
      });
      if (badToken.status === 401) pass("request with an invalid member token is rejected (401)");
      else fail(`expected 401 with invalid member token, got ${badToken.status}`);

      const spoofed = await api<{ code?: string }>(
        "POST",
        "/comms/channels",
        { name: `e2e-spoof-${RUN_TAG}`, createdByKey: userB.key, createdByName: userB.name },
        { token: tokenA },
      );
      if (spoofed.status === 403 && spoofed.json?.code === "member_mismatch") {
        pass("acting as another member is rejected (403 member_mismatch)");
      } else {
        fail(
          `expected 403/member_mismatch for spoofed createdByKey, got ${spoofed.status}/${spoofed.json?.code}`,
        );
        if (spoofed.status === 200) {
          const sp = spoofed.json as unknown as ChannelSync;
          if (sp?.id) createdChannelIds.push(sp.id);
        }
      }
    }

    // --- 2. team directory ---------------------------------------------------
    const members = await api<Member[]>("GET", "/comms/members", undefined, {
      token: tokenA,
    });
    if (members.status !== 200 || !Array.isArray(members.json) || members.json.length === 0) {
      fail(
        `GET /comms/members expected a non-empty list, got ${members.status}: ${JSON.stringify(members.json).slice(0, 200)}`,
      );
      throw new Error("cannot continue without a team member");
    }
    pass(`team directory lists ${members.json.length} member(s)`);

    // --- 3. user A creates a channel and posts ------------------------------
    const channelName = `e2e-comms-${RUN_TAG}`;

    // Channel creation is admin-only: user B (staff) must be rejected with
    // a server-side 403 before the admin path is exercised.
    const staffCreate = await api<{ code?: string; id?: string }>(
      "POST",
      "/comms/channels",
      {
        name: `e2e-staff-denied-${RUN_TAG}`,
        createdByKey: userB.key,
        createdByName: userB.name,
      },
      { token: tokenB },
    );
    if (staffCreate.status === 403 && staffCreate.json?.code === "admin_required") {
      pass("staff member cannot create a channel (403 admin_required)");
    } else {
      fail(
        `expected 403/admin_required for staff channel create, got ${staffCreate.status}/${staffCreate.json?.code}`,
      );
      if (staffCreate.status === 200 && staffCreate.json?.id) {
        createdChannelIds.push(staffCreate.json.id);
      }
    }

    const created = await api<ChannelSync>(
      "POST",
      "/comms/channels",
      {
        name: channelName,
        createdByKey: userA.key,
        createdByName: userA.name,
      },
      { token: tokenA },
    );
    if (created.status !== 200 || !created.json?.id) {
      fail(`channel create failed (${created.status})`);
      throw new Error("cannot continue without a channel");
    }
    createdChannelIds.push(created.json.id);
    const channelId = created.json.id;
    pass(`user A created channel #${channelName}`);

    const msg1Id = randomUUID();
    const msg1 = await api<MessageSync>(
      "POST",
      `/comms/channels/${channelId}/messages`,
      {
        id: msg1Id,
        senderKey: userA.key,
        senderName: userA.name,
        body: "Hello from user A (e2e)",
      },
      { token: tokenA },
    );
    if (msg1.status === 200 && msg1.json.id === msg1Id) {
      pass("user A posted a message");
    } else {
      fail(`message post failed (${msg1.status})`);
    }

    // Idempotency: same client id → same stored message, no duplicate.
    const msg1Retry = await api<MessageSync>(
      "POST",
      `/comms/channels/${channelId}/messages`,
      {
        id: msg1Id,
        senderKey: userA.key,
        senderName: userA.name,
        body: "Hello from user A (e2e) — retry",
      },
      { token: tokenA },
    );
    const listAfterRetry = await api<MessageSync[]>(
      "GET",
      `/comms/channels/${channelId}/messages`,
      undefined,
      { token: tokenA },
    );
    if (
      msg1Retry.json?.body === "Hello from user A (e2e)" &&
      Array.isArray(listAfterRetry.json) &&
      listAfterRetry.json.length === 1
    ) {
      pass("resending the same message id is idempotent (no duplicate)");
    } else {
      fail(
        `idempotency broken: retry body "${msg1Retry.json?.body}", ${Array.isArray(listAfterRetry.json) ? listAfterRetry.json.length : "?"} message(s) in channel`,
      );
    }

    // --- 4. user B sees unread, reads, replies -------------------------------
    const channelsForB = await api<ChannelSync[]>(
      "GET",
      `/comms/channels?memberKey=${encodeURIComponent(userB.key)}`,
      undefined,
      { token: tokenB },
    );
    const chanB = Array.isArray(channelsForB.json)
      ? channelsForB.json.find((c) => c.id === channelId)
      : undefined;
    if (chanB && chanB.unreadCount === 1 && chanB.lastMessagePreview) {
      pass("user B sees the channel with 1 unread and a message preview");
    } else {
      fail(
        `user B expected unreadCount 1 on #${channelName}, got ${JSON.stringify(chanB ?? null).slice(0, 200)}`,
      );
    }

    const messagesForB = await api<MessageSync[]>(
      "GET",
      `/comms/channels/${channelId}/messages`,
      undefined,
      { token: tokenB },
    );
    const sawMsg1 =
      Array.isArray(messagesForB.json) &&
      messagesForB.json.some((m) => m.id === msg1Id);
    if (sawMsg1) pass("user B reads user A's message");
    else fail("user B did not receive user A's message");

    const msg1CreatedAt = Array.isArray(messagesForB.json)
      ? messagesForB.json.find((m) => m.id === msg1Id)?.createdAt
      : undefined;
    const read = await api(
      "POST",
      `/comms/channels/${channelId}/read`,
      {
        memberKey: userB.key,
        lastReadAt: msg1CreatedAt ?? new Date().toISOString(),
      },
      { token: tokenB },
    );
    const channelsForB2 = await api<ChannelSync[]>(
      "GET",
      `/comms/channels?memberKey=${encodeURIComponent(userB.key)}`,
      undefined,
      { token: tokenB },
    );
    const chanB2 = Array.isArray(channelsForB2.json)
      ? channelsForB2.json.find((c) => c.id === channelId)
      : undefined;
    if (read.status === 200 && chanB2?.unreadCount === 0) {
      pass("mark-read clears user B's unread badge");
    } else {
      fail(
        `mark-read did not clear unread (status ${read.status}, unread ${chanB2?.unreadCount})`,
      );
    }

    const msg2Id = randomUUID();
    const msg2 = await api<MessageSync>(
      "POST",
      `/comms/channels/${channelId}/messages`,
      {
        id: msg2Id,
        senderKey: userB.key,
        senderName: userB.name,
        body: "Reply from user B (e2e)",
      },
      { token: tokenB },
    );
    if (msg2.status === 200) pass("user B replied");
    else fail(`user B reply failed (${msg2.status})`);

    // --- 5. user A sees the reply as unread; DM is get-or-create -------------
    const channelsForA = await api<ChannelSync[]>(
      "GET",
      `/comms/channels?memberKey=${encodeURIComponent(userA.key)}`,
      undefined,
      { token: tokenA },
    );
    const chanA = Array.isArray(channelsForA.json)
      ? channelsForA.json.find((c) => c.id === channelId)
      : undefined;
    if (chanA?.unreadCount === 1) {
      pass("user A sees user B's reply as 1 unread");
    } else {
      fail(`user A expected unreadCount 1, got ${chanA?.unreadCount}`);
    }
    const messagesForA = await api<MessageSync[]>(
      "GET",
      `/comms/channels/${channelId}/messages`,
      undefined,
      { token: tokenA },
    );
    if (
      Array.isArray(messagesForA.json) &&
      messagesForA.json.some((m) => m.id === msg2Id)
    ) {
      pass("user A reads user B's reply");
    } else {
      fail("user A did not receive user B's reply");
    }

    const dmBody = {
      memberKeys: [userA.key, userB.key],
      memberNames: [userA.name, userB.name],
      createdByKey: userA.key,
      createdByName: userA.name,
    };
    const dm1 = await api<ChannelSync>("POST", "/comms/dms", dmBody, { token: tokenA });
    const dm2 = await api<ChannelSync>("POST", "/comms/dms", dmBody, { token: tokenA });
    if (dm1.status === 200 && dm1.json?.id) createdChannelIds.push(dm1.json.id);
    if (
      dm1.status === 200 &&
      dm2.status === 200 &&
      dm1.json?.id &&
      dm1.json.id === dm2.json?.id
    ) {
      pass("DM endpoint is get-or-create (same conversation for the same pair)");
    } else {
      fail(
        `DM get-or-create broken: first ${dm1.status}/${dm1.json?.id}, second ${dm2.status}/${dm2.json?.id}`,
      );
    }

    // --- 5b. DM privacy: only the two participants may access a DM -----------
    if (dm1.status === 200 && dm1.json?.id) {
      const dmId = dm1.json.id;

      const dmNoToken = await api("GET", `/comms/channels/${dmId}/messages`);
      const dmIntruderRead = await api(
        "GET",
        `/comms/channels/${dmId}/messages`,
        undefined,
        { token: tokenIntruder },
      );
      const dmParticipantRead = await api<MessageSync[]>(
        "GET",
        `/comms/channels/${dmId}/messages`,
        undefined,
        { token: tokenA },
      );
      if (
        dmNoToken.status === 401 &&
        dmIntruderRead.status === 403 &&
        dmParticipantRead.status === 200
      ) {
        pass("DM messages readable only by participants (401 no token / 403 intruder)");
      } else {
        fail(
          `DM read privacy broken: no token ${dmNoToken.status}, intruder ${dmIntruderRead.status}, participant ${dmParticipantRead.status}`,
        );
      }

      const dmIntruderPost = await api(
        "POST",
        `/comms/channels/${dmId}/messages`,
        {
          id: randomUUID(),
          senderKey: intruder.key,
          senderName: intruder.name,
          body: "should be rejected",
        },
        { token: tokenIntruder },
      );
      if (dmIntruderPost.status === 403) {
        pass("non-participant cannot post into a DM (403)");
      } else {
        fail(`intruder DM post returned ${dmIntruderPost.status}, expected 403`);
      }

      const dmIntruderReadState = await api(
        "POST",
        `/comms/channels/${dmId}/read`,
        { memberKey: intruder.key, lastReadAt: new Date().toISOString() },
        { token: tokenIntruder },
      );
      if (dmIntruderReadState.status === 403) {
        pass("non-participant cannot mark a DM read (403)");
      } else {
        fail(
          `intruder DM mark-read returned ${dmIntruderReadState.status}, expected 403`,
        );
      }
    }

    // --- 6. tenant communication log -----------------------------------------
    const tenantId = `e2e-tenant-${RUN_TAG}`;
    const logged = await api<TenantComm>("POST", "/comms/tenant-communications", {
      tenantId,
      tenantName: "E2E Tenant",
      tenantEmail: "e2e-tenant@example.com",
      propertyAddress: "123 Check St",
      kind: "announcement",
      subject: "E2E announcement",
      bodyText: "Body of the e2e announcement",
      createdByKey: userA.key,
      createdByName: userA.name,
    });
    if (logged.status === 200 && logged.json?.id) {
      createdTenantCommIds.push(logged.json.id);
    }
    const history = await api<TenantComm[]>(
      "GET",
      `/comms/tenant-communications?tenantId=${encodeURIComponent(tenantId)}`,
    );
    const entry = Array.isArray(history.json)
      ? history.json.find((r) => r.id === logged.json?.id)
      : undefined;
    if (
      logged.status === 200 &&
      entry &&
      entry.status === "logged" &&
      entry.subject === "E2E announcement"
    ) {
      pass("tenant communication is logged and appears in the tenant's history");
    } else {
      fail(
        `tenant communication log failed (post ${logged.status}, found ${JSON.stringify(entry ?? null).slice(0, 200)})`,
      );
    }

    // --- 6b. automatic history entries (notice served / work order) ----------
    // The desktop app mirrors served-notice and work-order events into the
    // tenant history through this same endpoint; verify both kinds round-trip.
    for (const auto of [
      {
        kind: "notice_served",
        subject: "3-Day Notice to Pay Rent or Quit served",
        bodyText: "Served 2026-07-18 by E2E Agent (personal service).",
      },
      {
        kind: "work_order",
        subject: "Work order completed: E2E leaky faucet",
        bodyText: "Replaced washer and tested.",
      },
    ] as const) {
      const posted = await api<TenantComm>("POST", "/comms/tenant-communications", {
        tenantId,
        tenantName: "E2E Tenant",
        propertyAddress: "123 Check St",
        kind: auto.kind,
        subject: auto.subject,
        bodyText: auto.bodyText,
        createdByKey: userA.key,
        createdByName: userA.name,
        suppressEvent: true,
      });
      if (posted.status === 200 && posted.json?.id) {
        createdTenantCommIds.push(posted.json.id);
      }
      const refetched = await api<TenantComm[]>(
        "GET",
        `/comms/tenant-communications?tenantId=${encodeURIComponent(tenantId)}`,
      );
      const found = Array.isArray(refetched.json)
        ? refetched.json.find((r) => r.id === posted.json?.id)
        : undefined;
      if (
        posted.status === 200 &&
        found &&
        found.kind === auto.kind &&
        found.subject === auto.subject
      ) {
        pass(`automatic ${auto.kind} entry is logged in the tenant's history`);
      } else {
        fail(
          `automatic ${auto.kind} entry failed (post ${posted.status}, found ${JSON.stringify(found ?? null).slice(0, 200)})`,
        );
      }
    }

    // --- 6c. tenant email (send + log) ----------------------------------------
    // Uses a reserved example.com address so nothing is actually delivered.
    // The endpoint must return 200 and log the attempt with status
    // "sent" (provider accepted) or "failed" (provider rejected/not set up).
    const emailRes = await api<TenantComm>("POST", "/comms/tenant-email", {
      tenantId,
      tenantName: "E2E Tenant",
      tenantEmail: `e2e-no-delivery-${RUN_TAG}@example.com`,
      propertyAddress: "123 Check St",
      subject: "E2E tenant email",
      bodyText: "Body of the e2e tenant email (never delivered).",
      createdByKey: userA.key,
      createdByName: userA.name,
    });
    if (emailRes.status === 200 && emailRes.json?.id) {
      createdTenantCommIds.push(emailRes.json.id);
    }
    const historyWithEmail = await api<TenantComm[]>(
      "GET",
      `/comms/tenant-communications?tenantId=${encodeURIComponent(tenantId)}`,
    );
    const emailEntry = Array.isArray(historyWithEmail.json)
      ? historyWithEmail.json.find((r) => r.id === emailRes.json?.id)
      : undefined;
    if (
      emailRes.status === 200 &&
      emailEntry &&
      emailEntry.kind === "email" &&
      (emailEntry.status === "sent" || emailEntry.status === "failed")
    ) {
      pass(
        `tenant email endpoint sends and logs to history (delivery status: ${emailEntry.status})`,
      );
    } else {
      fail(
        `tenant email send+log failed (post ${emailRes.status}, entry ${JSON.stringify(emailEntry ?? null).slice(0, 200)})`,
      );
    }
    const badEmail = await api("POST", "/comms/tenant-email", {
      tenantId,
      tenantName: "E2E Tenant",
      tenantEmail: "not-an-email",
      subject: "x",
      bodyText: "y",
    });
    if (badEmail.status === 400) {
      pass("tenant email rejects an invalid address with 400");
    } else {
      fail(`invalid tenant email returned ${badEmail.status}, expected 400`);
    }

    // --- 7. archive -----------------------------------------------------------
    // Archiving is admin-only: user B (staff) must be rejected first.
    const staffArchive = await api<{ code?: string }>(
      "POST",
      `/comms/channels/${channelId}/archive`,
      { archived: true },
      { token: tokenB },
    );
    if (staffArchive.status === 403 && staffArchive.json?.code === "admin_required") {
      pass("staff member cannot archive a channel (403 admin_required)");
    } else {
      fail(
        `expected 403/admin_required for staff channel archive, got ${staffArchive.status}/${staffArchive.json?.code}`,
      );
    }

    const archived = await api<ChannelSync>(
      "POST",
      `/comms/channels/${channelId}/archive`,
      { archived: true },
      { token: tokenA },
    );
    const channelsFinal = await api<ChannelSync[]>(
      "GET",
      `/comms/channels?memberKey=${encodeURIComponent(userA.key)}`,
      undefined,
      { token: tokenA },
    );
    const chanFinal = Array.isArray(channelsFinal.json)
      ? channelsFinal.json.find((c) => c.id === channelId)
      : undefined;
    if (archived.status === 200 && chanFinal?.archived === true) {
      pass("channel archives cleanly (archived flag set)");
    } else {
      fail(
        `archive failed (status ${archived.status}, archived ${chanFinal?.archived})`,
      );
    }

    // --- 8. integration settings require a server-verified administrator ------
    // A license key alone identifies the company, not the person, so writes
    // to the Slack/Google Chat settings must be rejected without a portal
    // admin session. GET stays available (webhook URLs come back masked).
    interface IntegrationsSync {
      events: string[];
      mirrorTeamChat: boolean;
      updatedAt: string | null;
    }
    {
      const putNoSession = await api<{ code?: string }>(
        "PUT",
        "/comms/integrations",
        { events: [] },
      );
      if (
        putNoSession.status === 403 &&
        putNoSession.json?.code === "admin_session_required"
      ) {
        pass("PUT /comms/integrations without an admin session is rejected (403)");
      } else {
        fail(
          `license-only integrations PUT returned ${putNoSession.status}/${putNoSession.json?.code}, expected 403/admin_session_required`,
        );
      }
      const testNoSession = await api<{ code?: string }>(
        "POST",
        "/comms/integrations/test",
        { target: "slack" },
      );
      if (testNoSession.status === 403) {
        pass("POST /comms/integrations/test without an admin session is rejected (403)");
      } else {
        fail(
          `license-only integrations test returned ${testNoSession.status}, expected 403`,
        );
      }
    }

    // With a signed-in portal admin (license key + session cookie, the way the
    // desktop calls it) the same PUT succeeds. Uses a throwaway admin user and
    // re-PUTs the current settings so nothing actually changes.
    if (process.env.DATABASE_URL) {
      const { randomBytes, scryptSync } = await import("node:crypto");
      const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await dbc.connect();
      const adminId = randomUUID();
      try {
        const lic = await dbc.query(
          "SELECT company_id FROM license_keys WHERE key = $1",
          [LICENSE_KEY],
        );
        const companyId = lic.rows[0]?.company_id as string | undefined;
        if (!companyId) throw new Error("license key not found in database");

        const before = await api<IntegrationsSync>("GET", "/comms/integrations");
        const hadRow = before.json?.updatedAt !== null;

        const password = randomBytes(12).toString("hex");
        const salt = randomBytes(16).toString("hex");
        const passwordHash = `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
        const email = `e2e-admin-${RUN_TAG}@example.com`;
        await dbc.query(
          `INSERT INTO cloud_users (id, company_id, email, name, role, is_master_admin, active, password_hash)
           VALUES ($1, $2, $3, 'E2E Admin', 'admin', false, true, $4)`,
          [adminId, companyId, email, passwordHash],
        );

        const loginRes = await fetch(`${BASE_URL}/api/www/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(15_000),
        });
        const setCookie = loginRes.headers.get("set-cookie") ?? "";
        const sessionCookie = /rnp_session=[^;]+/.exec(setCookie)?.[0];
        if (loginRes.status !== 200 || !sessionCookie) {
          fail(
            `portal admin login failed (status ${loginRes.status}, cookie ${sessionCookie ? "present" : "missing"})`,
          );
        } else {
          const putWithSession = await api<IntegrationsSync>(
            "PUT",
            "/comms/integrations",
            {
              events: before.json?.events ?? [],
              mirrorTeamChat: before.json?.mirrorTeamChat ?? false,
            },
            { headers: { Cookie: sessionCookie } },
          );
          if (
            putWithSession.status === 200 &&
            JSON.stringify(putWithSession.json?.events) ===
              JSON.stringify(before.json?.events ?? []) &&
            putWithSession.json?.mirrorTeamChat ===
              (before.json?.mirrorTeamChat ?? false)
          ) {
            pass("PUT /comms/integrations succeeds with a portal admin session");
          } else {
            fail(
              `admin-session integrations PUT failed (${putWithSession.status}: ${JSON.stringify(putWithSession.json).slice(0, 200)})`,
            );
          }
          // If the company had no settings row before, remove the one the
          // no-op PUT created so the check leaves no trace.
          if (!hadRow) {
            await dbc.query(
              "DELETE FROM company_integrations WHERE company_id = $1",
              [companyId],
            );
          }
        }
      } finally {
        await dbc.query("DELETE FROM web_sessions WHERE user_id = $1", [adminId]);
        await dbc.query("DELETE FROM cloud_users WHERE id = $1", [adminId]);
        await dbc.end();
      }
    } else {
      console.warn(
        "DATABASE_URL not set — skipping the admin-session integrations check",
      );
    }

    // --- 9. member token expiry & rotation ------------------------------------
    // Tokens carry a server-side expiry: expired tokens are rejected with a
    // 401 and their row is deleted; legacy rows without a stored expiry
    // inherit createdAt + TTL; minting sweeps the company's expired rows;
    // and re-minting after expiry issues a fresh working token.
    if (process.env.DATABASE_URL) {
      const dbc = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await dbc.connect();
      try {
        const minted = await api<{ token?: string; expiresAt?: string }>(
          "POST",
          "/comms/identity/token",
          { identifier: intruder.key, secret: `pw-${intruder.key}` },
        );
        const mintedExpiry = minted.json?.expiresAt;
        if (
          minted.status === 200 &&
          typeof mintedExpiry === "string" &&
          mintedExpiry > new Date().toISOString()
        ) {
          pass("minted token carries a future expiresAt");
        } else {
          fail(
            `mint did not return a future expiresAt (${minted.status}: ${JSON.stringify(minted.json).slice(0, 120)})`,
          );
        }

        // Force-expire the token and confirm the server rejects + deletes it.
        const expiredToken = minted.json?.token ?? "";
        await dbc.query(
          "UPDATE chat_member_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token = $1",
          [expiredToken],
        );
        const rejected = await api<{ code?: string }>(
          "GET",
          "/comms/members",
          undefined,
          { token: expiredToken },
        );
        if (rejected.status === 401 && rejected.json?.code === "member_token_required") {
          pass("expired member token is rejected (401 member_token_required)");
        } else {
          fail(
            `expired token expected 401/member_token_required, got ${rejected.status}/${rejected.json?.code}`,
          );
        }
        const goneOnUse = await dbc.query(
          "SELECT 1 FROM chat_member_tokens WHERE token = $1",
          [expiredToken],
        );
        if (goneOnUse.rowCount === 0) pass("expired token row is deleted on first use");
        else fail("expired token row still present after rejection");

        // Legacy rows (minted before expiry existed, empty expires_at)
        // inherit createdAt + TTL.
        const legacy = await api<{ token?: string }>(
          "POST",
          "/comms/identity/token",
          { identifier: intruder.key, secret: `pw-${intruder.key}` },
        );
        const legacyToken = legacy.json?.token ?? "";
        const staleCreated = new Date(
          Date.now() - 61 * 24 * 60 * 60 * 1000,
        ).toISOString();
        await dbc.query(
          "UPDATE chat_member_tokens SET expires_at = '', created_at = $1 WHERE token = $2",
          [staleCreated, legacyToken],
        );
        const legacyRejected = await api<{ code?: string }>(
          "GET",
          "/comms/members",
          undefined,
          { token: legacyToken },
        );
        if (legacyRejected.status === 401) {
          pass("legacy token (no stored expiry) past the TTL is rejected (401)");
        } else {
          fail(`stale legacy token expected 401, got ${legacyRejected.status}`);
        }

        // An expired row that is never used again gets swept by the next
        // mint (opportunistic cleanup), and the fresh token works.
        const sweepable = await api<{ token?: string }>(
          "POST",
          "/comms/identity/token",
          { identifier: intruder.key, secret: `pw-${intruder.key}` },
        );
        const sweepToken = sweepable.json?.token ?? "";
        await dbc.query(
          "UPDATE chat_member_tokens SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token = $1",
          [sweepToken],
        );
        const remint = await api<{ token?: string }>(
          "POST",
          "/comms/identity/token",
          { identifier: intruder.key, secret: `pw-${intruder.key}` },
        );
        const worksAgain = await api("GET", "/comms/members", undefined, {
          token: remint.json?.token ?? "",
        });
        if (remint.status === 200 && worksAgain.status === 200) {
          pass("re-minting after expiry issues a fresh working token");
        } else {
          fail(
            `re-mint after expiry failed (mint ${remint.status}, use ${worksAgain.status})`,
          );
        }
        const swept = await dbc.query(
          "SELECT 1 FROM chat_member_tokens WHERE token = $1",
          [sweepToken],
        );
        if (swept.rowCount === 0) pass("minting sweeps the company's expired token rows");
        else fail("expired token row survived a mint sweep");
      } finally {
        await dbc.end();
      }
    } else {
      console.warn("DATABASE_URL not set — skipping the token expiry checks");
    }
  } finally {
    await cleanup({
      channelIds: createdChannelIds,
      tenantCommIds: createdTenantCommIds,
      directoryMemberKeys,
    });
    console.log(
      `cleanup: removed ${createdChannelIds.length} channel(s), ${createdTenantCommIds.length} tenant communication(s), ${directoryMemberKeys.length} seeded chat identit(ies)`,
    );
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} communications check(s) FAILED:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nAll communications checks passed.");
}

main().catch((err) => {
  console.error("comms-check crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
