import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Sync relay tables for the mobile field companion.
// The desktop app stays offline-first; these tables only relay
// field assignments + service evidence between desktop and mobile.

export const fieldAssignmentsTable = pgTable("field_assignments", {
  id: text("id").primaryKey(),
  // Company that owns this assignment; populated when the desktop pushes
  // with a license credential. Null for legacy rows — the event dispatcher
  // simply skips webhook delivery when unresolved.
  companyId: text("company_id"),
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
  // Where the underlying tenant/ledger came from (e.g. "buildium"); lets the
  // mobile app show a source badge. Null for manually entered data.
  source: text("source"),
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

// Per-device access tokens for the field sync relay. Issued from the desktop
// app (authenticated by its license key) and typed into the mobile field app.
// Every /api/field/* sync request must present either a valid license key
// (desktop) or a non-revoked device token (mobile).
export const fieldSyncTokensTable = pgTable(
  "field_sync_tokens",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Company that issued the token; null only if the license row has been
    // deleted out from under it (tokens are revoked, not deleted).
    companyId: text("company_id"),
    deviceName: text("device_name").notNull().default(""),
    // SHA-256 hex digest of the normalized access code. The plaintext code is
    // shown exactly once at issuance and never stored.
    tokenHash: text("token_hash").notNull().unique(),
    // Last 4 characters of the code, for masked display in device lists.
    tokenSuffix: text("token_suffix").notNull().default(""),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("field_sync_tokens_company_idx").on(t.companyId)],
);

export type FieldSyncTokenRow = typeof fieldSyncTokensTable.$inferSelect;

export const insertFieldAssignmentSchema = createInsertSchema(
  fieldAssignmentsTable,
);
export type InsertFieldAssignment = z.infer<typeof insertFieldAssignmentSchema>;
export type FieldAssignmentRow = typeof fieldAssignmentsTable.$inferSelect;

export const insertFieldEvidenceSchema = createInsertSchema(fieldEvidenceTable);
export type InsertFieldEvidence = z.infer<typeof insertFieldEvidenceSchema>;
export type FieldEvidenceRow = typeof fieldEvidenceTable.$inferSelect;
