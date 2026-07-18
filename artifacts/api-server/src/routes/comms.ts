import { Router, type IRouter, type Request, type Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lte, ne, notInArray, or, sql } from "drizzle-orm";
import {
  db,
  chatChannelsTable,
  chatDirectoryMembersTable,
  chatMemberTokensTable,
  chatMessagesTable,
  chatReadStateTable,
  cloudUsersTable,
  companiesTable,
  companyIntegrationsTable,
  tenantCommunicationsTable,
  type ChatChannelRow,
  type CompanyIntegrationsRow,
} from "@workspace/db";
import { verifyPassword } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  requireCompany,
  resolveCompanyIdFromLicense,
  type CompanyScopedRequest,
} from "../lib/company-auth";
import {
  dispatchCompanyEvent,
  getCompanyIntegrations,
  isAllowedGoogleChatUrl,
  isAllowedSlackUrl,
  isIntegrationEvent,
  maskWebhookUrl,
  mirrorTeamChatMessage,
  sendTestMessage,
} from "../lib/notify";
import { sendTenantMessageEmail } from "../lib/email";

/**
 * Communications hub: company-scoped team chat (channels + DMs), tenant
 * communication history / email sending, and Slack / Google Chat webhook
 * integration settings.
 *
 * All routes require a company credential (license key or portal session).
 *
 * Team-chat routes (members / channels / dms / messages / read) additionally
 * require a server-validated member identity: either an `x-member-token`
 * header (minted by POST /comms/identity/token after the member proved their
 * own credentials) or a portal session. The resolved member key must match
 * any client-declared senderKey/memberKey, so a license key alone can no
 * longer impersonate senders or read other members' DMs.
 *
 * Tenant-communication log entries and integration settings remain
 * company-scoped: createdByKey/createdByName there are display snapshots on
 * an audit log, not access-control inputs.
 */
const router: IRouter = Router();

router.use("/comms", requireCompany);

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_BODY_LENGTH = 20_000;
const TENANT_COMM_KINDS = [
  "email",
  "announcement",
  "notice_served",
  "work_order",
] as const;
const LOG_KINDS = ["announcement", "notice_served", "work_order"] as const;

