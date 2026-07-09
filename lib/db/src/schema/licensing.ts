import {
  pgTable,
  text,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const USER_ROLES = ["admin", "manager", "staff", "readonly"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const companiesTable = pgTable("companies", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  contactEmail: text("contact_email").notNull(),
  tier: text("tier").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const cloudUsersTable = pgTable(
  "cloud_users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    // Optional desktop sign-in username chosen by an admin; when absent the
    // desktop app derives one from the email local part.
    username: text("username"),
    passwordHash: text("password_hash"),
    role: text("role").notNull().default("staff"),
    isMasterAdmin: boolean("is_master_admin").notNull().default(false),
    active: boolean("active").notNull().default(true),
    // Single-use invite code the invitee types into the desktop app to
    // activate it and finish account setup. Cleared on redemption.
    inviteCode: text("invite_code").unique(),
    // When the invite code stops being redeemable. Refreshed whenever the
    // code is (re)generated; cleared alongside inviteCode on redemption.
    inviteCodeExpiresAt: timestamp("invite_code_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("cloud_users_company_idx").on(t.companyId)],
);

export const licenseKeysTable = pgTable(
  "license_keys",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    companyId: text("company_id")
      .notNull()
      .references(() => companiesTable.id),
    key: text("key").notNull().unique(),
    status: text("status").notNull().default("active"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    deviceId: text("device_id"),
    deviceName: text("device_name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("license_keys_company_idx").on(t.companyId)],
);

export const webSessionsTable = pgTable(
  "web_sessions",
  {
    token: text("token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => cloudUsersTable.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("web_sessions_user_idx").on(t.userId)],
);

// Sessions for the platform owner's admin panel. Credentials live in env
// secrets (ADMIN_PANEL_EMAIL / ADMIN_PANEL_PASSWORD), so this table has no
// user FK — a row simply proves the platform admin logged in.
export const adminSessionsTable = pgTable("admin_sessions", {
  token: text("token").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const pendingSignupsTable = pgTable("pending_signups", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  companyName: text("company_name").notNull(),
  adminName: text("admin_name").notNull(),
  email: text("email").notNull(),
  passwordHash: text("password_hash").notNull(),
  tier: text("tier").notNull(),
  stripeSessionId: text("stripe_session_id").unique(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;

export const insertCloudUserSchema = createInsertSchema(cloudUsersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCloudUser = z.infer<typeof insertCloudUserSchema>;
export type CloudUser = typeof cloudUsersTable.$inferSelect;

export const insertLicenseKeySchema = createInsertSchema(
  licenseKeysTable,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLicenseKey = z.infer<typeof insertLicenseKeySchema>;
export type LicenseKey = typeof licenseKeysTable.$inferSelect;

export type WebSession = typeof webSessionsTable.$inferSelect;
export type AdminSession = typeof adminSessionsTable.$inferSelect;
export type PendingSignup = typeof pendingSignupsTable.$inferSelect;
