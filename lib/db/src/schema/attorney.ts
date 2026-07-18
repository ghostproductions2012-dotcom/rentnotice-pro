import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Attorney secure-link referrals. The desktop app uploads the attorney packet
// and case snapshot here, and the attorney works the case through a private
// tokenized link (no account): view/download the packet, reply, upload
// documents back, and record the court date. Every touch is logged as an
// event so the desktop can show a full activity timeline.

export const attorneyReferralsTable = pgTable(
  "attorney_referrals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Tenant boundary: referrals are created by the desktop (license auth),
    // so the company is always stamped.
    companyId: text("company_id").notNull(),
    // Desktop-local notice id this referral belongs to.
    noticeId: text("notice_id").notNull(),
    attorneyName: text("attorney_name").notNull(),
    attorneyEmail: text("attorney_email").notNull(),
    // Optional note from the landlord included in the email + case page.
    message: text("message").notNull().default(""),
    // SHA-256 hex of the access token. The plaintext token appears only in
    // the emailed link (and the create/resend response for copy-link).
    tokenHash: text("token_hash").notNull().unique(),
    tokenSuffix: text("token_suffix").notNull().default(""),
    status: text("status").notNull().default("active"), // active | revoked
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    // Attorney packet (combined PDF), stored base64 so the link keeps working
    // even when the desktop is offline.
    packetFileName: text("packet_file_name").notNull(),
    packetBase64: text("packet_base64").notNull(),
    packetSizeBytes: integer("packet_size_bytes").notNull().default(0),
    packetPageCount: integer("packet_page_count").notNull().default(1),
    // Case snapshot so the attorney page renders without desktop replication.
    tenantNames: jsonb("tenant_names").$type<string[]>().notNull().default([]),
    propertyAddress: text("property_address").notNull().default(""),
    unit: text("unit").notNull().default(""),
    noticeType: text("notice_type").notNull().default(""),
    jurisdiction: text("jurisdiction").notNull().default(""),
    deadlineDate: text("deadline_date"),
    totalAmountCents: integer("total_amount_cents"),
    // Court date entered by the attorney (synced back to the desktop
    // Deadline Calendar).
    courtDate: text("court_date"),
    courtCaseNumber: text("court_case_number").notNull().default(""),
    courtNotes: text("court_notes").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("attorney_referrals_company_idx").on(t.companyId),
    index("attorney_referrals_notice_idx").on(t.noticeId),
  ],
);

// Activity timeline: sent, resent, revoked, viewed, downloaded, reply,
// upload, court_date. `detail` carries a short human-readable summary.
export const attorneyReferralEventsTable = pgTable(
  "attorney_referral_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    referralId: text("referral_id")
      .notNull()
      .references(() => attorneyReferralsTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    detail: text("detail").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attorney_referral_events_referral_idx").on(t.referralId)],
);

export const attorneyReferralRepliesTable = pgTable(
  "attorney_referral_replies",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    referralId: text("referral_id")
      .notNull()
      .references(() => attorneyReferralsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attorney_referral_replies_referral_idx").on(t.referralId)],
);

// Documents the attorney uploads back (filed complaint, signed declarations,
// …). Stored base64; the desktop pulls them into its local case file.
export const attorneyReferralUploadsTable = pgTable(
  "attorney_referral_uploads",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    referralId: text("referral_id")
      .notNull()
      .references(() => attorneyReferralsTable.id, { onDelete: "cascade" }),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull().default(0),
    dataBase64: text("data_base64").notNull(),
    note: text("note").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("attorney_referral_uploads_referral_idx").on(t.referralId)],
);

export const insertAttorneyReferralSchema = createInsertSchema(
  attorneyReferralsTable,
);
export type InsertAttorneyReferral = z.infer<
  typeof insertAttorneyReferralSchema
>;
export type AttorneyReferralRow = typeof attorneyReferralsTable.$inferSelect;
export type AttorneyReferralEventRow =
  typeof attorneyReferralEventsTable.$inferSelect;
export type AttorneyReferralReplyRow =
  typeof attorneyReferralRepliesTable.$inferSelect;
export type AttorneyReferralUploadRow =
  typeof attorneyReferralUploadsTable.$inferSelect;