function companyIdOf(req: Request): string {
  return (req as CompanyScopedRequest).companyId;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function optionalString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Client-supplied timestamps are only accepted when they are valid ISO-8601
// strings (read-state and message ordering rely on lexicographic ISO
// comparison); anything else falls back to the server clock.
function clientTimestampOrNow(v: unknown): string {
  if (isNonEmptyString(v)) {
    const parsed = new Date(v);
    if (!Number.isNaN(parsed.getTime()) && v === parsed.toISOString()) {
      return v;
    }
  }
  return nowIso();
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// Privileged routes (integration management) require a server-validated
// administrator — a portal session whose user has the admin role. A license
// key alone identifies the company, not the person, so it is never enough
// for privileged writes.
function requireAdminSession(req: Request, res: Response): boolean {
  const sessionUser = (req as CompanyScopedRequest).sessionUser;
  if (!sessionUser || (sessionUser.role !== "admin" && !sessionUser.isMasterAdmin)) {
    res.status(403).json({
      error:
        "Managing integrations requires a signed-in administrator. Sign in with your admin portal account.",
      code: "admin_session_required",
    });
    return false;
  }
  return true;
}

// DMs are private to their two participants. Regular channels are open to
// the whole company, so membership is only enforced for kind "dm".
function isDmParticipant(
  channel: { kind: string; memberKeys: string[] | null },
  key: unknown,
): boolean {
  if (channel.kind !== "dm") return true;
  return isNonEmptyString(key) && (channel.memberKeys ?? []).includes(key);
}

// ---------------------------------------------------------------------------
// Member identity (server-validated)
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// Member tokens expire so a lost phone or desktop stops being able to read
// team chat after a bounded window, even if the member's password never
// changes. Clients recover by re-minting: the desktop silently refreshes at
// sign-in; mobile returns to the chat sign-in screen.
const MEMBER_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

// Sliding expiry: a token that is still being used gets its window extended,
// so a desktop left signed in for months never hits the "sign in again" card
// mid-session. Only actively-used tokens slide — a lost device that stops
// talking to the hub still dies at its original expiry, and deactivating the
// member still kills the token immediately (resolveMember re-checks the
// directory on every call).
const MEMBER_TOKEN_SLIDE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // extend when <30 days remain

/**
 * Effective ISO expiry for a token row. Legacy rows minted before expiry
 * existed have an empty expiresAt and inherit createdAt + the standard TTL.
 */
function tokenExpiryOf(row: { createdAt: string; expiresAt: string }): string {
  if (row.expiresAt !== "") return row.expiresAt;
  const created = new Date(row.createdAt).getTime();
  return new Date(
    (Number.isNaN(created) ? 0 : created) + MEMBER_TOKEN_TTL_MS,
  ).toISOString();
}

function isTokenExpired(row: { createdAt: string; expiresAt: string }): boolean {
  // Lexicographic ISO comparison, consistent with the rest of the hub.
  return tokenExpiryOf(row) <= nowIso();
}

/** Delete a company's expired token rows (opportunistic, at mint time). */
async function purgeExpiredTokens(companyId: string): Promise<void> {
  const now = nowIso();
  const legacyCutoff = new Date(Date.now() - MEMBER_TOKEN_TTL_MS).toISOString();
  await db
    .delete(chatMemberTokensTable)
    .where(
      and(
        eq(chatMemberTokensTable.companyId, companyId),
        or(
          and(
            ne(chatMemberTokensTable.expiresAt, ""),
            lte(chatMemberTokensTable.expiresAt, now),
          ),
          and(
            eq(chatMemberTokensTable.expiresAt, ""),
            lte(chatMemberTokensTable.createdAt, legacyCutoff),
          ),
        ),
      ),
    );
}

interface ResolvedMember {
  memberKey: string;
  memberName: string;
  // Server-validated: true only when the live directory (cloud users first,
  // then the replicated desktop directory) says this member is an admin.
  // Never derived from anything the client sends.
  isAdmin: boolean;
}

/**
 * Resolves the calling member from an `x-member-token` header or, failing
 * that, the portal session attached by requireCompany. Token-resolved
 * members are re-checked against the live directory (cloud users first,
 * then the replicated desktop directory) so deactivating a member kills
 * their existing tokens immediately.
 */
async function resolveMember(req: Request): Promise<ResolvedMember | null> {
  const companyId = companyIdOf(req);
  const token = req.header("x-member-token")?.trim();
  if (token) {
    const [row] = await db
      .select()
      .from(chatMemberTokensTable)
      .where(
        and(
          eq(chatMemberTokensTable.token, token),
          eq(chatMemberTokensTable.companyId, companyId),
        ),
      );
    if (!row) return null;
    if (isTokenExpired(row)) {
      // Expired tokens are dead: remove the row so it can never resolve
      // again, and let the 401 push the client through a fresh sign-in.
      await db
        .delete(chatMemberTokensTable)
        .where(eq(chatMemberTokensTable.token, row.token));
      return null;
    }
    // Sliding expiry: a token in active use by a still-active member gets
    // its expiry pushed back out to a full TTL once it drifts inside the
    // slide threshold, so a desktop left signed in for months never hits
    // the "sign in again" card mid-session.
    const slideIfNearExpiry = async (): Promise<void> => {
      const expiryMs = new Date(tokenExpiryOf(row)).getTime();
      if (
        !Number.isNaN(expiryMs) &&
        expiryMs - Date.now() < MEMBER_TOKEN_SLIDE_THRESHOLD_MS
      ) {
        await db
          .update(chatMemberTokensTable)
          .set({
            expiresAt: new Date(Date.now() + MEMBER_TOKEN_TTL_MS).toISOString(),
          })
          .where(eq(chatMemberTokensTable.token, row.token));
      }
    };
    const [cloudUser] = await db
      .select()
      .from(cloudUsersTable)
      .where(
        and(
          eq(cloudUsersTable.id, row.memberKey),
          eq(cloudUsersTable.companyId, companyId),
        ),
      );
    if (cloudUser) {
      if (!cloudUser.active) return null;
      await slideIfNearExpiry();
      return {
        memberKey: cloudUser.id,
        memberName: cloudUser.name,
        isAdmin: cloudUser.role === "admin" || cloudUser.isMasterAdmin,
      };
    }
    const [dirMember] = await db
      .select()
      .from(chatDirectoryMembersTable)
      .where(
        and(
          eq(chatDirectoryMembersTable.companyId, companyId),
          eq(chatDirectoryMembersTable.memberKey, row.memberKey),
        ),
      );
    if (dirMember) {
      if (!dirMember.active) return null;
      await slideIfNearExpiry();
      return {
        memberKey: dirMember.memberKey,
        memberName: dirMember.name,
        isAdmin: dirMember.role === "admin",
      };
    }
    return null;
  }
  const sessionUser = (req as CompanyScopedRequest).sessionUser;
  if (sessionUser) {
    return {
      memberKey: sessionUser.id,
      memberName: sessionUser.name,
      isAdmin: sessionUser.role === "admin" || sessionUser.isMasterAdmin,
    };
  }
  return null;
}

/**
 * Resolves and requires a member identity; responds 401 and returns null
 * when the caller has no valid member credential.
 */
async function requireMember(
  req: Request,
  res: Response,
): Promise<ResolvedMember | null> {
  const member = await resolveMember(req);
  if (!member) {
    res.status(401).json({
      error:
        "Team chat requires a member credential. Sign in to chat to get a member token.",
      code: "member_token_required",
    });
    return null;
  }
  return member;
}

/** 403 when a client-declared key does not match the validated member. */
function memberMismatch(res: Response): void {
  res.status(403).json({
    error: "You can only act as the member you signed in as",
    code: "member_mismatch",
  });
}

/**
 * Channel management (create/archive) is an admin action. The check uses
 * the server-resolved member role — the same directory-backed identity that
 * authenticated the request — mirroring the desktop UI, which only shows
 * these controls to admins. Responds 403 and returns false for non-admins.
 */
function requireChannelAdmin(member: ResolvedMember, res: Response): boolean {
  if (!member.isAdmin) {
    res.status(403).json({
      error: "Managing channels requires an administrator",
      code: "admin_required",
    });
    return false;
  }
  return true;
}

interface ChannelExtras {
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
}

function channelToSync(
  row: ChatChannelRow,
  extras: ChannelExtras,
): Record<string, unknown> {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    dmKey: row.dmKey,
    memberKeys: row.memberKeys ?? [],
    archived: row.archived,
    createdByKey: row.createdByKey,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
    unreadCount: extras.unreadCount,
    lastMessageAt: extras.lastMessageAt,
    lastMessagePreview: extras.lastMessagePreview,
  };
}

async function loadChannelForCompany(
  id: string,
  companyId: string,
): Promise<ChatChannelRow | null> {
  const [row] = await db
    .select()
    .from(chatChannelsTable)
    .where(
      and(eq(chatChannelsTable.id, id), eq(chatChannelsTable.companyId, companyId)),
    );
  return row ?? null;
}

async function computeChannelExtras(
  channel: ChatChannelRow,
  memberKey: string,
): Promise<ChannelExtras> {
  const [last] = await db
    .select()
    .from(chatMessagesTable)
    .where(eq(chatMessagesTable.channelId, channel.id))
    .orderBy(desc(chatMessagesTable.createdAt))
    .limit(1);

  const [readState] = await db
    .select()
    .from(chatReadStateTable)
    .where(
      and(
        eq(chatReadStateTable.channelId, channel.id),
        eq(chatReadStateTable.memberKey, memberKey),
      ),
    );

  const unreadConditions = [
    eq(chatMessagesTable.channelId, channel.id),
    ne(chatMessagesTable.senderKey, memberKey),
  ];
  if (readState) {
    unreadConditions.push(gt(chatMessagesTable.createdAt, readState.lastReadAt));
  }
  const [unread] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatMessagesTable)
    .where(and(...unreadConditions));

  return {
    unreadCount: unread?.count ?? 0,
    lastMessageAt: last?.createdAt ?? null,
    lastMessagePreview: last
      ? `${last.senderName}: ${last.body.slice(0, 120)}`
      : null,
  };
}

