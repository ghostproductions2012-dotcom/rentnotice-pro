import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Sync relay tables for the mobile field companion.
// The desktop app stays offline-first; these tables only relay
// field assignments + service evidence between desktop and mobile.

export const fieldAssignmentsTable = pgTable("field_assignments", {
  id: text("id").primaryKey(),
  noticeId: text("notice_id").notNull(),
  assigneeName: text("assignee_name").notNull(),
  instructions: text("instructions").notNull().default(""),
  status: text("status").notNull().default("assigned"),
  serviceMethod: text("service_method"),
  completedAt: text("completed_at"),
  serverNotes: text("server_notes").notNull().default(""),
  // Notice snapshot so the mobile app can render without DB replication
  tenantNames: jsonb("tenant_names").$type<string[]>().notNull().default([]),
  propertyAddress: text("property_address").notNull().default(""),
  unit: text("unit").notNull().default(""),
  noticeType: text("notice_type").notNull().default(""),
  deadlineDate: text("deadline_date"),
  totalAmountCents: integer("total_amount_cents"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const fieldEvidenceTable = pgTable("field_evidence", {
  id: text("id").primaryKey(),
  assignmentId: text("assignment_id")
    .notNull()
    .references(() => fieldAssignmentsTable.id, { onDelete: "cascade" }),
  photoDataUrl: text("photo_data_url").notNull(),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  accuracyMeters: doublePrecision("accuracy_meters"),
  capturedAt: text("captured_at").notNull(),
  note: text("note").notNull().default(""),
});

export const insertFieldAssignmentSchema = createInsertSchema(
  fieldAssignmentsTable,
);
export type InsertFieldAssignment = z.infer<typeof insertFieldAssignmentSchema>;
export type FieldAssignmentRow = typeof fieldAssignmentsTable.$inferSelect;

export const insertFieldEvidenceSchema = createInsertSchema(fieldEvidenceTable);
export type InsertFieldEvidence = z.infer<typeof insertFieldEvidenceSchema>;
export type FieldEvidenceRow = typeof fieldEvidenceTable.$inferSelect;
