import {
  doublePrecision,
  integer,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Sync relay tables for maintenance work orders assigned to field staff.
// The desktop app stays offline-first; these tables only relay assigned
// work orders + field updates between desktop and mobile.

export const workOrderAssignmentsTable = pgTable("work_order_assignments", {
  id: text("id").primaryKey(),
  // Company that owns this work order; populated when the desktop pushes
  // with a license credential. Null for legacy rows.
  companyId: text("company_id"),
  workOrderId: text("work_order_id").notNull(),
  assigneeName: text("assignee_name").notNull(),
  status: text("status").notNull().default("assigned"),
  priority: text("priority").notNull().default("normal"),
  category: text("category").notNull().default("general"),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  // Property/tenant snapshot so the mobile app can render without DB replication
  propertyAddress: text("property_address").notNull().default(""),
  unit: text("unit").notNull().default(""),
  tenantNames: text("tenant_names").notNull().default(""),
  dueDate: text("due_date"),
  vendorName: text("vendor_name").notNull().default(""),
  vendorContact: text("vendor_contact").notNull().default(""),
  fieldNotes: text("field_notes").notNull().default(""),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const workOrderPhotosTable = pgTable("work_order_photos", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id")
    .notNull()
    .references(() => workOrderAssignmentsTable.id, { onDelete: "cascade" }),
  photoDataUrl: text("photo_data_url").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracyMeters: doublePrecision("accuracy_meters"),
  capturedAt: text("captured_at").notNull(),
  note: text("note").notNull().default(""),
});

export const insertWorkOrderAssignmentSchema = createInsertSchema(
  workOrderAssignmentsTable,
);
export type InsertWorkOrderAssignment = z.infer<
  typeof insertWorkOrderAssignmentSchema
>;
export type WorkOrderAssignmentRow =
  typeof workOrderAssignmentsTable.$inferSelect;

export const insertWorkOrderPhotoSchema =
  createInsertSchema(workOrderPhotosTable);
export type InsertWorkOrderPhoto = z.infer<typeof insertWorkOrderPhotoSchema>;
export type WorkOrderPhotoRow = typeof workOrderPhotosTable.$inferSelect;