// ---------------------------------------------------------------------------
// Directory replication + member tokens
// ---------------------------------------------------------------------------

// PUT /api/comms/directory — replace-set of the desktop's local-only users.
// Requires a license credential (the desktop app owns these records); portal
// sessions cannot rewrite the directory.
router.put("/comms/directory", async (req, res) => {
  const companyId = companyIdOf(req);
  const licenseCompanyId = await resolveCompanyIdFromLicense(req);
  if (!licenseCompanyId || licenseCompanyId !== companyId) {
    res.status(403).json({
      error: "Directory replication requires the workspace license key",
      code: "license_required",
    });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const rawMembers = Array.isArray(body?.["members"]) ? body["members"] : null;
  if (!rawMembers) {
    res.status(400).json({ error: "members is required", code: "bad_request" });
    return;
  }
  const members = rawMembers
    .filter(
      (m): m is Record<string, unknown> => typeof m === "object" && m !== null,
    )
    .filter((m) => isNonEmptyString(m["memberKey"]) && isNonEmptyString(m["name"]))
    .map((m) => ({
      companyId,
      memberKey: (m["memberKey"] as string).trim(),
      name: (m["name"] as string).trim().slice(0, 120),
      username: optionalString(m["username"]).trim().toLowerCase().slice(0, 120),
      email: optionalString(m["email"]).trim().toLowerCase().slice(0, 254),
      role: optionalString(m["role"]).slice(0, 40) || "staff",
      active: m["active"] !== false,
      secretHash: /^[0-9a-f]{64}$/i.test(optionalString(m["secretHash"]))
        ? optionalString(m["secretHash"]).toLowerCase()
        : "",
      updatedAt: nowIso(),
    }));
  // Deduplicate by memberKey (last write wins) to keep the upsert stable.
  const byKey = new Map(members.map((m) => [m.memberKey, m]));
  const deduped = [...byKey.values()];

  await db.transaction(async (tx) => {
    if (deduped.length > 0) {
      await tx
        .insert(chatDirectoryMembersTable)
        .values(deduped)
        .onConflictDoUpdate({
          target: [
            chatDirectoryMembersTable.companyId,
            chatDirectoryMembersTable.memberKey,
          ],
          set: {
            name: sql`excluded.name`,
            username: sql`excluded.username`,
            email: sql`excluded.email`,
            role: sql`excluded.role`,
            active: sql`excluded.active`,
            secretHash: sql`excluded.secret_hash`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
      await tx
        .delete(chatDirectoryMembersTable)
        .where(
          and(
            eq(chatDirectoryMembersTable.companyId, companyId),
            notInArray(
              chatDirectoryMembersTable.memberKey,
              deduped.map((m) => m.memberKey),
            ),
          ),
        );
    } else {
      await tx
        .delete(chatDirectoryMembersTable)
        .where(eq(chatDirectoryMembersTable.companyId, companyId));
    }
    // Kill tokens of removed or deactivated directory members. Cloud-user
    // tokens are unaffected: their keys never appear in this replica.
    const activeKeys = deduped.filter((m) => m.active).map((m) => m.memberKey);
    const cloudUsers = await tx
      .select({ id: cloudUsersTable.id })
      .from(cloudUsersTable)
      .where(eq(cloudUsersTable.companyId, companyId));
    const keep = [...activeKeys, ...cloudUsers.map((u) => u.id)];
    await tx
      .delete(chatMemberTokensTable)
      .where(
        keep.length > 0
          ? and(
              eq(chatMemberTokensTable.companyId, companyId),
              notInArray(chatMemberTokensTable.memberKey, keep),
            )
          : eq(chatMemberTokensTable.companyId, companyId),
      );
  });
  res.json({ ok: true, count: deduped.length });
});

// POST /api/comms/identity/token — the member proves who they are with their
// own credentials (cloud email/username + password, or the desktop-local
// username/email + password) and receives a chat member token.
router.post("/comms/identity/token", async (req, res) => {
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  if (!isNonEmptyString(body?.["identifier"]) || !isNonEmptyString(body?.["secret"])) {
    res.status(400).json({
      error: "identifier and secret are required",
      code: "bad_request",
    });
    return;
  }
  const identifier = body["identifier"].trim().toLowerCase();
  const secret = body["secret"];

  let resolved: ResolvedMember | null = null;

  // 1) Cloud users — the authoritative directory. Matched by email or the
  //    admin-chosen username; verified against the scrypt password hash.
  const cloudUsers = await db
    .select()
    .from(cloudUsersTable)
    .where(
      and(eq(cloudUsersTable.companyId, companyId), eq(cloudUsersTable.active, true)),
    );
  const cloudMatch = cloudUsers.find(
    (u) =>
      u.email.toLowerCase() === identifier ||
      (u.username ?? "").toLowerCase() === identifier,
  );
  if (cloudMatch?.passwordHash && verifyPassword(secret, cloudMatch.passwordHash)) {
    resolved = {
      memberKey: cloudMatch.id,
      memberName: cloudMatch.name,
      isAdmin: cloudMatch.role === "admin" || cloudMatch.isMasterAdmin,
    };
  }

  // 2) Replicated desktop-local members — verified against the SHA-256
  //    password hash the desktop pushed.
  if (!resolved) {
    const dirMembers = await db
      .select()
      .from(chatDirectoryMembersTable)
      .where(
        and(
          eq(chatDirectoryMembersTable.companyId, companyId),
          eq(chatDirectoryMembersTable.active, true),
        ),
      );
    const dirMatch = dirMembers.find(
      (m) =>
        m.username === identifier ||
        (m.email !== "" && m.email === identifier) ||
        m.memberKey === body["identifier"],
    );
    if (
      dirMatch &&
      dirMatch.secretHash !== "" &&
      dirMatch.secretHash === sha256Hex(secret)
    ) {
      resolved = {
        memberKey: dirMatch.memberKey,
        memberName: dirMatch.name,
        isAdmin: dirMatch.role === "admin",
      };
    }
  }

  if (!resolved) {
    res.status(401).json({
      error: "Email/username or password is incorrect",
      code: "bad_credentials",
    });
    return;
  }

  // Keep the table from accumulating dead rows: every mint sweeps the
  // company's expired tokens (rotation replaces tokens, it never revives them).
  await purgeExpiredTokens(companyId);

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + MEMBER_TOKEN_TTL_MS).toISOString();
  await db.insert(chatMemberTokensTable).values({
    token,
    companyId,
    memberKey: resolved.memberKey,
    memberName: resolved.memberName,
    createdAt: nowIso(),
    expiresAt,
  });
  res.json({
    token,
    memberKey: resolved.memberKey,
    memberName: resolved.memberName,
    expiresAt,
  });
});

// ---------------------------------------------------------------------------
// Team members
// ---------------------------------------------------------------------------

// GET /api/comms/members
router.get("/comms/members", async (req, res) => {
  if (!(await requireMember(req, res))) return;
  const companyId = companyIdOf(req);
  const users = await db
    .select()
    .from(cloudUsersTable)
    .where(
      and(eq(cloudUsersTable.companyId, companyId), eq(cloudUsersTable.active, true)),
    );
  const dirMembers = await db
    .select()
    .from(chatDirectoryMembersTable)
    .where(
      and(
        eq(chatDirectoryMembersTable.companyId, companyId),
        eq(chatDirectoryMembersTable.active, true),
      ),
    );
  const cloudIds = new Set(users.map((u) => u.id));
  const merged = [
    ...users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
    })),
    ...dirMembers
      .filter((m) => !cloudIds.has(m.memberKey))
      .map((m) => ({
        id: m.memberKey,
        name: m.name,
        email: m.email,
        role: m.role,
        active: m.active,
      })),
  ];
  merged.sort((a, b) => a.name.localeCompare(b.name));
  res.json(merged);
});

