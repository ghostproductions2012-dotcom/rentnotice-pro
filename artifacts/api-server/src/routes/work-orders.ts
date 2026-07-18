import { Router, type IRouter } from "express";
import { and, eq, inArray, isNull, notInArray, or } from "drizzle-orm";
import {
  db,
  workOrderAssignmentsTable,
  workOrderPhotosTable,
  type WorkOrderAssignmentRow,
  type WorkOrderPhotoRow,
} from "@workspace/db";
import { requireFieldAuth } from "../lib/fieldAuth";
import { dispatchCompanyEvent } from "../lib/notify";

const router: IRouter = Router();

// All work-order relay routes require a license key or device sync token.
router.use("/field", requireFieldAuth);

const WORK_ORDER_STATUSES = [
  "new",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
] as const;
const WORK_ORDER_PRIORITIES = ["low", "normal", "high", "emergency"] as const;

type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];
type WorkOrderPriority = (typeof WORK_ORDER_PRIORITIES)[number];

function isStatus(v: unknown): v is WorkOrderStatus {
  return (
    typeof v === "string" &&
    (WORK_ORDER_STATUSES as readonly string[]).includes(v)
  );
}

function isPriority(v: unknown): v is WorkOrderPriority {
  return (
    typeof v === "string" &&
    (WORK_ORDER_PRIORITIES as readonly string[]).includes(v)
  );
}

// Tenant scope for relay rows. Legacy rows created before auth have no
// companyId; they remain visible to any authenticated tenant and get claimed
// (stamped with the company) on the next desktop push.
function workOrderScope(companyId: string) {
  return or(
    eq(workOrderAssignmentsTable.companyId, companyId),
    isNull(workOrderAssignmentsTable.companyId),
  );
}

function ownsWorkOrder(
  row: { companyId: string | null },
  companyId: string,
): boolean {
  return row.companyId === null || row.companyId === companyId;
}

