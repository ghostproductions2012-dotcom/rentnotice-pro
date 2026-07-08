import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  fieldAssignmentsTable,
  fieldEvidenceTable,
  type FieldAssignmentRow,
  type FieldEvidenceRow,
} from "@workspace/db";

const router: IRouter = Router();

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
  const rows = await db.select().from(fieldAssignmentsTable);
  const allEvidence = await db.select().from(fieldEvidenceTable);
  const byAssignment = new Map<string, FieldEvidenceRow[]>();
  for (const e of allEvidence) {
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
      createdAt: a["createdAt"],
      updatedAt: a["updatedAt"],
    };

    const existingRows = await db
      .select()
      .from(fieldAssignmentsTable)
      .where(eq(fieldAssignmentsTable.id, id));
    const existing = existingRows[0];

    if (!existing) {
      await db.insert(fieldAssignmentsTable).values(incoming);
    } else if (existing.updatedAt > incoming.updatedAt) {
      // Mobile has newer service state — only refresh the notice snapshot
      // and assignment metadata from the desktop.
      await db
        .update(fieldAssignmentsTable)
        .set({
          assigneeName: incoming.assigneeName,
          instructions: incoming.instructions,
          tenantNames: incoming.tenantNames,
          propertyAddress: incoming.propertyAddress,
          unit: incoming.unit,
          noticeType: incoming.noticeType,
          deadlineDate: incoming.deadlineDate,
          totalAmountCents: incoming.totalAmountCents,
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
  if (!existingRows[0]) {
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
  if (!existingRows[0]) {
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