// ---------------------------------------------------------------------------
// Channels + DMs
// ---------------------------------------------------------------------------

// GET /api/comms/channels?memberKey=
router.get("/comms/channels", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  const companyId = companyIdOf(req);
  const queryKey = req.query["memberKey"];
  if (isNonEmptyString(queryKey) && queryKey !== member.memberKey) {
    memberMismatch(res);
    return;
  }
  const memberKey = member.memberKey;
  const rows = await db
    .select()
    .from(chatChannelsTable)
    .where(eq(chatChannelsTable.companyId, companyId));

  const visible = rows.filter(
    (r) =>
      r.kind === "channel" ||
      (r.kind === "dm" && (r.memberKeys ?? []).includes(memberKey)),
  );

  const result = await Promise.all(
    visible.map(async (channel) =>
      channelToSync(channel, await computeChannelExtras(channel, memberKey)),
    ),
  );
  // Channels first (alphabetical), then DMs by recency.
  result.sort((a, b) => {
    if (a["kind"] !== b["kind"]) return a["kind"] === "channel" ? -1 : 1;
    if (a["kind"] === "channel") {
      return String(a["name"]).localeCompare(String(b["name"]));
    }
    return String(b["lastMessageAt"] ?? "").localeCompare(
      String(a["lastMessageAt"] ?? ""),
    );
  });
  res.json(result);
});

