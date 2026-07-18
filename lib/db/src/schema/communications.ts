import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./licensing";

// Communications hub tables: internal team chat (channels + DMs) and the
// tenant communication log. All rows are company-scoped. Chat sender
// identity is server-validated: every team-chat request must carry a member
// token (minted by POST /comms/identity/token after the member proves their
// own credentials), and the token's memberKey must match any client-declared
// senderKey/memberKey. senderName remains a display snapshot.

export const CHANNEL_KINDS = ["channel", "dm"] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

// Replicated desktop-local team members (users with no cloud_users row).
// The desktop pushes its local user list here (replace-set per company) so
// the server can validate chat identities. secretHash is the same SHA-256
// password hash the desktop stores locally; used only to mint chat tokens.
export const chatDirectoryMembersTable = pgTable(
  "chat_directory_members",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    // The key clients use as senderKey/memberKey (the desktop-local user id).
    memberKey: text("member_key").notNull(),
    name: text("name").notNull(),
    username: text("username").notNull().default(""),
    email: text("email").notNull().default(""),
    role: text("role").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    // SHA-256 hex of the member's desktop password; empty when none is set
    // (such members cannot mint chat tokens until they set a password).
    secretHash: text("secret_hash").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("chat_directory_member_key_idx").on(t.companyId, t.memberKey),
    index("chat_directory_company_idx").on(t.companyId),
  ],
);

// Server-issued per-member chat tokens. Minted by POST /comms/identity/token
// after verifying the member's own credentials; required (alongside the
// company credential) for all team-chat routes so a license key alone can
// no longer read DMs or impersonate senders.
export const chatMemberTokensTable = pgTable(
  "chat_member_tokens",
  {
    token: text("token").primaryKey(),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    memberKey: text("member_key").notNull(),
    memberName: text("member_name").notNull().default(""),
    createdAt: text("created_at").notNull(),
    // ISO expiry; tokens past this moment are rejected (401) and deleted.
    // Empty string on legacy rows minted before expiry existed — the server
    // treats those as createdAt + the standard TTL.
    expiresAt: text("expires_at").notNull().default(""),
  },
  (t) => [index("chat_member_tokens_member_idx").on(t.companyId, t.memberKey)],
);

export const chatChannelsTable = pgTable(
  "chat_channels",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    kind: text("kind").notNull().default("channel"),
    // Channel display name (e.g. "general"); for DMs a label built from the
    // two member names, recomputed client-side as needed.
    name: text("name").notNull(),
    // For DMs: the two member keys sorted and joined with ":" so a DM pair is
    // unique per company. Null for regular channels.
    dmKey: text("dm_key"),
    // DM member keys so clients can resolve "the other person" cheaply.
    memberKeys: jsonb("member_keys").$type<string[]>().notNull().default([]),
    archived: boolean("archived").notNull().default(false),
    createdByKey: text("created_by_key").notNull().default(""),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("chat_channels_company_idx").on(t.companyId),
    uniqueIndex("chat_channels_dm_key_idx").on(t.companyId, t.dmKey),
  ],
);

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => chatChannelsTable.id, { onDelete: "cascade" }),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    senderKey: text("sender_key").notNull(),
    senderName: text("sender_name").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("chat_messages_channel_idx").on(t.channelId, t.createdAt)],
);

export const chatReadStateTable = pgTable(
  "chat_read_state",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    channelId: text("channel_id")
      .notNull()
      .references(() => chatChannelsTable.id, { onDelete: "cascade" }),
    memberKey: text("member_key").notNull(),
    lastReadAt: text("last_read_at").notNull(),
  },
  (t) => [
    uniqueIndex("chat_read_state_member_idx").on(t.channelId, t.memberKey),
  ],
);

export const TENANT_COMM_KINDS = [
  "email",
  "announcement",
  "notice_served",
  "work_order",
] as const;
export type TenantCommKind = (typeof TENANT_COMM_KINDS)[number];

export const tenantCommunicationsTable = pgTable(
  "tenant_communications",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    // Desktop-local tenant id (tenants live only in the desktop sql.js DB),
    // plus snapshot fields so history renders without replication.
    tenantId: text("tenant_id").notNull(),
    tenantName: text("tenant_name").notNull().default(""),
    tenantEmail: text("tenant_email").notNull().default(""),
    propertyAddress: text("property_address").notNull().default(""),
    kind: text("kind").notNull().default("email"),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text").notNull().default(""),
    // "sent" | "failed" | "logged" (logged = event entry, no email delivery)
    status: text("status").notNull().default("logged"),
    createdByKey: text("created_by_key").notNull().default(""),
    createdByName: text("created_by_name").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("tenant_comms_company_idx").on(t.companyId, t.createdAt),
    index("tenant_comms_tenant_idx").on(t.companyId, t.tenantId),
  ],
);

export const INTEGRATION_EVENTS = [
  "work_order_assigned",
  "work_order_completed",
  "notice_served",
  "tenant_email_sent",
] as const;
export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export const companyIntegrationsTable = pgTable("company_integrations", {
  companyId: text("company_id")
    .primaryKey()
    .references(() => companiesTable.id),
  slackWebhookUrl: text("slack_webhook_url").notNull().default(""),
  googleChatWebhookUrl: text("google_chat_webhook_url").notNull().default(""),
  // Which events post to the connected webhooks.
  events: jsonb("events").$type<string[]>().notNull().default([]),
  // Mirror team-chat channel messages to the connected webhooks.
  mirrorTeamChat: boolean("mirror_team_chat").notNull().default(false),
  updatedAt: text("updated_at").notNull(),
});

export const insertChatChannelSchema = createInsertSchema(chatChannelsTable);
export type InsertChatChannel = z.infer<typeof insertChatChannelSchema>;
export type ChatChannelRow = typeof chatChannelsTable.$inferSelect;

export const insertChatMessageSchema = createInsertSchema(chatMessagesTable);
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessageRow = typeof chatMessagesTable.$inferSelect;

export type ChatReadStateRow = typeof chatReadStateTable.$inferSelect;

export const insertTenantCommunicationSchema = createInsertSchema(
  tenantCommunicationsTable,
);
export type InsertTenantCommunication = z.infer<
  typeof insertTenantCommunicationSchema
>;
export type TenantCommunicationRow =
  typeof tenantCommunicationsTable.$inferSelect;

export type CompanyIntegrationsRow =
  typeof companyIntegrationsTable.$inferSelect;

export type ChatDirectoryMemberRow =
  typeof chatDirectoryMembersTable.$inferSelect;
export type ChatMemberTokenRow = typeof chatMemberTokensTable.$inferSelect;