function toSync(
  row: WorkOrderAssignmentRow,
  photos: WorkOrderPhotoRow[],
): Record<string, unknown> {
  return {
    id: row.id,
    workOrderId: row.workOrderId,
    assigneeName: row.assigneeName,
    status: row.status,
    priority: row.priority,
    category: row.category,
    title: row.title,
    description: row.description,
    propertyAddress: row.propertyAddress,
    unit: row.unit,
    tenantNames: row.tenantNames,
    dueDate: row.dueDate,
    vendorName: row.vendorName,
    vendorContact: row.vendorContact,
    fieldNotes: row.fieldNotes,
    completedAt: row.completedAt,
    photos: photos.map((p) => ({
      id: p.id,
      photoDataUrl: p.photoDataUrl,
      latitude: p.latitude,
      longitude: p.longitude,
      accuracyMeters: p.accuracyMeters,
      capturedAt: p.capturedAt,
      note: p.note,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function sortPhotos(photos: WorkOrderPhotoRow[]): WorkOrderPhotoRow[] {
  return [...photos].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
}

async function loadWorkOrder(id: string) {
  const rows = await db
    .select()
    .from(workOrderAssignmentsTable)
    .where(eq(workOrderAssignmentsTable.id, id));
  const row = rows[0];
  if (!row) return null;
  const photos = await db
    .select()
    .from(workOrderPhotosTable)
    .where(eq(workOrderPhotosTable.assignmentId, id));
  return toSync(row, sortPhotos(photos));
}

// GET /api/field/work-orders
router.get("/field/work-orders", async (req, res) => {
  const statusFilter = req.query["status"];
  const rows = await db
    .select()
    .from(workOrderAssignmentsTable)
    .where(workOrderScope(req.fieldAuth!.companyId));
  const rowIds = new Set(rows.map((r) => r.id));
  const allPhotos = await db.select().from(workOrderPhotosTable);
  const byAssignment = new Map<string, WorkOrderPhotoRow[]>();
  for (const p of allPhotos) {
    if (!rowIds.has(p.assignmentId)) continue;
    const list = byAssignment.get(p.assignmentId) ?? [];
    list.push(p);
    byAssignment.set(p.assignmentId, list);
  }
  let filtered = rows;
  if (typeof statusFilter === "string" && isStatus(statusFilter)) {
    filtered = rows.filter((r) => r.status === statusFilter);
  }
  filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(
    filtered.map((r) => toSync(r, sortPhotos(byAssignment.get(r.id) ?? []))),
  );
});

// PUT /api/field/work-orders — bulk upsert from desktop
router.put("/field/work-orders", async (req, res) => {
  const body = req.body as { workOrders?: unknown };
  if (!Array.isArray(body?.workOrders)) {
    res.status(400).json({ message: "workOrders array is required" });
    return;
  }
  const companyId = req.fieldAuth!.companyId;
  let pushed = 0;
  for (const raw of body.workOrders) {
    const w = raw as Record<string, unknown>;
    if (
      typeof w["id"] !== "string" ||
      typeof w["workOrderId"] !== "string" ||
      typeof w["assigneeName"] !== "string" ||
      typeof w["createdAt"] !== "string" ||
      typeof w["updatedAt"] !== "string" ||
      !isStatus(w["status"])
    ) {
      res.status(400).json({
        message:
          "each work order needs id, workOrderId, assigneeName, status, createdAt, updatedAt",
      });
      return;
    }
    const id = w["id"];
    const incoming = {
      id,
      // Attribute pushed work orders to the authenticated company; this also
      // claims legacy rows that predate authentication.
      companyId,
      workOrderId: w["workOrderId"],
      assigneeName: w["assigneeName"],
      status: w["status"],
      priority: isPriority(w["priority"]) ? w["priority"] : "normal",
      category: typeof w["category"] === "string" ? w["category"] : "general",
      title: typeof w["title"] === "string" ? w["title"] : "",
      description: typeof w["description"] === "string" ? w["description"] : "",
      propertyAddress:
        typeof w["propertyAddress"] === "string" ? w["propertyAddress"] : "",
      unit: typeof w["unit"] === "string" ? w["unit"] : "",
      tenantNames: typeof w["tenantNames"] === "string" ? w["tenantNames"] : "",
      dueDate: typeof w["dueDate"] === "string" ? w["dueDate"] : null,
      vendorName: typeof w["vendorName"] === "string" ? w["vendorName"] : "",
      vendorContact:
        typeof w["vendorContact"] === "string" ? w["vendorContact"] : "",
      fieldNotes: typeof w["fieldNotes"] === "string" ? w["fieldNotes"] : "",
      completedAt:
        typeof w["completedAt"] === "string" ? w["completedAt"] : null,
      createdAt: w["createdAt"],
      updatedAt: w["updatedAt"],
    };

    const existingRows = await db
      .select()
      .from(workOrderAssignmentsTable)
      .where(eq(workOrderAssignmentsTable.id, id));
    const existing = existingRows[0];

    if (existing && !ownsWorkOrder(existing, companyId)) {
      // Extremely unlikely UUID collision across tenants — never overwrite
      // another company's data.
      res.status(409).json({ message: `Work order id conflict: ${id}` });
      return;
    }

    if (!existing) {
      await db
        .insert(workOrderAssignmentsTable)
        .values(incoming);
      if (
        incoming.status !== "completed" &&
        incoming.status !== "cancelled"
      ) {
        dispatchCompanyEvent(
          companyId,
          "work_order_assigned",
          `Work order assigned to ${incoming.assigneeName}: ${incoming.title || incoming.category} — ${incoming.propertyAddress}`,
        );
      }
    } else if (existing.updatedAt > incoming.updatedAt) {
      // Mobile has newer field state — only refresh the work-order snapshot
      // and assignment metadata from the desktop.
      await db
        .update(workOrderAssignmentsTable)
        .set({
          companyId,
          assigneeName: incoming.assigneeName,
          priority: incoming.priority,
          category: incoming.category,
          title: incoming.title,
          description: incoming.description,
          propertyAddress: incoming.propertyAddress,
          unit: incoming.unit,
          tenantNames: incoming.tenantNames,
          dueDate: incoming.dueDate,
          vendorName: incoming.vendorName,
          vendorContact: incoming.vendorContact,
        })
        .where(eq(workOrderAssignmentsTable.id, id));
    } else {
      // Desktop snapshot is newer, but fieldNotes/completedAt are owned by
      // the mobile app — keep the existing values unless the desktop
      // actually provides non-empty ones (it normally pushes them empty).
      await db
        .update(workOrderAssignmentsTable)
        .set({
          ...incoming,
          fieldNotes: incoming.fieldNotes || existing.fieldNotes,
          completedAt: incoming.completedAt ?? existing.completedAt,
        })
        .where(eq(workOrderAssignmentsTable.id, id));
    }

    // Photos: append-only by id
    if (Array.isArray(w["photos"])) {
      const existingPhotos = await db
        .select({ id: workOrderPhotosTable.id })
        .from(workOrderPhotosTable)
        .where(eq(workOrderPhotosTable.assignmentId, id));
      const knownIds = new Set(existingPhotos.map((p) => p.id));
      for (const rawPhoto of w["photos"] as unknown[]) {
        const p = rawPhoto as Record<string, unknown>;
        if (
          typeof p["id"] !== "string" ||
          typeof p["photoDataUrl"] !== "string" ||
          typeof p["capturedAt"] !== "string" ||
          knownIds.has(p["id"])
        ) {
          continue;
        }
        await db.insert(workOrderPhotosTable).values({
          id: p["id"],
          assignmentId: id,
          photoDataUrl: p["photoDataUrl"],
          latitude: typeof p["latitude"] === "number" ? p["latitude"] : null,
          longitude: typeof p["longitude"] === "number" ? p["longitude"] : null,
          accuracyMeters:
            typeof p["accuracyMeters"] === "number"
              ? p["accuracyMeters"]
              : null,
          capturedAt: p["capturedAt"],
          note: typeof p["note"] === "string" ? p["note"] : "",
        });
      }
    }
    pushed += 1;
  }

  // Replace-set semantics: the desktop push is the authoritative list of
  // assigned work orders *for this company*. Anything of ours not in the
  // payload was deleted, unassigned, or reassigned on the desktop — remove it
  // from the relay so it stops showing in the field app. Other tenants' rows
  // are never touched.
  const pushedIds = (body.workOrders as Record<string, unknown>[])
    .map((w) => w["id"])
    .filter((v): v is string => typeof v === "string");
  const staleCondition =
    pushedIds.length === 0
      ? workOrderScope(companyId)
      : and(
          workOrderScope(companyId),
          notInArray(workOrderAssignmentsTable.id, pushedIds),
        );
  const staleRows = await db
    .select({ id: workOrderAssignmentsTable.id })
    .from(workOrderAssignmentsTable)
    .where(staleCondition);
  const staleIds = staleRows.map((r) => r.id);
  if (staleIds.length > 0) {
    await db
      .delete(workOrderPhotosTable)
      .where(inArray(workOrderPhotosTable.assignmentId, staleIds));
    await db
      .delete(workOrderAssignmentsTable)
      .where(inArray(workOrderAssignmentsTable.id, staleIds));
  }

  res.json({ pushed });
});

// PATCH /api/field/work-orders/:id — mobile maintenance updates
router.patch("/field/work-orders/:id", async (req, res) => {
  const id = req.params.id;
  const body = req.body as Record<string, unknown>;
  if (typeof body?.["updatedAt"] !== "string") {
    res.status(400).json({ message: "updatedAt is required" });
    return;
  }
  const existingRows = await db
    .select()
    .from(workOrderAssignmentsTable)
    .where(eq(workOrderAssignmentsTable.id, id));
  if (
    !existingRows[0] ||
    !ownsWorkOrder(existingRows[0], req.fieldAuth!.companyId)
  ) {
    res.status(404).json({ message: "Work order not found" });
    return;
  }
  const patch: Partial<WorkOrderAssignmentRow> = {
    updatedAt: body["updatedAt"],
  };
  if (isStatus(body["status"])) patch.status = body["status"];
  if ("completedAt" in body) {
    patch.completedAt =
      typeof body["completedAt"] === "string" ? body["completedAt"] : null;
  }
  if (typeof body["fieldNotes"] === "string") {
    patch.fieldNotes = body["fieldNotes"];
  }
  await db
    .update(workOrderAssignmentsTable)
    .set(patch)
    .where(eq(workOrderAssignmentsTable.id, id));

  // Newly completed → notify the company's Slack / Google Chat webhooks.
  const previous = existingRows[0];
  if (patch.status === "completed" && previous.status !== "completed") {
    const companyId = previous.companyId ?? req.fieldAuth?.companyId;
    if (companyId) {
      dispatchCompanyEvent(
        companyId,
        "work_order_completed",
        `Work order completed by ${previous.assigneeName}: ${previous.title || previous.category} — ${previous.propertyAddress}`,
      );
    }
  }

  const result = await loadWorkOrder(id);
  res.json(result);
});

// POST /api/field/work-orders/:id/photos — idempotent by photo id
router.post("/field/work-orders/:id/photos", async (req, res) => {
  const id = req.params.id;
  const body = req.body as Record<string, unknown>;
  if (
    typeof body?.["id"] !== "string" ||
    typeof body?.["photoDataUrl"] !== "string" ||
    typeof body?.["capturedAt"] !== "string"
  ) {
    res
      .status(400)
      .json({ message: "id, photoDataUrl, capturedAt are required" });
    return;
  }
  const existingRows = await db
    .select()
    .from(workOrderAssignmentsTable)
    .where(eq(workOrderAssignmentsTable.id, id));
  if (
    !existingRows[0] ||
    !ownsWorkOrder(existingRows[0], req.fieldAuth!.companyId)
  ) {
    res.status(404).json({ message: "Work order not found" });
    return;
  }
  const photoId = body["id"];
  const existingPhoto = await db
    .select({ id: workOrderPhotosTable.id })
    .from(workOrderPhotosTable)
    .where(eq(workOrderPhotosTable.id, photoId));
  if (!existingPhoto[0]) {
    await db.insert(workOrderPhotosTable).values({
      id: photoId,
      assignmentId: id,
      photoDataUrl: body["photoDataUrl"],
      latitude: typeof body["latitude"] === "number" ? body["latitude"] : null,
      longitude:
        typeof body["longitude"] === "number" ? body["longitude"] : null,
      accuracyMeters:
        typeof body["accuracyMeters"] === "number"
          ? body["accuracyMeters"]
          : null,
      capturedAt: body["capturedAt"],
      note: typeof body["note"] === "string" ? body["note"] : "",
    });
    await db
      .update(workOrderAssignmentsTable)
      .set({ updatedAt: new Date().toISOString() })
      .where(eq(workOrderAssignmentsTable.id, id));
  }
  const result = await loadWorkOrder(id);
  res.json(result);
});

export default router;