// POST /api/comms/channels — admin only (server-validated role)
router.post("/comms/channels", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!requireChannelAdmin(member, res)) return;
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  if (
    !isNonEmptyString(body?.["name"]) ||
    !isNonEmptyString(body?.["createdByKey"]) ||
    !isNonEmptyString(body?.["createdByName"])
  ) {
    res.status(400).json({
      error: "name, createdByKey and createdByName are required",
      code: "bad_request",
    });
    return;
  }
  if (body["createdByKey"] !== member.memberKey) {
    memberMismatch(res);
    return;
  }
  const name = body["name"].trim().slice(0, 80);
  const existing = await db
    .select()
    .from(chatChannelsTable)
    .where(
      and(
        eq(chatChannelsTable.companyId, companyId),
        eq(chatChannelsTable.kind, "channel"),
      ),
    );
  const duplicate = existing.find(
    (c) => !c.archived && c.name.toLowerCase() === name.toLowerCase(),
  );
  if (duplicate) {
    res.status(409).json({
      error: "A channel with this name already exists",
      code: "duplicate_channel",
    });
    return;
  }
  const [row] = await db
    .insert(chatChannelsTable)
    .values({
      companyId,
      kind: "channel",
      name,
      dmKey: null,
      memberKeys: [],
      createdByKey: body["createdByKey"],
      createdByName: body["createdByName"],
      createdAt: nowIso(),
    })
    .returning();
  logger.info(
    {
      audit: "channel_create",
      companyId,
      channelId: row.id,
      channelName: row.name,
      memberKey: member.memberKey,
    },
    "comms: channel created",
  );
  res.json(
    channelToSync(row, {
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    }),
  );
});

// POST /api/comms/channels/:id/archive — admin only (server-validated role)
router.post("/comms/channels/:id/archive", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  if (!requireChannelAdmin(member, res)) return;
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  if (typeof body?.["archived"] !== "boolean") {
    res.status(400).json({ error: "archived is required", code: "bad_request" });
    return;
  }
  const channel = await loadChannelForCompany(req.params.id, companyId);
  if (!channel || channel.kind !== "channel") {
    res.status(404).json({ error: "Channel not found", code: "not_found" });
    return;
  }
  const [row] = await db
    .update(chatChannelsTable)
    .set({ archived: body["archived"] })
    .where(eq(chatChannelsTable.id, channel.id))
    .returning();
  logger.info(
    {
      audit: "channel_archive",
      companyId,
      channelId: channel.id,
      channelName: channel.name,
      archived: body["archived"],
      memberKey: member.memberKey,
    },
    "comms: channel archive state changed",
  );
  res.json(
    channelToSync(row, {
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    }),
  );
});

