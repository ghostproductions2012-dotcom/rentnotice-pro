import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  attorneyReferralsTable,
  attorneyReferralEventsTable,
  attorneyReferralRepliesTable,
  attorneyReferralUploadsTable,
  companiesTable,
  type AttorneyReferralRow,
  type AttorneyReferralEventRow,
  type AttorneyReferralReplyRow,
  type AttorneyReferralUploadRow,
} from "@workspace/db";
import { requireFieldAuth, requireLicenseAuth } from "../lib/fieldAuth";
import { sendAttorneyReferralEmail } from "../lib/email";
import { getPublicBaseUrl } from "../lib/stripeData";
import { logger } from "../lib/logger";

// Attorney secure-link referrals.
//
// Desktop routes (/api/attorney-referrals/*) require the license key: they
// create the referral (uploading the attorney packet), list activity, and
// revoke/re-send links.
//
// Public routes (/api/attorney/case/:token/*) are authenticated by the
// high-entropy token alone — no account. Every attorney action is recorded
// as a timeline event, most importantly packet downloads.

const router: IRouter = Router();

const REFERRAL_TTL_DAYS = 30;
// Upload constraints (attorney -> landlord documents).
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ALLOWED_UPLOAD_MIMES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
// Packet limit (desktop -> server). Base64 inflates ~4/3.
const MAX_PACKET_BYTES = 20 * 1024 * 1024;

function generateReferralToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashReferralToken(raw: string): string {
  return createHash("sha256").update(raw.trim()).digest("hex");
}

function caseUrl(token: string): string {
  return `${getPublicBaseUrl()}/attorney/${token}`;
}

function base64Bytes(b64: string): number {
  // Approximate decoded size without buffering the whole payload.
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

// Buffer.from(..., "base64") silently tolerates garbage, so malformed
// payloads would otherwise be stored and only blow up later when the
// desktop imports them. Validate the alphabet and padding up front.
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function isValidBase64(b64: string): boolean {
  return b64.length % 4 === 0 && BASE64_RE.test(b64);
}

function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ------------------------- lightweight rate limiting -------------------------
// Public token routes are unauthenticated; keep a small in-memory per-IP
// bucket so the token space can't be probed quickly. Best-effort (resets on
// restart), which is fine for 256-bit tokens.

const RATE_WINDOW_MS = 5 * 60 * 1000;
const RATE_MAX = 120;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function publicRateLimit(req: Request, res: Response, next: () => void): void {
  const now = Date.now();
  const key = req.ip ?? "unknown";
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
    next();
    return;
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    res.status(429).json({ message: "Too many requests. Try again shortly." });
    return;
  }
  next();
  // Opportunistic cleanup so the map doesn't grow unbounded.
  if (rateBuckets.size > 10_000) {
    for (const [k, b] of rateBuckets) {
      if (b.resetAt <= now) rateBuckets.delete(k);
    }
  }
}

// ------------------------------- payload shaping -----------------------------

function eventPayload(e: AttorneyReferralEventRow) {
  return {
    id: e.id,
    kind: e.kind,
    detail: e.detail,
    createdAt: e.createdAt.toISOString(),
  };
}

function replyPayload(r: AttorneyReferralReplyRow) {
  return { id: r.id, body: r.body, createdAt: r.createdAt.toISOString() };
}

function uploadMetaPayload(u: AttorneyReferralUploadRow) {
  return {
    id: u.id,
    fileName: u.fileName,
    mimeType: u.mimeType,
    sizeBytes: u.sizeBytes,
    note: u.note,
    createdAt: u.createdAt.toISOString(),
  };
}

