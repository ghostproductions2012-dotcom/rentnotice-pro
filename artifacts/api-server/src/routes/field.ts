import { Router, type IRouter } from "express";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import {
  db,
  fieldAssignmentsTable,
  fieldEvidenceTable,
  fieldSyncTokensTable,
  type FieldAssignmentRow,
  type FieldEvidenceRow,
  type FieldSyncTokenRow,
} from "@workspace/db";
import {
  generateFieldSyncToken,
  hashFieldSyncToken,
  requireFieldAuth,
  requireLicenseAuth,
} from "../lib/fieldAuth";
import { dispatchCompanyEvent } from "../lib/notify";

const router: IRouter = Router();

// Every field-relay route (including device management below) requires
// either the desktop license key or a device sync token.
router.use("/field", requireFieldAuth);

// The plaintext access code is never stored, so list/revoke responses can
// only expose the masked suffix. Only issuance (POST) returns the full code.
function devicePayload(row: FieldSyncTokenRow) {
  return {
    id: row.id,
    deviceName: row.deviceName,
    tokenSuffix: row.tokenSuffix,
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Tenant scope for relay rows. Legacy rows created before auth have no
// companyId; they remain visible to any authenticated tenant and get claimed
// (stamped with the company) on the next desktop push.
function assignmentScope(companyId: string) {
  return or(
    eq(fieldAssignmentsTable.companyId, companyId),
    isNull(fieldAssignmentsTable.companyId),
  );
}

function ownsAssignment(
  row: { companyId: string | null },
  companyId: string,
): boolean {
  return row.companyId === null || row.companyId === companyId;
}

// GET /api/field/devices — list issued device access codes (desktop only)
router.get("/field/devices", requireLicenseAuth, async (req, res) => {
  const rows = await db
    .select()
    .from(fieldSyncTokensTable)
    .where(eq(fieldSyncTokensTable.companyId, req.fieldAuth!.companyId))
    .orderBy(asc(fieldSyncTokensTable.createdAt));
  res.json(rows.map(devicePayload));
});

// POST /api/field/devices — issue a new device access code (desktop only)
router.post("/field/devices", requireLicenseAuth, async (req, res) => {
  const body = req.body as Record<string, unknown> | undefined;
  const deviceName =
    typeof body?.["deviceName"] === "string" ? body["deviceName"].trim() : "";
  if (!deviceName) {
    res.status(400).json({ message: "deviceName is required" });
    return;
  }
  const token = generateFieldSyncToken();
  const [created] = await db
    .insert(fieldSyncTokensTable)
    .values({
      companyId: req.fieldAuth!.companyId,
      deviceName,
      tokenHash: hashFieldSyncToken(token),
      tokenSuffix: token.slice(-4),
    })
    .returning();
  // One-time reveal: the plaintext code exists only in this response.
  res.status(201).json({ ...devicePayload(created!), token });
});

// DELETE /api/field/devices/:id — revoke a device access code (desktop only)
router.delete("/field/devices/:id", requireLicenseAuth, async (req, res) => {
  const deviceId = String(req.params.id);
  const rows = await db
    .select()
    .from(fieldSyncTokensTable)
    .where(
      and(
        eq(fieldSyncTokensTable.id, deviceId),
        eq(fieldSyncTokensTable.companyId, req.fieldAuth!.companyId),
      ),
    );
  if (!rows[0]) {
    res.status(404).json({ message: "Device not found" });
    return;
  }
  const [updated] = await db
    .update(fieldSyncTokensTable)
    .set({ revokedAt: rows[0].revokedAt ?? new Date() })
    .where(eq(fieldSyncTokensTable.id, deviceId))
    .returning();
  res.json(devicePayload(updated!));
});

const ASSIGNMENT_STATUSES = [
  "assigned",
  "in_progress",
  "completed",
  "cancelled",
] as const;
const SERVICE_METHODS = [
  "personal",
  "substitute",
  "post_and_mail",
  "other",
] as const;

type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];
type ServiceMethod = (typeof SERVICE_METHODS)[number];

function isStatus(v: unknown): v is AssignmentStatus {
  return (
    typeof v === "string" &&
    (ASSIGNMENT_STATUSES as readonly string[]).includes(v)
  );
}

function isServiceMethod(v: unknown): v is ServiceMethod {
  return (
    typeof v === "string" && (SERVICE_METHODS as readonly string[]).includes(v)
  );
}

function toSync(
  row: FieldAssignmentRow,
  evidence: FieldEvidenceRow[],
): Record<string, unknown> {
  return {
    id: row.id,
    noticeId: row.noticeId,
    assigneeName: row.assigneeName,
    instructions: row.instructions,
    status: row.status,
    serviceMethod: row.serviceMethod,
    completedAt: row.completedAt,
    serverNotes: row.serverNotes,
    tenantNames: row.tenantNames ?? [],
    propertyAddress: row.propertyAddress,
    unit: row.unit,
    noticeType: row.noticeType,
    deadlineDate: row.deadlineDate,
    totalAmountCents: row.totalAmountCents,
    source: row.source,
    evidence: evidence.map((e) => ({
      id: e.id,
      photoDataUrl: e.photoDataUrl,
      latitude: e.latitude,
      longitude: e.longitude,
      accuracyMeters: e.accuracyMeters,
      capturedAt: e.capturedAt,
      note: e.note,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function loadAssignment(id: string) {
  const rows = await db
    .select()
    .from(fieldAssignmentsTable)
    .where(eq(fieldAssignmentsTable.id, id));
  const row = rows[0];
  if (!row) return null;
  const evidence = await db
    .select()
    .from(fieldEvidenceTable)
    .where(eq(fieldEvidenceTable.assignmentId, id));
  return toSync(row, sortEvidence(evidence));
}

function sortEvidence(evidence: FieldEvidenceRow[]): FieldEvidenceRow[] {
  return [...evidence].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

// GET /api/field/assignments
router.get("/field/assignments", async (req, res) => {
  const statusFilter = req.query["status"];
  const rows = await db
    .select()
    .from(fieldAssignmentsTable)
    .where(assignmentScope(req.fieldAuth!.companyId));
  const rowIds = new Set(rows.map((r) => r.id));
  const allEvidence = await db.select().from(fieldEvidenceTable);
  const byAssignment = new Map<string, FieldEvidenceRow[]>();
  for (const e of allEvidence) {
    if (!rowIds.has(e.assignmentId)) continue;
    const list = byAssignment.get(e.assignmentId) ?? [];
    list.push(e);
    byAssignment.set(e.assignmentId, list);
  }
  let filtered = rows;
  if (typeof statusFilter === "string" && isStatus(statusFilter)) {
    filtered = rows.filter((r) => r.status === statusFilter);
  }
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(
    filtered.map((r) =>
      toSync(r, sortEvidence(byAssignment.get(r.id) ?? [])),
    ),
  );
});

// PUT /api/field/assignments — bulk upsert from desktop
router.put("/field/assignments", async (req, res) => {
  const body = req.body as { assignments?: unknown };
  if (!Array.isArray(body?.assignments)) {
    res.status(400).json({ message: "assignments array is required" });
    return;
  }
  const companyId = req.fieldAuth!.companyId;
  let pushed = 0;
  for (const raw of body.assignments) {
    const a = raw as Record<string, unknown>;
    if (
      typeof a["id"] !== "string" ||
      typeof a["noticeId"] !== "string" ||
      typeof a["assigneeName"] !== "string" ||
      typeof a["createdAt"] !== "string" ||
      typeof a["updatedAt"] !== "string" ||
      !isStatus(a["status"])
    ) {
      res.status(400).json({
        message: "each assignment needs id, noticeId, assigneeName, status, createdAt, updatedAt",
      });
      return;
    }
    const id = a["id"];
    const incoming = {
      id,
      // Attribute pushed assignments to the authenticated company; this also
      // claims legacy rows that predate authentication.
      companyId,
      noticeId: a["noticeId"],
      assigneeName: a["assigneeName"],
      instructions: typeof a["instructions"] === "string" ? a["instructions"] : "",
      status: a["status"],
      serviceMethod: isServiceMethod(a["serviceMethod"]) ? a["serviceMethod"] : null,
      completedAt: typeof a["completedAt"] === "string" ? a["completedAt"] : null,
      serverNotes: typeof a["serverNotes"] === "string" ? a["serverNotes"] : "",
      tenantNames: Array.isArray(a["tenantNames"])
        ? (a["tenantNames"] as unknown[]).filter((n): n is string => typeof n === "string")
        : [],
      propertyAddress: typeof a["propertyAddress"] === "string" ? a["propertyAddress"] : "",
      unit: typeof a["unit"] === "string" ? a["unit"] : "",
      noticeType: typeof a["noticeType"] === "string" ? a["noticeType"] : "",
      deadlineDate: typeof a["deadlineDate"] === "string" ? a["deadlineDate"] : null,
      totalAmountCents:
        typeof a["totalAmountCents"] === "number" ? Math.round(a["totalAmountCents"]) : null,
      source: typeof a["source"] === "string" && a["source"] ? a["source"] : null,
      createdAt: a["createdAt"],
      updatedAt: a["updatedAt"],
    };

    const existingRows = await db
      .select()
      .from(fieldAssignmentsTable)
      .where(eq(fieldAssignmentsTable.id, id));
    const existing = existingRows[0];

    if (existing && !ownsAssignment(existing, companyId)) {
      // Extremely unlikely UUID collision across tenants — never overwrite
      // another company's data.
      res.status(409).json({ message: `Assignment id conflict: ${id}` });
      return;
    }

    if (!existing) {
      await db.insert(fieldAssignmentsTable).values(incoming);
    } else if (existing.updatedAt > incoming.updatedAt) {
      // Mobile has newer service state — only refresh the notice snapshot
      // and assignment metadata from the desktop.
      await db
        .update(fieldAssignmentsTable)
        .set({
          companyId,
          assigneeName: incoming.assigneeName,
          instructions: incoming.instructions,
          tenantNames: incoming.tenantNames,
          propertyAddress: incoming.propertyAddress,
          unit: incoming.unit,
          noticeType: incoming.noticeType,
          deadlineDate: incoming.deadlineDate,
          totalAmountCents: incoming.totalAmountCents,
          source: incoming.source,
        })
        .where(eq(fieldAssignmentsTable.id, id));
    } else {
      await db
        .update(fieldAssignmentsTable)
        .set(incoming)
        .where(eq(fieldAssignmentsTable.id, id));
    }

    // Evidence: append-only by id
    if (Array.isArray(a["evidence"])) {
      const existingEvidence = await db
        .select({ id: fieldEvidenceTable.id })
        .from(fieldEvidenceTable)
        .where(eq(fieldEvidenceTable.assignmentId, id));
      const knownIds = new Set(existingEvidence.map((e) => e.id));
      for (const rawEv of a["evidence"] as unknown[]) {
        const ev = rawEv as Record<string, unknown>;
        if (
          typeof ev["id"] !== "string" ||
          typeof ev["photoDataUrl"] !== "string" ||
          typeof ev["capturedAt"] !== "string" ||
          knownIds.has(ev["id"])
        ) {
          continue;
        }
        await db.insert(fieldEvidenceTable).values({
          id: ev["id"],
          assignmentId: id,
          photoDataUrl: ev["photoDataUrl"],
          latitude: typeof ev["latitude"] === "number" ? ev["latitude"] : null,
          longitude: typeof ev["longitude"] === "number" ? ev["longitude"] : null,
          accuracyMeters:
            typeof ev["accuracyMeters"] === "number" ? ev["accuracyMeters"] : null,
          capturedAt: ev["capturedAt"],
          note: typeof ev["note"] === "string" ? ev["note"] : "",
        });
      }
    }
    pushed += 1;
  }
  res.json({ pushed });
});

// PATCH /api/field/assignments/:id — mobile service updates
router.patch("/field/assignments/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body as Record<string, unknown>;
  if (typeof body?.["updatedAt"] !== "string") {
    res.status(400).json({ message: "updatedAt is required" });
    return;
  }
  const existingRows = await db
    .select()
    .from(fieldAssignmentsTable)
    .where(eq(fieldAssignmentsTable.id, id));
  if (!existingRows[0] || !ownsAssignment(existingRows[0], req.fieldAuth!.companyId)) {
    res.status(404).json({ message: "Assignment not found" });
    return;
  }
  const patch: Partial<FieldAssignmentRow> = { updatedAt: body["updatedAt"] };
  if (isStatus(body["status"])) patch.status = body["status"];
  if ("serviceMethod" in body) {
    patch.serviceMethod = isServiceMethod(body["serviceMethod"])
      ? body["serviceMethod"]
      : null;
  }
  if ("completedAt" in body) {
    patch.completedAt =
      typeof body["completedAt"] === "string" ? body["completedAt"] : null;
  }
  if (typeof body["serverNotes"] === "string") {
    patch.serverNotes = body["serverNotes"];
  }
  await db
    .update(fieldAssignmentsTable)
    .set(patch)
    .where(eq(fieldAssignmentsTable.id, id));

  // Newly completed → notify the company's Slack / Google Chat webhooks.
  const previous = existingRows[0];
  if (patch.status === "completed" && previous.status !== "completed") {
    const companyId = previous.companyId ?? req.fieldAuth!.companyId;
    const who = (previous.tenantNames ?? []).join(", ") || "tenant";
    const unit = previous.unit ? ` #${previous.unit}` : "";
    const noticeType = previous.noticeType ? ` (${previous.noticeType})` : "";
    dispatchCompanyEvent(
      companyId,
      "notice_served",
      `Notice served: ${who} — ${previous.propertyAddress}${unit}${noticeType}`,
    );
  }

  const result = await loadAssignment(id);
  res.json(result);
});

// POST /api/field/assignments/:id/evidence — idempotent by evidence id
router.post("/field/assignments/:id/evidence", async (req, res) => {
  const id = req.params.id;
  const body = req.body as Record<string, unknown>;
  if (
    typeof body?.["id"] !== "string" ||
    typeof body?.["photoDataUrl"] !== "string" ||
    typeof body?.["capturedAt"] !== "string"
  ) {
    res.status(400).json({ message: "id, photoDataUrl, capturedAt are required" });
    return;
  }
  const existingRows = await db
    .select()
    .from(fieldAssignmentsTable)
    .where(eq(fieldAssignmentsTable.id, id));
  if (!existingRows[0] || !ownsAssignment(existingRows[0], req.fieldAuth!.companyId)) {
    res.status(404).json({ message: "Assignment not found" });
    return;
  }
  const evidenceId = body["id"];
  const existingEvidence = await db
    .select({ id: fieldEvidenceTable.id })
    .from(fieldEvidenceTable)
    .where(eq(fieldEvidenceTable.id, evidenceId));
  if (!existingEvidence[0]) {
    await db.insert(fieldEvidenceTable).values({
      id: evidenceId,
      assignmentId: id,
      photoDataUrl: body["photoDataUrl"],
      latitude: typeof body["latitude"] === "number" ? body["latitude"] : null,
      longitude: typeof body["longitude"] === "number" ? body["longitude"] : null,
      accuracyMeters:
        typeof body["accuracyMeters"] === "number" ? body["accuracyMeters"] : null,
      capturedAt: body["capturedAt"],
      note: typeof body["note"] === "string" ? body["note"] : "",
    });
    await db
      .update(fieldAssignmentsTable)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(fieldAssignmentsTable.id, id));
  }
  const result = await loadAssignment(id);
  res.json(result);
});

export default router;