// POST /api/comms/dms — get-or-create by member pair
router.post("/comms/dms", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  const memberKeys = Array.isArray(body?.["memberKeys"])
    ? (body["memberKeys"] as unknown[]).filter(isNonEmptyString)
    : [];
  const memberNames = Array.isArray(body?.["memberNames"])
    ? (body["memberNames"] as unknown[]).filter(
        (n): n is string => typeof n === "string",
      )
    : [];
  if (
    memberKeys.length !== 2 ||
    memberKeys[0] === memberKeys[1] ||
    memberNames.length !== 2 ||
    !isNonEmptyString(body?.["createdByKey"]) ||
    !isNonEmptyString(body?.["createdByName"])
  ) {
    res.status(400).json({
      error:
        "memberKeys (two distinct), memberNames, createdByKey and createdByName are required",
      code: "bad_request",
    });
    return;
  }
  if (
    body["createdByKey"] !== member.memberKey ||
    !memberKeys.includes(member.memberKey)
  ) {
    memberMismatch(res);
    return;
  }
  const sortedKeys = [...memberKeys].sort();
  const dmKey = sortedKeys.join(":");
  const [existing] = await db
    .select()
    .from(chatChannelsTable)
    .where(
      and(
        eq(chatChannelsTable.companyId, companyId),
        eq(chatChannelsTable.dmKey, dmKey),
      ),
    );
  const requesterKey = body["createdByKey"];
  if (existing) {
    res.json(
      channelToSync(existing, await computeChannelExtras(existing, requesterKey)),
    );
    return;
  }
  const [row] = await db
    .insert(chatChannelsTable)
    .values({
      companyId,
      kind: "dm",
      name: memberNames.join(" & ").slice(0, 120),
      dmKey,
      memberKeys: sortedKeys,
      createdByKey: requesterKey,
      createdByName: body["createdByName"],
      createdAt: nowIso(),
    })
    .returning();
  res.json(
    channelToSync(row, {
      unreadCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    }),
  );
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

// GET /api/comms/channels/:id/messages?after=&limit=
router.get("/comms/channels/:id/messages", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  const companyId = companyIdOf(req);
  const queryKey = req.query["memberKey"];
  if (isNonEmptyString(queryKey) && queryKey !== member.memberKey) {
    memberMismatch(res);
    return;
  }
  const channel = await loadChannelForCompany(req.params.id, companyId);
  if (!channel) {
    res.status(404).json({ error: "Channel not found", code: "not_found" });
    return;
  }
  if (!isDmParticipant(channel, member.memberKey)) {
    res.status(403).json({
      error: "Only the two DM participants may read this conversation",
      code: "forbidden",
    });
    return;
  }
  const after = req.query["after"];
  const rawLimit = Number(req.query["limit"]);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 200;

  const conditions = [eq(chatMessagesTable.channelId, channel.id)];
  if (isNonEmptyString(after)) {
    conditions.push(gt(chatMessagesTable.createdAt, after));
  }
  const rows = await db
    .select()
    .from(chatMessagesTable)
    .where(and(...conditions))
    .orderBy(
      isNonEmptyString(after)
        ? asc(chatMessagesTable.createdAt)
        : desc(chatMessagesTable.createdAt),
    )
    .limit(limit);
  // Without `after` we fetched the newest N — restore chronological order.
  const ordered = isNonEmptyString(after) ? rows : [...rows].reverse();
  res.json(
    ordered.map((m) => ({
      id: m.id,
      channelId: m.channelId,
      senderKey: m.senderKey,
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt,
    })),
  );
});

// POST /api/comms/channels/:id/messages — idempotent by client message id
router.post("/comms/channels/:id/messages", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  if (
    !isNonEmptyString(body?.["id"]) ||
    !isNonEmptyString(body?.["senderKey"]) ||
    !isNonEmptyString(body?.["senderName"]) ||
    !isNonEmptyString(body?.["body"])
  ) {
    res.status(400).json({
      error: "id, senderKey, senderName and body are required",
      code: "bad_request",
    });
    return;
  }
  if (body["senderKey"] !== member.memberKey) {
    memberMismatch(res);
    return;
  }
  const channel = await loadChannelForCompany(req.params.id, companyId);
  if (!channel) {
    res.status(404).json({ error: "Channel not found", code: "not_found" });
    return;
  }
  if (channel.archived) {
    res.status(400).json({ error: "Channel is archived", code: "archived" });
    return;
  }
  if (!isDmParticipant(channel, member.memberKey)) {
    res.status(403).json({
      error: "Only the two DM participants may post to this conversation",
      code: "forbidden",
    });
    return;
  }
  const messageId = body["id"];
  const [existing] = await db
    .select()
    .from(chatMessagesTable)
    .where(
      and(
        eq(chatMessagesTable.id, messageId),
        eq(chatMessagesTable.companyId, companyId),
      ),
    );
  if (existing) {
    res.json({
      id: existing.id,
      channelId: existing.channelId,
      senderKey: existing.senderKey,
      senderName: existing.senderName,
      body: existing.body,
      createdAt: existing.createdAt,
    });
    return;
  }
  const text = body["body"].slice(0, MAX_MESSAGE_LENGTH);
  const createdAt = clientTimestampOrNow(body["createdAt"]);
  const [row] = await db
    .insert(chatMessagesTable)
    .values({
      id: messageId,
      channelId: channel.id,
      companyId,
      senderKey: body["senderKey"],
      senderName: body["senderName"],
      body: text,
      createdAt,
    })
    .returning();

  // Mark the channel read for the sender up to their own message.
  await upsertReadState(channel.id, row.senderKey, row.createdAt);

  if (channel.kind === "channel") {
    mirrorTeamChatMessage(companyId, channel.name, row.senderName, row.body);
  }

  res.json({
    id: row.id,
    channelId: row.channelId,
    senderKey: row.senderKey,
    senderName: row.senderName,
    body: row.body,
    createdAt: row.createdAt,
  });
});

async function upsertReadState(
  channelId: string,
  memberKey: string,
  lastReadAt: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(chatReadStateTable)
    .where(
      and(
        eq(chatReadStateTable.channelId, channelId),
        eq(chatReadStateTable.memberKey, memberKey),
      ),
    );
  if (!existing) {
    await db
      .insert(chatReadStateTable)
      .values({ channelId, memberKey, lastReadAt });
  } else if (existing.lastReadAt < lastReadAt) {
    await db
      .update(chatReadStateTable)
      .set({ lastReadAt })
      .where(eq(chatReadStateTable.id, existing.id));
  }
}