function referralPayload(
  row: AttorneyReferralRow,
  events: AttorneyReferralEventRow[],
  replies: AttorneyReferralReplyRow[],
  uploads: AttorneyReferralUploadRow[],
) {
  const downloads = events.filter((e) => e.kind === "downloaded");
  return {
    id: row.id,
    noticeId: row.noticeId,
    attorneyName: row.attorneyName,
    attorneyEmail: row.attorneyEmail,
    message: row.message,
    status: row.status,
    tokenSuffix: row.tokenSuffix,
    expiresAt: row.expiresAt.toISOString(),
    expired: row.expiresAt.getTime() < Date.now(),
    packetFileName: row.packetFileName,
    packetSizeBytes: row.packetSizeBytes,
    packetPageCount: row.packetPageCount,
    courtDate: row.courtDate,
    courtCaseNumber: row.courtCaseNumber,
    courtNotes: row.courtNotes,
    downloadCount: downloads.length,
    lastDownloadedAt:
      downloads.length > 0
        ? downloads[downloads.length - 1]!.createdAt.toISOString()
        : null,
    events: events.map(eventPayload),
    replies: replies.map(replyPayload),
    uploads: uploads.map(uploadMetaPayload),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function logEvent(
  referralId: string,
  kind: string,
  detail = "",
): Promise<void> {
  await db
    .insert(attorneyReferralEventsTable)
    .values({ referralId, kind, detail });
}

async function touchReferral(id: string): Promise<void> {
  await db
    .update(attorneyReferralsTable)
    .set({ updatedAt: new Date() })
    .where(eq(attorneyReferralsTable.id, id));
}

async function loadActivity(referralIds: string[]): Promise<{
  events: Map<string, AttorneyReferralEventRow[]>;
  replies: Map<string, AttorneyReferralReplyRow[]>;
  uploads: Map<string, AttorneyReferralUploadRow[]>;
}> {
  const events = new Map<string, AttorneyReferralEventRow[]>();
  const replies = new Map<string, AttorneyReferralReplyRow[]>();
  const uploads = new Map<string, AttorneyReferralUploadRow[]>();
  if (referralIds.length === 0) return { events, replies, uploads };

  const [eventRows, replyRows, uploadRows] = await Promise.all([
    db
      .select()
      .from(attorneyReferralEventsTable)
      .where(inArray(attorneyReferralEventsTable.referralId, referralIds))
      .orderBy(asc(attorneyReferralEventsTable.createdAt)),
    db
      .select()
      .from(attorneyReferralRepliesTable)
      .where(inArray(attorneyReferralRepliesTable.referralId, referralIds))
      .orderBy(asc(attorneyReferralRepliesTable.createdAt)),
    db
      .select({
        id: attorneyReferralUploadsTable.id,
        referralId: attorneyReferralUploadsTable.referralId,
        fileName: attorneyReferralUploadsTable.fileName,
        mimeType: attorneyReferralUploadsTable.mimeType,
        sizeBytes: attorneyReferralUploadsTable.sizeBytes,
        note: attorneyReferralUploadsTable.note,
        createdAt: attorneyReferralUploadsTable.createdAt,
      })
      .from(attorneyReferralUploadsTable)
      .where(inArray(attorneyReferralUploadsTable.referralId, referralIds))
      .orderBy(asc(attorneyReferralUploadsTable.createdAt)),
  ]);
  for (const e of eventRows) {
    const list = events.get(e.referralId) ?? [];
    list.push(e);
    events.set(e.referralId, list);
  }
  for (const r of replyRows) {
    const list = replies.get(r.referralId) ?? [];
    list.push(r);
    replies.set(r.referralId, list);
  }
  for (const u of uploadRows) {
    const list = uploads.get(u.referralId) ?? [];
    list.push(u as AttorneyReferralUploadRow);
    uploads.set(u.referralId, list);
  }
  return { events, replies, uploads };
}

// ============================ desktop routes =================================

router.use("/attorney-referrals", requireFieldAuth, requireLicenseAuth);

// POST /api/attorney-referrals — create a referral + email the secure link.
router.post("/attorney-referrals", async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown> | undefined;
    const noticeId = str(body?.["noticeId"]).trim();
    const attorneyName = str(body?.["attorneyName"]).trim();
    const attorneyEmail = str(body?.["attorneyEmail"]).trim();
    const message = str(body?.["message"]).trim();
    const packet = body?.["packet"] as Record<string, unknown> | undefined;
    const packetFileName = str(packet?.["fileName"]).trim();
    const packetBase64 = str(packet?.["dataBase64"]);
    const packetPageCount = Number(packet?.["pageCount"]) || 1;

    if (!noticeId || !attorneyName || !attorneyEmail) {
      res.status(400).json({
        message: "noticeId, attorneyName and attorneyEmail are required",
      });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attorneyEmail)) {
      res.status(400).json({ message: "attorneyEmail is not a valid email" });
      return;
    }
    if (!packetFileName || !packetBase64) {
      res.status(400).json({ message: "packet fileName and dataBase64 are required" });
      return;
    }
    if (!isValidBase64(packetBase64)) {
      res.status(400).json({ message: "packet dataBase64 is not valid base64" });
      return;
    }
    const packetSizeBytes = base64Bytes(packetBase64);
    if (packetSizeBytes > MAX_PACKET_BYTES) {
      res.status(413).json({ message: "Packet exceeds the 20 MB limit" });
      return;
    }

    const tenantNamesRaw = body?.["tenantNames"];
    const tenantNames = Array.isArray(tenantNamesRaw)
      ? tenantNamesRaw.filter((n): n is string => typeof n === "string")
      : [];

    const token = generateReferralToken();
    const expiresAt = new Date(
      Date.now() + REFERRAL_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const [created] = await db
      .insert(attorneyReferralsTable)
      .values({
        companyId: req.fieldAuth!.companyId,
        noticeId,
        attorneyName,
        attorneyEmail,
        message,
        tokenHash: hashReferralToken(token),
        tokenSuffix: token.slice(-4),
        expiresAt,
        packetFileName,
        packetBase64,
        packetSizeBytes,
        packetPageCount,
        tenantNames,
        propertyAddress: str(body?.["propertyAddress"]),
        unit: str(body?.["unit"]),
        noticeType: str(body?.["noticeType"]),
        jurisdiction: str(body?.["jurisdiction"]),
        deadlineDate: isIsoDate(body?.["deadlineDate"])
          ? (body!["deadlineDate"] as string)
          : null,
        totalAmountCents:
          typeof body?.["totalAmountCents"] === "number"
            ? Math.round(body["totalAmountCents"])
            : null,
      })
      .returning();

    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, req.fieldAuth!.companyId));
    const companyName = company?.name ?? "A RentNotice Pro customer";

    const emailSent = await sendAttorneyReferralEmail({
      to: attorneyEmail,
      attorneyName,
      companyName,
      propertyAddress: created!.propertyAddress,
      unit: created!.unit,
      tenantNames,
      message,
      caseUrl: caseUrl(token),
      expiresAt,
    });
    await logEvent(
      created!.id,
      "sent",
      emailSent
        ? `Secure link emailed to ${attorneyEmail}`
        : `Email to ${attorneyEmail} failed — link available for manual sharing`,
    );

    const { events, replies, uploads } = await loadActivity([created!.id]);
    res.status(201).json({
      ...referralPayload(
        created!,
        events.get(created!.id) ?? [],
        replies.get(created!.id) ?? [],
        uploads.get(created!.id) ?? [],
      ),
      // One-time reveal: the plaintext link exists only in create/resend
      // responses. The desktop stores it locally for re-copying.
      link: caseUrl(token),
      emailSent,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/attorney-referrals?noticeId= — list referrals with activity.
router.get("/attorney-referrals", async (req, res, next) => {
  try {
    const noticeId = typeof req.query.noticeId === "string" ? req.query.noticeId : "";
    const where = noticeId
      ? and(
          eq(attorneyReferralsTable.companyId, req.fieldAuth!.companyId),
          eq(attorneyReferralsTable.noticeId, noticeId),
        )
      : eq(attorneyReferralsTable.companyId, req.fieldAuth!.companyId);
    const rows = await db
      .select()
      .from(attorneyReferralsTable)
      .where(where)
      .orderBy(desc(attorneyReferralsTable.createdAt));
    const { events, replies, uploads } = await loadActivity(rows.map((r) => r.id));
    res.json(
      rows.map((row) =>
        referralPayload(
          row,
          events.get(row.id) ?? [],
          replies.get(row.id) ?? [],
          uploads.get(row.id) ?? [],
        ),
      ),
    );
  } catch (err) {
    next(err);
  }
});

async function findCompanyReferral(
  req: Request,
): Promise<AttorneyReferralRow | null> {
  const rows = await db
    .select()
    .from(attorneyReferralsTable)
    .where(
      and(
        eq(attorneyReferralsTable.id, String(req.params.id)),
        eq(attorneyReferralsTable.companyId, req.fieldAuth!.companyId),
      ),
    );
  return rows[0] ?? null;
}

// GET /api/attorney-referrals/:id/uploads/:uploadId — full upload (base64).
router.get("/attorney-referrals/:id/uploads/:uploadId", async (req, res, next) => {
  try {
    const referral = await findCompanyReferral(req);
    if (!referral) {
      res.status(404).json({ message: "Referral not found" });
      return;
    }
    const rows = await db
      .select()
      .from(attorneyReferralUploadsTable)
      .where(
        and(
          eq(attorneyReferralUploadsTable.id, String(req.params.uploadId)),
          eq(attorneyReferralUploadsTable.referralId, referral.id),
        ),
      );
    const upload = rows[0];
    if (!upload) {
      res.status(404).json({ message: "Upload not found" });
      return;
    }
    res.json({ ...uploadMetaPayload(upload), dataBase64: upload.dataBase64 });
  } catch (err) {
    next(err);
  }
});

// POST /api/attorney-referrals/:id/revoke — kill the link immediately.
router.post("/attorney-referrals/:id/revoke", async (req, res, next) => {
  try {
    const referral = await findCompanyReferral(req);
    if (!referral) {
      res.status(404).json({ message: "Referral not found" });
      return;
    }
    if (referral.status !== "revoked") {
      await db
        .update(attorneyReferralsTable)
        .set({ status: "revoked", updatedAt: new Date() })
        .where(eq(attorneyReferralsTable.id, referral.id));
      await logEvent(referral.id, "revoked", "Secure link revoked from the desktop");
    }
    const rows = await db
      .select()
      .from(attorneyReferralsTable)
      .where(eq(attorneyReferralsTable.id, referral.id));
    const { events, replies, uploads } = await loadActivity([referral.id]);
    res.json(
      referralPayload(
        rows[0]!,
        events.get(referral.id) ?? [],
        replies.get(referral.id) ?? [],
        uploads.get(referral.id) ?? [],
      ),
    );
  } catch (err) {
    next(err);
  }
});

// POST /api/attorney-referrals/:id/resend — mint a fresh token (the old link
// stops working), reset expiry, reactivate, and email the attorney again.
router.post("/attorney-referrals/:id/resend", async (req, res, next) => {
  try {
    const referral = await findCompanyReferral(req);
    if (!referral) {
      res.status(404).json({ message: "Referral not found" });
      return;
    }
    const token = generateReferralToken();
    const expiresAt = new Date(
      Date.now() + REFERRAL_TTL_DAYS * 24 * 60 * 60 * 1000,
    );
    const [updated] = await db
      .update(attorneyReferralsTable)
      .set({
        tokenHash: hashReferralToken(token),
        tokenSuffix: token.slice(-4),
        status: "active",
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(attorneyReferralsTable.id, referral.id))
      .returning();

    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, req.fieldAuth!.companyId));
    const emailSent = await sendAttorneyReferralEmail({
      to: updated!.attorneyEmail,
      attorneyName: updated!.attorneyName,
      companyName: company?.name ?? "A RentNotice Pro customer",
      propertyAddress: updated!.propertyAddress,
      unit: updated!.unit,
      tenantNames: updated!.tenantNames,
      message: updated!.message,
      caseUrl: caseUrl(token),
      expiresAt,
    });
    await logEvent(
      referral.id,
      "resent",
      emailSent
        ? `New secure link emailed to ${updated!.attorneyEmail}`
        : `Email to ${updated!.attorneyEmail} failed — new link available for manual sharing`,
    );

    const { events, replies, uploads } = await loadActivity([referral.id]);
    res.json({
      ...referralPayload(
        updated!,
        events.get(referral.id) ?? [],
        replies.get(referral.id) ?? [],
        uploads.get(referral.id) ?? [],
      ),
      link: caseUrl(token),
      emailSent,
    });
  } catch (err) {
    next(err);
  }
});

// ============================ public (attorney) routes =======================

router.use("/attorney/case/:token", publicRateLimit);

type TokenLookup =
  | { ok: true; referral: AttorneyReferralRow }
  | { ok: false; status: number; message: string; code: string };

async function lookupToken(tokenRaw: string): Promise<TokenLookup> {
  const token = tokenRaw.trim();
  if (!token || token.length < 20) {
    return { ok: false, status: 404, message: "Case not found", code: "not_found" };
  }
  const rows = await db
    .select()
    .from(attorneyReferralsTable)
    .where(eq(attorneyReferralsTable.tokenHash, hashReferralToken(token)));
  const referral = rows[0];
  if (!referral) {
    return { ok: false, status: 404, message: "Case not found", code: "not_found" };
  }
  if (referral.status === "revoked") {
    return {
      ok: false,
      status: 410,
      message: "This case link has been revoked by the sender.",
      code: "revoked",
    };
  }
  if (referral.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      status: 410,
      message: "This case link has expired. Ask the sender to re-send it.",
      code: "expired",
    };
  }
  return { ok: true, referral };
}

// Only log a "viewed" event when the last one is older than 30 minutes, so
// normal page navigation doesn't flood the timeline.
const VIEW_EVENT_GAP_MS = 30 * 60 * 1000;
async function logViewedThrottled(referralId: string): Promise<void> {
  const rows = await db
    .select()
    .from(attorneyReferralEventsTable)
    .where(
      and(
        eq(attorneyReferralEventsTable.referralId, referralId),
        eq(attorneyReferralEventsTable.kind, "viewed"),
      ),
    )
    .orderBy(desc(attorneyReferralEventsTable.createdAt))
    .limit(1);
  const last = rows[0];
  if (last && Date.now() - last.createdAt.getTime() < VIEW_EVENT_GAP_MS) return;
  await logEvent(referralId, "viewed", "Attorney opened the case page");
}

// GET /api/attorney/case/:token — the case payload for the public page.
router.get("/attorney/case/:token", async (req, res, next) => {
  try {
    const result = await lookupToken(String(req.params.token));
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    const referral = result.referral;
    await logViewedThrottled(referral.id);

    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, referral.companyId));
    const { replies, uploads } = await loadActivity([referral.id]);
    res.json({
      attorneyName: referral.attorneyName,
      companyName: company?.name ?? "RentNotice Pro customer",
      message: referral.message,
      caseSummary: {
        tenantNames: referral.tenantNames,
        propertyAddress: referral.propertyAddress,
        unit: referral.unit,
        noticeType: referral.noticeType,
        jurisdiction: referral.jurisdiction,
        deadlineDate: referral.deadlineDate,
        totalAmountCents: referral.totalAmountCents,
      },
      packet: {
        fileName: referral.packetFileName,
        sizeBytes: referral.packetSizeBytes,
        pageCount: referral.packetPageCount,
      },
      courtDate: referral.courtDate,
      courtCaseNumber: referral.courtCaseNumber,
      courtNotes: referral.courtNotes,
      replies: (replies.get(referral.id) ?? []).map(replyPayload),
      uploads: (uploads.get(referral.id) ?? []).map(uploadMetaPayload),
      sentAt: referral.createdAt.toISOString(),
      expiresAt: referral.expiresAt.toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/attorney/case/:token/packet — download the packet PDF.
// Recording this event is a core requirement: the desktop timeline shows
// exactly when the attorney downloaded the packet.
router.get("/attorney/case/:token/packet", async (req, res, next) => {
  try {
    const result = await lookupToken(String(req.params.token));
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    const referral = result.referral;
    await logEvent(referral.id, "downloaded", "Attorney downloaded the packet");
    await touchReferral(referral.id);

    const bytes = Buffer.from(referral.packetBase64, "base64");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${referral.packetFileName.replace(/[^\w.\- ]+/g, "_")}"`,
    );
    res.setHeader("Content-Length", String(bytes.byteLength));
    res.send(bytes);
  } catch (err) {
    next(err);
  }
});

// POST /api/attorney/case/:token/replies — attorney sends a reply.
router.post("/attorney/case/:token/replies", async (req, res, next) => {
  try {
    const result = await lookupToken(String(req.params.token));
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    const body = str((req.body as Record<string, unknown> | undefined)?.["body"]).trim();
    if (!body) {
      res.status(400).json({ message: "Reply body is required" });
      return;
    }
    if (body.length > 10_000) {
      res.status(413).json({ message: "Reply is too long (10,000 character limit)" });
      return;
    }
    const [created] = await db
      .insert(attorneyReferralRepliesTable)
      .values({ referralId: result.referral.id, body })
      .returning();
    await logEvent(
      result.referral.id,
      "reply",
      body.length > 120 ? `${body.slice(0, 117)}…` : body,
    );
    await touchReferral(result.referral.id);
    res.status(201).json(replyPayload(created!));
  } catch (err) {
    next(err);
  }
});

// POST /api/attorney/case/:token/uploads — attorney uploads a document back.
router.post("/attorney/case/:token/uploads", async (req, res, next) => {
  try {
    const result = await lookupToken(String(req.params.token));
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const fileName = str(body?.["fileName"]).trim();
    const mimeType = str(body?.["mimeType"]).trim().toLowerCase();
    const dataBase64 = str(body?.["dataBase64"]);
    const note = str(body?.["note"]).trim();
    if (!fileName || !mimeType || !dataBase64) {
      res.status(400).json({
        message: "fileName, mimeType and dataBase64 are required",
      });
      return;
    }
    if (!isValidBase64(dataBase64)) {
      res.status(400).json({ message: "dataBase64 is not valid base64" });
      return;
    }
    if (!ALLOWED_UPLOAD_MIMES.has(mimeType)) {
      res.status(415).json({
        message: "Only PDF, JPEG, PNG and WebP files are accepted",
      });
      return;
    }
    const sizeBytes = base64Bytes(dataBase64);
    if (sizeBytes > MAX_UPLOAD_BYTES) {
      res.status(413).json({ message: "File exceeds the 15 MB limit" });
      return;
    }
    const [created] = await db
      .insert(attorneyReferralUploadsTable)
      .values({
        referralId: result.referral.id,
        fileName,
        mimeType,
        sizeBytes,
        dataBase64,
        note,
      })
      .returning();
    await logEvent(result.referral.id, "upload", `Attorney uploaded ${fileName}`);
    await touchReferral(result.referral.id);
    res.status(201).json(uploadMetaPayload(created!));
  } catch (err) {
    next(err);
  }
});

// PUT /api/attorney/case/:token/court-date — attorney records the court date.
router.put("/attorney/case/:token/court-date", async (req, res, next) => {
  try {
    const result = await lookupToken(String(req.params.token));
    if (!result.ok) {
      res.status(result.status).json({ message: result.message, code: result.code });
      return;
    }
    const body = req.body as Record<string, unknown> | undefined;
    const courtDate = body?.["courtDate"];
    if (!isIsoDate(courtDate)) {
      res.status(400).json({ message: "courtDate must be a valid YYYY-MM-DD date" });
      return;
    }
    const courtCaseNumber = str(body?.["courtCaseNumber"]).trim().slice(0, 120);
    const courtNotes = str(body?.["courtNotes"]).trim().slice(0, 2_000);
    await db
      .update(attorneyReferralsTable)
      .set({ courtDate, courtCaseNumber, courtNotes, updatedAt: new Date() })
      .where(eq(attorneyReferralsTable.id, result.referral.id));
    await logEvent(
      result.referral.id,
      "court_date",
      `Court date set to ${courtDate}${courtCaseNumber ? ` (case ${courtCaseNumber})` : ""}`,
    );
    logger.info(
      { referralId: result.referral.id, courtDate },
      "Attorney recorded court date",
    );
    res.json({ courtDate, courtCaseNumber, courtNotes });
  } catch (err) {
    next(err);
  }
});

export default router;