// POST /api/comms/channels/:id/read
router.post("/comms/channels/:id/read", async (req, res) => {
  const member = await requireMember(req, res);
  if (!member) return;
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  if (
    !isNonEmptyString(body?.["memberKey"]) ||
    !isNonEmptyString(body?.["lastReadAt"])
  ) {
    res.status(400).json({
      error: "memberKey and lastReadAt are required",
      code: "bad_request",
    });
    return;
  }
  if (body["memberKey"] !== member.memberKey) {
    memberMismatch(res);
    return;
  }
  const channel = await loadChannelForCompany(req.params.id, companyId);
  if (!channel) {
    res.status(404).json({ error: "Channel not found", code: "not_found" });
    return;
  }
  if (!isDmParticipant(channel, member.memberKey)) {
    res.status(403).json({
      error: "Only the two DM participants may update read state",
      code: "forbidden",
    });
    return;
  }
  // Normalize the client-supplied timestamp the same way message timestamps
  // are handled so malformed values cannot skew unread calculations.
  await upsertReadState(
    channel.id,
    body["memberKey"],
    clientTimestampOrNow(body["lastReadAt"]),
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Tenant communications
// ---------------------------------------------------------------------------

function tenantCommToSync(
  row: typeof tenantCommunicationsTable.$inferSelect,
): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenantId,
    tenantName: row.tenantName,
    tenantEmail: row.tenantEmail,
    propertyAddress: row.propertyAddress,
    kind: row.kind,
    subject: row.subject,
    bodyText: row.bodyText,
    status: row.status,
    createdByKey: row.createdByKey,
    createdByName: row.createdByName,
    createdAt: row.createdAt,
  };
}

// GET /api/comms/tenant-communications?tenantId=&limit=
router.get("/comms/tenant-communications", async (req, res) => {
  const companyId = companyIdOf(req);
  const tenantId = req.query["tenantId"];
  const rawLimit = Number(req.query["limit"]);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;
  const conditions = [eq(tenantCommunicationsTable.companyId, companyId)];
  if (isNonEmptyString(tenantId)) {
    conditions.push(eq(tenantCommunicationsTable.tenantId, tenantId));
  }
  const rows = await db
    .select()
    .from(tenantCommunicationsTable)
    .where(and(...conditions))
    .orderBy(desc(tenantCommunicationsTable.createdAt))
    .limit(limit);
  res.json(rows.map(tenantCommToSync));
});

// POST /api/comms/tenant-communications — log-only entry (no email)
router.post("/comms/tenant-communications", async (req, res) => {
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  const kind = body?.["kind"];
  if (
    !isNonEmptyString(body?.["tenantId"]) ||
    !isNonEmptyString(kind) ||
    !(LOG_KINDS as readonly string[]).includes(kind)
  ) {
    res.status(400).json({
      error: `tenantId and kind (${LOG_KINDS.join(", ")}) are required`,
      code: "bad_request",
    });
    return;
  }
  const [row] = await db
    .insert(tenantCommunicationsTable)
    .values({
      companyId,
      tenantId: body["tenantId"],
      tenantName: optionalString(body["tenantName"]),
      tenantEmail: optionalString(body["tenantEmail"]),
      propertyAddress: optionalString(body["propertyAddress"]),
      kind,
      subject: optionalString(body["subject"]).slice(0, 300),
      bodyText: optionalString(body["bodyText"]).slice(0, MAX_BODY_LENGTH),
      status: "logged",
      createdByKey: optionalString(body["createdByKey"]),
      createdByName: optionalString(body["createdByName"]),
      createdAt: clientTimestampOrNow(body["createdAt"]),
    })
    .returning();

  if (kind === "notice_served" && body["suppressEvent"] !== true) {
    const location = row.propertyAddress ? ` at ${row.propertyAddress}` : "";
    dispatchCompanyEvent(
      companyId,
      "notice_served",
      `Notice served: ${row.tenantName || row.tenantId}${location}${row.subject ? ` — ${row.subject}` : ""}`,
    );
  }

  res.json(tenantCommToSync(row));
});

// POST /api/comms/tenant-email — send + log
router.post("/comms/tenant-email", async (req, res) => {
  const companyId = companyIdOf(req);
  const body = req.body as Record<string, unknown>;
  if (
    !isNonEmptyString(body?.["tenantId"]) ||
    !isNonEmptyString(body?.["tenantName"]) ||
    !isNonEmptyString(body?.["tenantEmail"]) ||
    !isNonEmptyString(body?.["subject"]) ||
    !isNonEmptyString(body?.["bodyText"])
  ) {
    res.status(400).json({
      error: "tenantId, tenantName, tenantEmail, subject and bodyText are required",
      code: "bad_request",
    });
    return;
  }
  const tenantEmail = body["tenantEmail"].trim();
  if (!isEmail(tenantEmail)) {
    res.status(400).json({
      error: "tenantEmail is not a valid email address",
      code: "invalid_email",
    });
    return;
  }

  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId));

  const sent = await sendTenantMessageEmail({
    to: tenantEmail,
    subject: body["subject"].trim().slice(0, 300),
    bodyText: body["bodyText"].slice(0, MAX_BODY_LENGTH),
    companyName: company?.name ?? "Your property manager",
  });

  const [row] = await db
    .insert(tenantCommunicationsTable)
    .values({
      companyId,
      tenantId: body["tenantId"],
      tenantName: body["tenantName"].trim(),
      tenantEmail,
      propertyAddress: optionalString(body["propertyAddress"]),
      kind: "email",
      subject: body["subject"].trim().slice(0, 300),
      bodyText: body["bodyText"].slice(0, MAX_BODY_LENGTH),
      status: sent ? "sent" : "failed",
      createdByKey: optionalString(body["createdByKey"]),
      createdByName: optionalString(body["createdByName"]),
      createdAt: nowIso(),
    })
    .returning();

  if (sent) {
    dispatchCompanyEvent(
      companyId,
      "tenant_email_sent",
      `Email sent to ${row.tenantName} (${row.tenantEmail}): ${row.subject}`,
    );
  }

  res.json(tenantCommToSync(row));
});

// ---------------------------------------------------------------------------
// Integrations (Slack / Google Chat webhooks)
// ---------------------------------------------------------------------------

function integrationsToSync(
  row: CompanyIntegrationsRow | null,
): Record<string, unknown> {
  return {
    slackConfigured: Boolean(row?.slackWebhookUrl),
    googleChatConfigured: Boolean(row?.googleChatWebhookUrl),
    slackWebhookUrlMasked: row?.slackWebhookUrl
      ? maskWebhookUrl(row.slackWebhookUrl)
      : "",
    googleChatWebhookUrlMasked: row?.googleChatWebhookUrl
      ? maskWebhookUrl(row.googleChatWebhookUrl)
      : "",
    events: row?.events ?? [],
    mirrorTeamChat: row?.mirrorTeamChat ?? false,
    updatedAt: row?.updatedAt ?? null,
  };
}

// GET /api/comms/integrations
router.get("/comms/integrations", async (req, res) => {
  const row = await getCompanyIntegrations(companyIdOf(req));
  res.json(integrationsToSync(row));
});

// PUT /api/comms/integrations — admin-only (server-validated portal session)
router.put("/comms/integrations", async (req, res) => {
  const companyId = companyIdOf(req);
  if (!requireAdminSession(req, res)) return;
  const body = req.body as Record<string, unknown>;

  const slackUrl =
    typeof body?.["slackWebhookUrl"] === "string"
      ? body["slackWebhookUrl"].trim()
      : undefined;
  if (slackUrl !== undefined && slackUrl !== "" && !isAllowedSlackUrl(slackUrl)) {
    res.status(400).json({
      error: "Slack webhook URLs must start with https://hooks.slack.com/",
      code: "invalid_webhook_url",
    });
    return;
  }
  const googleUrl =
    typeof body?.["googleChatWebhookUrl"] === "string"
      ? body["googleChatWebhookUrl"].trim()
      : undefined;
  if (
    googleUrl !== undefined &&
    googleUrl !== "" &&
    !isAllowedGoogleChatUrl(googleUrl)
  ) {
    res.status(400).json({
      error:
        "Google Chat webhook URLs must start with https://chat.googleapis.com/",
      code: "invalid_webhook_url",
    });
    return;
  }
  const events = Array.isArray(body?.["events"])
    ? (body["events"] as unknown[]).filter(isIntegrationEvent)
    : undefined;
  const mirrorTeamChat =
    typeof body?.["mirrorTeamChat"] === "boolean"
      ? body["mirrorTeamChat"]
      : undefined;

  const existing = await getCompanyIntegrations(companyId);
  const next = {
    slackWebhookUrl: slackUrl ?? existing?.slackWebhookUrl ?? "",
    googleChatWebhookUrl: googleUrl ?? existing?.googleChatWebhookUrl ?? "",
    events: events ?? existing?.events ?? [],
    mirrorTeamChat: mirrorTeamChat ?? existing?.mirrorTeamChat ?? false,
    updatedAt: nowIso(),
  };

  let row: CompanyIntegrationsRow;
  if (existing) {
    const [updated] = await db
      .update(companyIntegrationsTable)
      .set(next)
      .where(eq(companyIntegrationsTable.companyId, companyId))
      .returning();
    row = updated;
  } else {
    const [inserted] = await db
      .insert(companyIntegrationsTable)
      .values({ companyId, ...next })
      .returning();
    row = inserted;
  }
  res.json(integrationsToSync(row));
});

// POST /api/comms/integrations/test — admin-only (server-validated portal session)
router.post("/comms/integrations/test", async (req, res) => {
  if (!requireAdminSession(req, res)) return;
  const body = req.body as Record<string, unknown>;
  const target = body?.["target"];
  if (target !== "slack" && target !== "google_chat") {
    res.status(400).json({
      error: "target must be slack or google_chat",
      code: "bad_request",
    });
    return;
  }
  const result = await sendTestMessage(companyIdOf(req), target);
  res.json(result);
});

export default router;
