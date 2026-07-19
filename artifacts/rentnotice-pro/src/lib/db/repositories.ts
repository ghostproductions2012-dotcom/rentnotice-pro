// ---------------------------------------------------------------------------
// Repositories — the persistence layer for RentNotice Pro.
// Each repository maps SQL rows (see schema.ts) <-> domain types (see types.ts).
// Money is INTEGER cents, dates are ISO strings, booleans are 0/1, nested
// structures are TEXT JSON, and binary payloads are BLOB.
//
// Method shapes and list filters mirror the AppServices contract in
// src/lib/api/services.ts. These functions are intentionally free of session /
// business logic (audit logging, password hashing, calculation, validation) — the
// service layer composes them.
// ---------------------------------------------------------------------------

import type { AppDatabase } from "./client";
import type { ClassificationOverrideInput, LedgerDetail } from "../api/services";
import type {
  ActivationState,
  AppSettings,
  Attachment,
  AuditEntry,
  AuditAction,
  AuditFilters,
  LicenseStatus,
  WorkspaceMode,
  CalculationResult,
  ColumnMapping,
  CompanyProfile,
  DuplicateCheckResult,
  FieldAssignment,
  FieldAssignmentStatus,
  FieldEvidence,
  Holiday,
  Id,
  Ledger,
  LedgerSourceType,
  LedgerTransaction,
  MailStatus,
  MailTracking,
  MailTrackingEvent,
  AttorneyContact,
  MappingPreset,
  MonthCalculation,
  Notice,
  NoticeFilters,
  NoticeMonth,
  NoticeStatus,
  NoticeType,
  NoticeDocument,
  NoticeTemplate,
  PaymentProfile,
  PmVendor,
  Property,
  RentClass,
  ServiceMethod,
  StateRuleReview,
  StatusHistoryEntry,
  Tenant,
  TemplateVersion,
  TxnKind,
  User,
  UserRole,
  ValidationIssue,
  ValidationResult,
  WorkOrder,
  WorkOrderCategory,
  WorkOrderFilters,
  WorkOrderPriority,
  WorkOrderStatus,
  WorkOrderStatusChange,
} from "../types";
import {
  asBytes,
  asNum,
  asStr,
  bytesToDataUrl,
  dataUrlToBytes,
  fromBool,
  nowIso,
  numOrNull,
  parseJson,
  strOrNull,
  toBool,
  toJson,
  upsertRow,
  type Row,
} from "./util";
import type { SqlValue } from "sql.js";

// ------------------------------- shared helpers ----------------------------

export function emptyPayment(): PaymentProfile {
  return {
    payToName: "",
    payToPerson: "",
    paymentAddress: "",
    phone: "",
    acceptedMethods: [],
    inPersonAllowed: false,
    officeHours: "",
    paymentDays: "",
    electronicInstructions: "",
  };
}

/** Merge only the defined keys of a patch onto a base object (undefined skipped). */
function applyPatch<T extends object>(base: T, patch: Partial<T>): T {
  const out: T = { ...base };
  (Object.keys(patch) as (keyof T)[]).forEach((key) => {
    const value = patch[key];
    if (value !== undefined) out[key] = value as T[keyof T];
  });
  return out;
}

// =====================================================================
// Users
// =====================================================================

function rowToUser(r: Row): User {
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    initials: asStr(r.initials),
    username: asStr(r.username),
    email: strOrNull(r.email),
    role: asStr(r.role) as UserRole,
    // The schema stores the SHA-256 hex digest in pin_hash; null = no secret.
    pin: strOrNull(r.pin_hash),
    active: toBool(r.active),
    createdAt: asStr(r.created_at),
    cloudUserId: strOrNull(r.cloud_user_id),
    chatToken: strOrNull(r.chat_token),
  };
}

function userRow(u: User): Row {
  return {
    id: u.id,
    name: u.name,
    initials: u.initials,
    username: u.username,
    email: u.email,
    role: u.role,
    pin_hash: u.pin,
    active: fromBool(u.active),
    created_at: u.createdAt,
    cloud_user_id: u.cloudUserId,
    chat_token: u.chatToken,
  };
}

export const usersRepo = {
  count(db: AppDatabase): number {
    return asNum(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users")?.c);
  },
  list(db: AppDatabase): User[] {
    return db.all("SELECT * FROM users ORDER BY created_at").map(rowToUser);
  },
  get(db: AppDatabase, id: Id): User | null {
    const r = db.get("SELECT * FROM users WHERE id = ?", [id]);
    return r ? rowToUser(r) : null;
  },
  /** Case-insensitive lookup by username or email. */
  findByIdentifier(db: AppDatabase, identifier: string): User | null {
    const needle = identifier.trim().toLowerCase();
    if (!needle) return null;
    const r = db.get("SELECT * FROM users WHERE lower(username) = ? OR lower(email) = ?", [
      needle,
      needle,
    ]);
    return r ? rowToUser(r) : null;
  },
  create(db: AppDatabase, user: User): User {
    upsertRow(db, "users", userRow(user));
    return user;
  },
  update(db: AppDatabase, id: Id, patch: Partial<Omit<User, "id" | "createdAt">>): User {
    const current = usersRepo.get(db, id);
    if (!current) throw new Error("User not found");
    const next = applyPatch<User>(current, patch);
    upsertRow(db, "users", userRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM users WHERE id = ?", [id]);
  },
};

// =====================================================================
// App meta (key/value) & workspace activation
// =====================================================================

export const appMetaRepo = {
  get(db: AppDatabase, key: string): string | null {
    const r = db.get<{ value: string }>("SELECT value FROM app_meta WHERE key = ?", [key]);
    return r ? asStr(r.value) : null;
  },
  set(db: AppDatabase, key: string, value: string): void {
    db.run(
      "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  },
};

const WORKSPACE_MODE_KEY = "workspace_mode";

/** How this device's workspace was provisioned. Unset = first-run screen. */
export function getWorkspaceMode(db: AppDatabase): WorkspaceMode {
  const v = appMetaRepo.get(db, WORKSPACE_MODE_KEY);
  return v === "demo" || v === "activated" ? v : "unset";
}

export function setWorkspaceMode(db: AppDatabase, mode: Exclude<WorkspaceMode, "unset">): void {
  appMetaRepo.set(db, WORKSPACE_MODE_KEY, mode);
}

function rowToActivation(r: Row): ActivationState {
  return {
    licenseKey: asStr(r.license_key),
    companyId: asStr(r.company_id),
    companyName: asStr(r.company_name),
    licenseStatus: asStr(r.license_status) as LicenseStatus,
    statusReason: strOrNull(r.status_reason),
    plan: strOrNull(r.plan),
    activatedAt: asStr(r.activated_at),
    lastVerifiedAt: asStr(r.last_verified_at),
    graceDays: asNum(r.grace_days),
    directorySyncedAt: strOrNull(r.directory_synced_at),
  };
}

/** Single-row record describing the company license this device was activated with. */
export const activationRepo = {
  get(db: AppDatabase): ActivationState | null {
    const r = db.get("SELECT * FROM activation WHERE id = 'activation'");
    return r ? rowToActivation(r) : null;
  },
  set(db: AppDatabase, state: ActivationState): ActivationState {
    upsertRow(db, "activation", {
      id: "activation",
      license_key: state.licenseKey,
      company_id: state.companyId,
      company_name: state.companyName,
      license_status: state.licenseStatus,
      status_reason: state.statusReason,
      plan: state.plan,
      activated_at: state.activatedAt,
      last_verified_at: state.lastVerifiedAt,
      grace_days: state.graceDays,
      directory_synced_at: state.directorySyncedAt,
    });
    return state;
  },
  update(db: AppDatabase, patch: Partial<ActivationState>): ActivationState {
    const current = activationRepo.get(db);
    if (!current) throw new Error("Workspace is not activated");
    const next = applyPatch<ActivationState>(current, patch);
    return activationRepo.set(db, next);
  },
};

// =====================================================================
// Company profile
// =====================================================================

function rowToCompany(r: Row): CompanyProfile {
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    address: asStr(r.address),
    phone: asStr(r.phone),
    email: asStr(r.email),
    logoDataUrl: strOrNull(r.logo_data_url),
    notes: asStr(r.notes),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function companyRow(c: CompanyProfile): Row {
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    phone: c.phone,
    email: c.email,
    logo_data_url: c.logoDataUrl,
    notes: c.notes,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
  };
}

export const companyRepo = {
  get(db: AppDatabase): CompanyProfile | null {
    const r = db.get("SELECT * FROM company_profile ORDER BY created_at LIMIT 1");
    return r ? rowToCompany(r) : null;
  },
  getById(db: AppDatabase, id: Id): CompanyProfile | null {
    const r = db.get("SELECT * FROM company_profile WHERE id = ?", [id]);
    return r ? rowToCompany(r) : null;
  },
  create(db: AppDatabase, company: CompanyProfile): CompanyProfile {
    upsertRow(db, "company_profile", companyRow(company));
    return company;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<CompanyProfile, "id">>,
  ): CompanyProfile {
    const current = companyRepo.getById(db, id);
    if (!current) throw new Error("Company profile not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "company_profile", companyRow(next));
    return next;
  },
};

// =====================================================================
// Settings
// =====================================================================

function rowToSettings(r: Row): AppSettings {
  return {
    id: "app",
    companyProfileId: strOrNull(r.company_profile_id),
    defaultJurisdiction: asStr(r.default_jurisdiction),
    requireAttorneyReviewedTemplate: toBool(r.require_attorney_reviewed_template),
    allowAdminTemplateOverride: toBool(r.allow_admin_template_override),
    pinLockEnabled: toBool(r.pin_lock_enabled),
    autoLockMinutes: asNum(r.auto_lock_minutes),
    aiAssistEnabled: toBool(r.ai_assist_enabled),
    aiConsentAcknowledged: toBool(r.ai_consent_acknowledged),
    syncEnabled: toBool(r.sync_enabled),
    syncEndpoint: asStr(r.sync_endpoint),
    disclaimerAcknowledgedAt: strOrNull(r.disclaimer_acknowledged_at),
    onboardingCompleted: toBool(r.onboarding_completed),
    buildiumClientId: asStr(r.buildium_client_id),
    buildiumClientSecret: asStr(r.buildium_client_secret),
    buildiumConnectedAt: strOrNull(r.buildium_connected_at),
    buildiumLastSyncAt: strOrNull(r.buildium_last_sync_at),
    updatedAt: asStr(r.updated_at),
  };
}

function settingsRow(s: AppSettings): Row {
  return {
    id: s.id,
    company_profile_id: s.companyProfileId,
    default_jurisdiction: s.defaultJurisdiction,
    require_attorney_reviewed_template: fromBool(s.requireAttorneyReviewedTemplate),
    allow_admin_template_override: fromBool(s.allowAdminTemplateOverride),
    pin_lock_enabled: fromBool(s.pinLockEnabled),
    auto_lock_minutes: s.autoLockMinutes,
    ai_assist_enabled: fromBool(s.aiAssistEnabled),
    ai_consent_acknowledged: fromBool(s.aiConsentAcknowledged),
    sync_enabled: fromBool(s.syncEnabled),
    sync_endpoint: s.syncEndpoint,
    disclaimer_acknowledged_at: s.disclaimerAcknowledgedAt,
    onboarding_completed: fromBool(s.onboardingCompleted),
    buildium_client_id: s.buildiumClientId,
    buildium_client_secret: s.buildiumClientSecret,
    buildium_connected_at: s.buildiumConnectedAt,
    buildium_last_sync_at: s.buildiumLastSyncAt,
    updated_at: s.updatedAt,
  };
}

export const settingsRepo = {
  get(db: AppDatabase): AppSettings | null {
    const r = db.get("SELECT * FROM settings WHERE id = 'app'");
    return r ? rowToSettings(r) : null;
  },
  create(db: AppDatabase, settings: AppSettings): AppSettings {
    upsertRow(db, "settings", settingsRow(settings));
    return settings;
  },
  update(db: AppDatabase, patch: Partial<Omit<AppSettings, "id">>): AppSettings {
    const current = settingsRepo.get(db);
    if (!current) throw new Error("Settings not initialized");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "settings", settingsRow(next));
    return next;
  },
};

// =====================================================================
// Properties
// =====================================================================

function rowToProperty(r: Row): Property {
  return {
    id: asStr(r.id),
    nickname: asStr(r.nickname),
    addressLine1: asStr(r.address_line1),
    addressLine2: asStr(r.address_line2),
    city: asStr(r.city),
    state: asStr(r.state),
    zip: asStr(r.zip),
    county: asStr(r.county),
    bedrooms: r.bedrooms == null ? null : Number(r.bedrooms),
    units: parseJson<string[]>(r.units, []),
    ownerName: asStr(r.owner_name),
    managementCompany: asStr(r.management_company),
    managerContact: asStr(r.manager_contact),
    payment: { ...emptyPayment(), ...parseJson<Partial<PaymentProfile>>(r.payment, {}) },
    isLosAngelesCity: toBool(r.is_los_angeles_city),
    notes: asStr(r.notes),
    externalSource: strOrNull(r.external_source),
    externalId: strOrNull(r.external_id),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function propertyRow(p: Property): Row {
  return {
    id: p.id,
    nickname: p.nickname,
    address_line1: p.addressLine1,
    address_line2: p.addressLine2,
    city: p.city,
    state: p.state,
    zip: p.zip,
    county: p.county,
    bedrooms: p.bedrooms,
    units: toJson(p.units),
    owner_name: p.ownerName,
    management_company: p.managementCompany,
    manager_contact: p.managerContact,
    payment: toJson(p.payment),
    is_los_angeles_city: fromBool(p.isLosAngelesCity),
    notes: p.notes,
    external_source: p.externalSource,
    external_id: p.externalId,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
  };
}

export const propertiesRepo = {
  list(db: AppDatabase, search?: string): Property[] {
    const all = db
      .all("SELECT * FROM properties ORDER BY nickname")
      .map(rowToProperty);
    const q = (search ?? "").toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) =>
        p.nickname.toLowerCase().includes(q) ||
        p.addressLine1.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        p.ownerName.toLowerCase().includes(q),
    );
  },
  get(db: AppDatabase, id: Id): Property | null {
    const r = db.get("SELECT * FROM properties WHERE id = ?", [id]);
    return r ? rowToProperty(r) : null;
  },
  findByExternal(db: AppDatabase, source: string, externalId: string): Property | null {
    const r = db.get("SELECT * FROM properties WHERE external_source = ? AND external_id = ?", [
      source,
      externalId,
    ]);
    return r ? rowToProperty(r) : null;
  },
  create(db: AppDatabase, property: Property): Property {
    upsertRow(db, "properties", propertyRow(property));
    return property;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<Property, "id" | "createdAt">>,
  ): Property {
    const current = propertiesRepo.get(db, id);
    if (!current) throw new Error("Property not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "properties", propertyRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM properties WHERE id = ?", [id]);
  },
};

// =====================================================================
// Tenants
// =====================================================================

function rowToTenant(r: Row): Tenant {
  return {
    id: asStr(r.id),
    names: parseJson<string[]>(r.names, []),
    propertyId: strOrNull(r.property_id),
    unit: asStr(r.unit),
    email: asStr(r.email),
    phone: asStr(r.phone),
    monthlyRentCents: numOrNull(r.monthly_rent_cents),
    leaseStart: strOrNull(r.lease_start),
    moveOutDate: strOrNull(r.move_out_date),
    notes: asStr(r.notes),
    archived: toBool(r.archived),
    externalSource: strOrNull(r.external_source),
    externalId: strOrNull(r.external_id),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function tenantRow(t: Tenant): Row {
  return {
    id: t.id,
    names: toJson(t.names),
    property_id: t.propertyId,
    unit: t.unit,
    email: t.email,
    phone: t.phone,
    monthly_rent_cents: t.monthlyRentCents,
    lease_start: t.leaseStart,
    move_out_date: t.moveOutDate,
    notes: t.notes,
    archived: fromBool(t.archived),
    external_source: t.externalSource,
    external_id: t.externalId,
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export const tenantsRepo = {
  list(db: AppDatabase, search?: string, propertyId?: Id): Tenant[] {
    const all = db.all("SELECT * FROM tenants ORDER BY created_at").map(rowToTenant);
    const q = (search ?? "").toLowerCase();
    return all
      .filter((t) => !propertyId || t.propertyId === propertyId)
      .filter(
        (t) =>
          !q ||
          t.names.some((n) => n.toLowerCase().includes(q)) ||
          t.unit.toLowerCase().includes(q),
      );
  },
  get(db: AppDatabase, id: Id): Tenant | null {
    const r = db.get("SELECT * FROM tenants WHERE id = ?", [id]);
    return r ? rowToTenant(r) : null;
  },
  findByExternal(db: AppDatabase, source: string, externalId: string): Tenant | null {
    const r = db.get("SELECT * FROM tenants WHERE external_source = ? AND external_id = ?", [
      source,
      externalId,
    ]);
    return r ? rowToTenant(r) : null;
  },
  create(db: AppDatabase, tenant: Tenant): Tenant {
    upsertRow(db, "tenants", tenantRow(tenant));
    return tenant;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<Tenant, "id" | "createdAt">>,
  ): Tenant {
    const current = tenantsRepo.get(db, id);
    if (!current) throw new Error("Tenant not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "tenants", tenantRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM tenants WHERE id = ?", [id]);
  },
};

// =====================================================================
// Ledgers + ledger rows (transactions)
// =====================================================================

function rowToLedger(r: Row): Ledger {
  return {
    id: asStr(r.id),
    tenantId: asStr(r.tenant_id),
    name: asStr(r.name),
    sourceType: asStr(r.source_type) as LedgerSourceType,
    sourceFileName: strOrNull(r.source_file_name),
    vendor: asStr(r.vendor) as PmVendor,
    mappingUsed: parseJson<ColumnMapping | null>(r.mapping_used, null),
    importedAt: asStr(r.imported_at),
    importedBy: strOrNull(r.imported_by),
    transactionCount: asNum(r.transaction_count),
    periodStart: strOrNull(r.period_start),
    periodEnd: strOrNull(r.period_end),
    notes: asStr(r.notes),
  };
}

function ledgerRow(l: Ledger): Row {
  return {
    id: l.id,
    tenant_id: l.tenantId,
    name: l.name,
    source_type: l.sourceType,
    source_file_name: l.sourceFileName,
    vendor: l.vendor,
    mapping_used: toJson(l.mappingUsed),
    imported_at: l.importedAt,
    imported_by: l.importedBy,
    transaction_count: l.transactionCount,
    period_start: l.periodStart,
    period_end: l.periodEnd,
    notes: l.notes,
  };
}

function rowToTransaction(r: Row): LedgerTransaction {
  return {
    id: asStr(r.id),
    ledgerId: asStr(r.ledger_id),
    rowIndex: asNum(r.row_index),
    date: asStr(r.date),
    month: asStr(r.month),
    description: asStr(r.description),
    originalCategory: asStr(r.original_category),
    memo: asStr(r.memo),
    kind: asStr(r.kind) as TxnKind,
    amountCents: asNum(r.amount_cents),
    balanceCents: numOrNull(r.balance_cents),
    systemClass: asStr(r.system_class) as RentClass,
    confidence: asNum(r.confidence),
    includedInNotice: toBool(r.included_in_notice),
    classReason: asStr(r.class_reason),
    userOverrideClass: strOrNull(r.user_override_class) as RentClass | null,
    overrideReason: strOrNull(r.override_reason),
    overriddenBy: strOrNull(r.overridden_by),
    flagged: toBool(r.flagged),
    flagReason: strOrNull(r.flag_reason),
  };
}

function transactionRow(txn: LedgerTransaction): Row {
  return {
    id: txn.id,
    ledger_id: txn.ledgerId,
    row_index: txn.rowIndex,
    date: txn.date,
    month: txn.month,
    description: txn.description,
    original_category: txn.originalCategory,
    memo: txn.memo,
    kind: txn.kind,
    amount_cents: txn.amountCents,
    balance_cents: txn.balanceCents,
    system_class: txn.systemClass,
    confidence: txn.confidence,
    included_in_notice: fromBool(txn.includedInNotice),
    class_reason: txn.classReason,
    user_override_class: txn.userOverrideClass,
    override_reason: txn.overrideReason,
    overridden_by: txn.overriddenBy,
    flagged: fromBool(txn.flagged),
    flag_reason: txn.flagReason,
  };
}

export const ledgersRepo = {
  list(db: AppDatabase, tenantId?: Id): Ledger[] {
    const all = db
      .all("SELECT * FROM ledgers ORDER BY imported_at DESC")
      .map(rowToLedger);
    return tenantId ? all.filter((l) => l.tenantId === tenantId) : all;
  },
  get(db: AppDatabase, id: Id): Ledger | null {
    const r = db.get("SELECT * FROM ledgers WHERE id = ?", [id]);
    return r ? rowToLedger(r) : null;
  },
  listTransactions(db: AppDatabase, ledgerId: Id): LedgerTransaction[] {
    return db
      .all("SELECT * FROM ledger_rows WHERE ledger_id = ? ORDER BY row_index", [ledgerId])
      .map(rowToTransaction);
  },
  getDetail(db: AppDatabase, id: Id): LedgerDetail | null {
    const ledger = ledgersRepo.get(db, id);
    if (!ledger) return null;
    return { ledger, transactions: ledgersRepo.listTransactions(db, id) };
  },
  getTransaction(db: AppDatabase, id: Id): LedgerTransaction | null {
    const r = db.get("SELECT * FROM ledger_rows WHERE id = ?", [id]);
    return r ? rowToTransaction(r) : null;
  },
  create(db: AppDatabase, ledger: Ledger, transactions: LedgerTransaction[]): Ledger {
    db.transaction(() => {
      upsertRow(db, "ledgers", ledgerRow(ledger));
      for (const txn of transactions) upsertRow(db, "ledger_rows", transactionRow(txn));
    });
    return ledger;
  },
  saveTransaction(db: AppDatabase, txn: LedgerTransaction): LedgerTransaction {
    upsertRow(db, "ledger_rows", transactionRow(txn));
    return txn;
  },
  updateTransaction(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<LedgerTransaction, "id" | "ledgerId">>,
  ): LedgerTransaction {
    const current = ledgersRepo.getTransaction(db, id);
    if (!current) throw new Error("Transaction not found");
    const next = applyPatch<LedgerTransaction>(current, patch);
    upsertRow(db, "ledger_rows", transactionRow(next));
    return next;
  },
  /** Mirror of AppServices.overrideClassification (persistence half). */
  overrideClassification(
    db: AppDatabase,
    input: ClassificationOverrideInput,
    overriddenBy: Id | null,
  ): LedgerTransaction {
    const current = ledgersRepo.getTransaction(db, input.transactionId);
    if (!current) throw new Error("Transaction not found");
    const next: LedgerTransaction = {
      ...current,
      userOverrideClass: input.overrideClass,
      includedInNotice: input.includedInNotice,
      overrideReason: input.reason,
      overriddenBy,
      flagged: false,
    };
    upsertRow(db, "ledger_rows", transactionRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.transaction(() => {
      db.run("DELETE FROM ledger_rows WHERE ledger_id = ?", [id]);
      db.run("DELETE FROM ledgers WHERE id = ?", [id]);
    });
  },
};

// =====================================================================
// Mapping presets
// =====================================================================

function rowToMappingPreset(r: Row): MappingPreset {
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    vendor: asStr(r.vendor) as PmVendor,
    mapping: parseJson<ColumnMapping>(r.mapping, {} as ColumnMapping),
    createdAt: asStr(r.created_at),
  };
}

function mappingPresetRow(p: MappingPreset): Row {
  return {
    id: p.id,
    name: p.name,
    vendor: p.vendor,
    mapping: toJson(p.mapping),
    created_at: p.createdAt,
  };
}

export const mappingPresetsRepo = {
  list(db: AppDatabase): MappingPreset[] {
    return db
      .all("SELECT * FROM mapping_presets ORDER BY created_at")
      .map(rowToMappingPreset);
  },
  get(db: AppDatabase, id: Id): MappingPreset | null {
    const r = db.get("SELECT * FROM mapping_presets WHERE id = ?", [id]);
    return r ? rowToMappingPreset(r) : null;
  },
  create(db: AppDatabase, preset: MappingPreset): MappingPreset {
    upsertRow(db, "mapping_presets", mappingPresetRow(preset));
    return preset;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM mapping_presets WHERE id = ?", [id]);
  },
};

// =====================================================================
// Attorney contacts (saved address book for the secure-link dialog)
// =====================================================================

function rowToAttorneyContact(r: Row): AttorneyContact {
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    email: asStr(r.email),
    createdAt: asStr(r.created_at),
  };
}

export const attorneyContactsRepo = {
  list(db: AppDatabase): AttorneyContact[] {
    return db
      .all("SELECT * FROM attorney_contacts ORDER BY lower(name), lower(email)")
      .map(rowToAttorneyContact);
  },
  findByEmail(db: AppDatabase, email: string): AttorneyContact | null {
    const r = db.get("SELECT * FROM attorney_contacts WHERE lower(email) = lower(?)", [
      email.trim(),
    ]);
    return r ? rowToAttorneyContact(r) : null;
  },
  create(db: AppDatabase, contact: AttorneyContact): AttorneyContact {
    upsertRow(db, "attorney_contacts", {
      id: contact.id,
      name: contact.name,
      email: contact.email,
      created_at: contact.createdAt,
    });
    return contact;
  },
  updateName(db: AppDatabase, id: Id, name: string): AttorneyContact {
    db.run("UPDATE attorney_contacts SET name = ? WHERE id = ?", [name, id]);
    const r = db.get("SELECT * FROM attorney_contacts WHERE id = ?", [id]);
    if (!r) throw new Error("Attorney contact not found");
    return rowToAttorneyContact(r);
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM attorney_contacts WHERE id = ?", [id]);
  },
};

// =====================================================================
// Calculations (cached per ledger)
// =====================================================================

function rowToCalculation(r: Row): CalculationResult {
  return {
    ledgerId: asStr(r.ledger_id),
    months: parseJson<MonthCalculation[]>(r.months, []),
    totalRentOnlyCents: asNum(r.total_rent_only_cents),
    totalExcludedCents: asNum(r.total_excluded_cents),
    unappliedPaymentsCents: asNum(r.unapplied_payments_cents),
    globalWarnings: parseJson<string[]>(r.global_warnings, []),
    computedAt: asStr(r.computed_at),
  };
}

function calculationRow(c: CalculationResult): Row {
  return {
    ledger_id: c.ledgerId,
    months: toJson(c.months),
    total_rent_only_cents: c.totalRentOnlyCents,
    total_excluded_cents: c.totalExcludedCents,
    unapplied_payments_cents: c.unappliedPaymentsCents,
    global_warnings: toJson(c.globalWarnings),
    computed_at: c.computedAt,
  };
}

export const calculationsRepo = {
  get(db: AppDatabase, ledgerId: Id): CalculationResult | null {
    const r = db.get("SELECT * FROM calculations WHERE ledger_id = ?", [ledgerId]);
    return r ? rowToCalculation(r) : null;
  },
  upsert(db: AppDatabase, calc: CalculationResult): CalculationResult {
    upsertRow(db, "calculations", calculationRow(calc));
    return calc;
  },
  remove(db: AppDatabase, ledgerId: Id): void {
    db.run("DELETE FROM calculations WHERE ledger_id = ?", [ledgerId]);
  },
};

// =====================================================================
// Notices (+ status history)
// =====================================================================

function rowToNotice(r: Row): Notice {
  return {
    id: asStr(r.id),
    noticeType: asStr(r.notice_type) as NoticeType,
    jurisdiction: asStr(r.jurisdiction),
    status: asStr(r.status) as NoticeStatus,
    tenantId: asStr(r.tenant_id),
    propertyId: asStr(r.property_id),
    unit: asStr(r.unit),
    tenantNames: parseJson<string[]>(r.tenant_names, []),
    propertyAddress: asStr(r.property_address),
    ledgerId: strOrNull(r.ledger_id),
    months: parseJson<NoticeMonth[]>(r.months, []),
    totalAmountCents: asNum(r.total_amount_cents),
    payment: parseJson<PaymentProfile>(r.payment, emptyPayment()),
    templateId: strOrNull(r.template_id),
    templateVersion: numOrNull(r.template_version),
    includeLahdLetter: toBool(r.include_lahd_letter),
    covenantDescription: asStr(r.covenant_description),
    entryDate: strOrNull(r.entry_date),
    entryTimeWindow: asStr(r.entry_time_window),
    entryReason: asStr(r.entry_reason),
    terminationDate: strOrNull(r.termination_date),
    rentIncreaseNewAmountCents: numOrNull(r.rent_increase_new_amount_cents),
    rentIncreaseEffectiveDate: strOrNull(r.rent_increase_effective_date),
    version: asNum(r.version),
    revisedFromId: strOrNull(r.revised_from_id),
    reviewerApprovedBy: strOrNull(r.reviewer_approved_by),
    reviewerApprovedAt: strOrNull(r.reviewer_approved_at),
    finalizedBy: strOrNull(r.finalized_by),
    finalizedAt: strOrNull(r.finalized_at),
    rentOnlyAttestedBy: strOrNull(r.rent_only_attested_by),
    rentOnlyAttestedAt: strOrNull(r.rent_only_attested_at),
    localOverlayVerifiedBy: strOrNull(r.local_overlay_verified_by),
    localOverlayVerifiedAt: strOrNull(r.local_overlay_verified_at),
    attorneyExportFlag: toBool(r.attorney_export_flag),
    prereqCompleted: parseJson<Record<string, boolean>>(r.prereq_completed, {}),
    ruleCardKey: strOrNull(r.rule_card_key),
    electronicServiceConsent: toBool(r.electronic_service_consent),
    service: {
      dateServed: strOrNull(r.service_date_served),
      timeServed: strOrNull(r.service_time_served),
      method: strOrNull(r.service_method) as ServiceMethod | null,
      servedBy: asStr(r.service_served_by),
      serverNotes: asStr(r.service_server_notes),
      mailedDate: strOrNull(r.service_mailed_date),
    },
    deadlineDate: strOrNull(r.deadline_date),
    courtDate: strOrNull(r.court_date),
    courtCaseNumber: asStr(r.court_case_number),
    courtNotes: asStr(r.court_notes),
    internalNotes: asStr(r.internal_notes),
    preparedBy: strOrNull(r.prepared_by),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function noticeRow(n: Notice): Row {
  return {
    id: n.id,
    notice_type: n.noticeType,
    jurisdiction: n.jurisdiction,
    status: n.status,
    tenant_id: n.tenantId,
    property_id: n.propertyId,
    unit: n.unit,
    tenant_names: toJson(n.tenantNames),
    property_address: n.propertyAddress,
    ledger_id: n.ledgerId,
    months: toJson(n.months),
    total_amount_cents: n.totalAmountCents,
    payment: toJson(n.payment),
    template_id: n.templateId,
    template_version: n.templateVersion,
    include_lahd_letter: fromBool(n.includeLahdLetter),
    covenant_description: n.covenantDescription,
    entry_date: n.entryDate,
    entry_time_window: n.entryTimeWindow,
    entry_reason: n.entryReason,
    termination_date: n.terminationDate,
    rent_increase_new_amount_cents: n.rentIncreaseNewAmountCents,
    rent_increase_effective_date: n.rentIncreaseEffectiveDate,
    version: n.version,
    revised_from_id: n.revisedFromId,
    reviewer_approved_by: n.reviewerApprovedBy,
    reviewer_approved_at: n.reviewerApprovedAt,
    finalized_by: n.finalizedBy,
    finalized_at: n.finalizedAt,
    rent_only_attested_by: n.rentOnlyAttestedBy,
    rent_only_attested_at: n.rentOnlyAttestedAt,
    local_overlay_verified_by: n.localOverlayVerifiedBy,
    local_overlay_verified_at: n.localOverlayVerifiedAt,
    attorney_export_flag: fromBool(n.attorneyExportFlag),
    prereq_completed: toJson(n.prereqCompleted),
    rule_card_key: n.ruleCardKey,
    electronic_service_consent: fromBool(n.electronicServiceConsent),
    service_date_served: n.service.dateServed,
    service_time_served: n.service.timeServed,
    service_method: n.service.method,
    service_served_by: n.service.servedBy,
    service_server_notes: n.service.serverNotes,
    service_mailed_date: n.service.mailedDate,
    deadline_date: n.deadlineDate,
    court_date: n.courtDate,
    court_case_number: n.courtCaseNumber,
    court_notes: n.courtNotes,
    internal_notes: n.internalNotes,
    prepared_by: n.preparedBy,
    created_at: n.createdAt,
    updated_at: n.updatedAt,
  };
}

function matchesNoticeFilters(n: Notice, f: NoticeFilters): boolean {
  if (f.search) {
    const q = f.search.toLowerCase();
    const hit =
      n.tenantNames.some((x) => x.toLowerCase().includes(q)) ||
      n.propertyAddress.toLowerCase().includes(q) ||
      n.unit.toLowerCase().includes(q);
    if (!hit) return false;
  }
  if (f.status && f.status !== "all" && n.status !== f.status) return false;
  if (f.noticeType && f.noticeType !== "all" && n.noticeType !== f.noticeType) return false;
  if (f.propertyId && f.propertyId !== "all" && n.propertyId !== f.propertyId) return false;
  if (f.tenantId && n.tenantId !== f.tenantId) return false;
  if (f.month && !n.months.some((m) => m.month === f.month)) return false;
  if (f.createdFrom && n.createdAt < f.createdFrom) return false;
  if (f.createdTo && n.createdAt > `${f.createdTo}T23:59:59`) return false;
  if (f.servedFrom && (n.service.dateServed ?? "") < f.servedFrom) return false;
  if (f.servedTo && (n.service.dateServed ?? "9999") > f.servedTo) return false;
  if (f.amountMinCents != null && n.totalAmountCents < f.amountMinCents) return false;
  if (f.amountMaxCents != null && n.totalAmountCents > f.amountMaxCents) return false;
  if (f.preparedBy && f.preparedBy !== "all" && n.preparedBy !== f.preparedBy) return false;
  return true;
}

export const noticesRepo = {
  list(db: AppDatabase, filters?: NoticeFilters): Notice[] {
    const all = db
      .all("SELECT * FROM notices ORDER BY created_at DESC")
      .map(rowToNotice);
    return filters ? all.filter((n) => matchesNoticeFilters(n, filters)) : all;
  },
  get(db: AppDatabase, id: Id): Notice | null {
    const r = db.get("SELECT * FROM notices WHERE id = ?", [id]);
    return r ? rowToNotice(r) : null;
  },
  create(db: AppDatabase, notice: Notice): Notice {
    upsertRow(db, "notices", noticeRow(notice));
    return notice;
  },
  save(db: AppDatabase, notice: Notice): Notice {
    upsertRow(db, "notices", noticeRow(notice));
    return notice;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<Notice, "id" | "createdAt">>,
  ): Notice {
    const current = noticesRepo.get(db, id);
    if (!current) throw new Error("Notice not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "notices", noticeRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.transaction(() => {
      db.run("DELETE FROM status_history WHERE notice_id = ?", [id]);
      db.run("DELETE FROM validation_results WHERE notice_id = ?", [id]);
      db.run("DELETE FROM documents WHERE notice_id = ?", [id]);
      db.run("DELETE FROM notices WHERE id = ?", [id]);
    });
  },
  checkDuplicate(
    db: AppDatabase,
    params: {
      tenantId: Id;
      propertyId: Id;
      unit: string;
      months: string[];
      noticeType: NoticeType;
    },
  ): DuplicateCheckResult {
    const existing = db
      .all("SELECT * FROM notices WHERE tenant_id = ? AND property_id = ?", [
        params.tenantId,
        params.propertyId,
      ])
      .map(rowToNotice)
      .filter((n) => {
        if (n.unit !== params.unit) return false;
        if (n.noticeType !== params.noticeType) return false;
        if (["cancelled", "revised"].includes(n.status)) return false;
        // Monetary notices (pay-or-quit, perform-covenant) carry rent months;
        // treat them as duplicates only when a demanded month overlaps. Non-
        // monetary notices (entry, termination, rent increase) carry no months,
        // so any active same tenant/property/unit/type notice is a duplicate.
        if (params.months.length === 0 || n.months.length === 0) return true;
        return n.months.some((m) => params.months.includes(m.month));
      });
    return { duplicate: existing.length > 0, existing };
  },
};

// --- Status history -------------------------------------------------------

function rowToStatusHistory(r: Row): StatusHistoryEntry {
  return {
    id: asStr(r.id),
    noticeId: asStr(r.notice_id),
    fromStatus: strOrNull(r.from_status) as NoticeStatus | null,
    toStatus: asStr(r.to_status) as NoticeStatus,
    changedBy: strOrNull(r.changed_by),
    changedAt: asStr(r.changed_at),
    reason: asStr(r.reason),
  };
}

function statusHistoryRow(s: StatusHistoryEntry): Row {
  return {
    id: s.id,
    notice_id: s.noticeId,
    from_status: s.fromStatus,
    to_status: s.toStatus,
    changed_by: s.changedBy,
    changed_at: s.changedAt,
    reason: s.reason,
  };
}

export const statusHistoryRepo = {
  listByNotice(db: AppDatabase, noticeId: Id): StatusHistoryEntry[] {
    return db
      .all("SELECT * FROM status_history WHERE notice_id = ? ORDER BY changed_at DESC", [noticeId])
      .map(rowToStatusHistory);
  },
  create(db: AppDatabase, entry: StatusHistoryEntry): StatusHistoryEntry {
    upsertRow(db, "status_history", statusHistoryRow(entry));
    return entry;
  },
};

// =====================================================================
// Validation results (cached per notice)
// =====================================================================

function rowToValidation(r: Row): ValidationResult {
  return {
    noticeId: asStr(r.notice_id),
    issues: parseJson<ValidationIssue[]>(r.issues, []),
    blockers: asNum(r.blockers),
    warnings: asNum(r.warnings),
    passed: toBool(r.passed),
  };
}

function validationRow(v: ValidationResult, computedAt: string): Row {
  return {
    notice_id: v.noticeId,
    issues: toJson(v.issues),
    blockers: v.blockers,
    warnings: v.warnings,
    passed: fromBool(v.passed),
    computed_at: computedAt,
  };
}

export const validationResultsRepo = {
  get(db: AppDatabase, noticeId: Id): ValidationResult | null {
    const r = db.get("SELECT * FROM validation_results WHERE notice_id = ?", [noticeId]);
    return r ? rowToValidation(r) : null;
  },
  upsert(db: AppDatabase, result: ValidationResult, computedAt = nowIso()): ValidationResult {
    upsertRow(db, "validation_results", validationRow(result, computedAt));
    return result;
  },
  remove(db: AppDatabase, noticeId: Id): void {
    db.run("DELETE FROM validation_results WHERE notice_id = ?", [noticeId]);
  },
};

// =====================================================================
// Documents (PDF bytes stored as BLOB)
// =====================================================================

function rowToDocument(r: Row): NoticeDocument {
  const bytes = asBytes(r.bytes);
  const mimeType = asStr(r.mime_type) || "application/pdf";
  const blobUrl = bytes
    ? URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType }))
    : "";
  return {
    id: asStr(r.id),
    noticeId: asStr(r.notice_id),
    kind: asStr(r.kind) as NoticeDocument["kind"],
    packetKind: strOrNull(r.packet_kind) as NoticeDocument["packetKind"],
    fileName: asStr(r.file_name),
    watermarked: toBool(r.watermarked),
    locked: toBool(r.locked),
    pageCount: asNum(r.page_count),
    sizeBytes: asNum(r.size_bytes),
    generatedAt: asStr(r.generated_at),
    generatedBy: strOrNull(r.generated_by),
    mimeType,
    blobUrl,
  };
}

function documentRow(doc: NoticeDocument, bytes: Uint8Array | null): Row {
  return {
    id: doc.id,
    notice_id: doc.noticeId,
    kind: doc.kind,
    packet_kind: doc.packetKind,
    file_name: doc.fileName,
    watermarked: fromBool(doc.watermarked),
    locked: fromBool(doc.locked),
    page_count: doc.pageCount,
    size_bytes: doc.sizeBytes,
    generated_at: doc.generatedAt,
    generated_by: doc.generatedBy,
    mime_type: doc.mimeType || "application/pdf",
    bytes: bytes ?? null,
  };
}

export const documentsRepo = {
  listByNotice(db: AppDatabase, noticeId: Id): NoticeDocument[] {
    return db
      .all("SELECT * FROM documents WHERE notice_id = ? ORDER BY generated_at", [noticeId])
      .map(rowToDocument);
  },
  get(db: AppDatabase, id: Id): NoticeDocument | null {
    const r = db.get("SELECT * FROM documents WHERE id = ?", [id]);
    return r ? rowToDocument(r) : null;
  },
  getBytes(db: AppDatabase, id: Id): Uint8Array | null {
    const r = db.get<{ bytes: SqlValue }>("SELECT bytes FROM documents WHERE id = ?", [id]);
    return r ? asBytes(r.bytes) : null;
  },
  create(db: AppDatabase, doc: NoticeDocument, bytes: Uint8Array | null): NoticeDocument {
    upsertRow(db, "documents", documentRow(doc, bytes));
    return doc;
  },
  removeByNoticeAndPacket(
    db: AppDatabase,
    noticeId: Id,
    packetKind: NoticeDocument["packetKind"],
  ): void {
    if (packetKind == null) {
      db.run("DELETE FROM documents WHERE notice_id = ? AND packet_kind IS NULL", [noticeId]);
    } else {
      db.run("DELETE FROM documents WHERE notice_id = ? AND packet_kind = ?", [
        noticeId,
        packetKind,
      ]);
    }
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM documents WHERE id = ?", [id]);
  },
};

// =====================================================================
// Attorney referral links (plaintext secure links, local-only)
// =====================================================================

export const attorneyReferralLinksRepo = {
  save(db: AppDatabase, entry: { referralId: Id; noticeId: Id; link: string; createdAt: string }): void {
    upsertRow(db, "attorney_referral_links", {
      referral_id: entry.referralId,
      notice_id: entry.noticeId,
      link: entry.link,
      created_at: entry.createdAt,
    });
  },
  /** Map of referralId -> plaintext link for one notice. */
  listByNotice(db: AppDatabase, noticeId: Id): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of db.all("SELECT referral_id, link FROM attorney_referral_links WHERE notice_id = ?", [noticeId])) {
      out[asStr(r.referral_id)] = asStr(r.link);
    }
    return out;
  },
};

// =====================================================================
// Templates
// =====================================================================

function rowToTemplate(r: Row): NoticeTemplate {
  return {
    id: asStr(r.id),
    name: asStr(r.name),
    noticeType: asStr(r.notice_type) as NoticeType,
    jurisdiction: asStr(r.jurisdiction),
    locality: strOrNull(r.locality),
    active: toBool(r.active),
    attorneyReviewed: toBool(r.attorney_reviewed),
    reviewedBy: asStr(r.reviewed_by),
    reviewDate: strOrNull(r.review_date),
    currentVersion: asNum(r.current_version),
    versions: parseJson<TemplateVersion[]>(r.versions, []),
    mergeFields: parseJson<string[]>(r.merge_fields, []),
    builtIn: toBool(r.built_in),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function templateRow(t: NoticeTemplate): Row {
  return {
    id: t.id,
    name: t.name,
    notice_type: t.noticeType,
    jurisdiction: t.jurisdiction,
    locality: t.locality,
    active: fromBool(t.active),
    attorney_reviewed: fromBool(t.attorneyReviewed),
    reviewed_by: t.reviewedBy,
    review_date: t.reviewDate,
    current_version: t.currentVersion,
    versions: toJson(t.versions),
    merge_fields: toJson(t.mergeFields),
    built_in: fromBool(t.builtIn),
    created_at: t.createdAt,
    updated_at: t.updatedAt,
  };
}

export const templatesRepo = {
  list(
    db: AppDatabase,
    filters?: { noticeType?: NoticeType; jurisdiction?: string },
  ): NoticeTemplate[] {
    return db
      .all("SELECT * FROM templates ORDER BY created_at")
      .map(rowToTemplate)
      .filter(
        (t) =>
          (!filters?.noticeType || t.noticeType === filters.noticeType) &&
          (!filters?.jurisdiction || t.jurisdiction === filters.jurisdiction),
      );
  },
  get(db: AppDatabase, id: Id): NoticeTemplate | null {
    const r = db.get("SELECT * FROM templates WHERE id = ?", [id]);
    return r ? rowToTemplate(r) : null;
  },
  create(db: AppDatabase, template: NoticeTemplate): NoticeTemplate {
    upsertRow(db, "templates", templateRow(template));
    return template;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<NoticeTemplate, "id" | "createdAt">>,
  ): NoticeTemplate {
    const current = templatesRepo.get(db, id);
    if (!current) throw new Error("Template not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "templates", templateRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM templates WHERE id = ?", [id]);
  },
};

// =====================================================================
// Holidays
// =====================================================================

function rowToHoliday(r: Row): Holiday {
  return {
    id: asStr(r.id),
    date: asStr(r.date),
    name: asStr(r.name),
    jurisdiction: asStr(r.jurisdiction),
    courtHoliday: toBool(r.court_holiday),
    builtIn: toBool(r.built_in),
  };
}

function holidayRow(h: Holiday): Row {
  return {
    id: h.id,
    date: h.date,
    name: h.name,
    jurisdiction: h.jurisdiction,
    court_holiday: fromBool(h.courtHoliday),
    built_in: fromBool(h.builtIn),
  };
}

export const holidaysRepo = {
  list(db: AppDatabase, year?: number): Holiday[] {
    const all = db.all("SELECT * FROM holidays ORDER BY date").map(rowToHoliday);
    return year ? all.filter((h) => h.date.startsWith(String(year))) : all;
  },
  get(db: AppDatabase, id: Id): Holiday | null {
    const r = db.get("SELECT * FROM holidays WHERE id = ?", [id]);
    return r ? rowToHoliday(r) : null;
  },
  create(db: AppDatabase, holiday: Holiday): Holiday {
    upsertRow(db, "holidays", holidayRow(holiday));
    return holiday;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM holidays WHERE id = ?", [id]);
  },
};

// =====================================================================
// State rule attorney reviews
// =====================================================================

function rowToStateRuleReview(r: Row): StateRuleReview {
  return {
    state: asStr(r.state),
    reviewerName: asStr(r.reviewer_name),
    reviewedAt: asStr(r.reviewed_at),
    notes: asStr(r.notes),
    recordedBy: strOrNull(r.recorded_by),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function stateRuleReviewRow(review: StateRuleReview): Row {
  return {
    state: review.state,
    reviewer_name: review.reviewerName,
    reviewed_at: review.reviewedAt,
    notes: review.notes,
    recorded_by: review.recordedBy,
    created_at: review.createdAt,
    updated_at: review.updatedAt,
  };
}

export const stateRuleReviewsRepo = {
  list(db: AppDatabase): StateRuleReview[] {
    return db.all("SELECT * FROM state_rule_reviews ORDER BY state").map(rowToStateRuleReview);
  },
  get(db: AppDatabase, state: string): StateRuleReview | null {
    const r = db.get("SELECT * FROM state_rule_reviews WHERE state = ?", [
      state.toUpperCase(),
    ]);
    return r ? rowToStateRuleReview(r) : null;
  },
  upsert(db: AppDatabase, review: StateRuleReview): StateRuleReview {
    const normalized = { ...review, state: review.state.toUpperCase() };
    upsertRow(db, "state_rule_reviews", stateRuleReviewRow(normalized));
    return normalized;
  },
  remove(db: AppDatabase, state: string): void {
    db.run("DELETE FROM state_rule_reviews WHERE state = ?", [state.toUpperCase()]);
  },
};

// =====================================================================
// Audit log
// =====================================================================

function rowToAudit(r: Row): AuditEntry {
  return {
    id: asStr(r.id),
    timestamp: asStr(r.timestamp),
    userId: strOrNull(r.user_id),
    userName: asStr(r.user_name),
    action: asStr(r.action) as AuditAction,
    entityType: asStr(r.entity_type),
    entityId: strOrNull(r.entity_id),
    summary: asStr(r.summary),
    previousValue: strOrNull(r.previous_value),
    newValue: strOrNull(r.new_value),
    reason: strOrNull(r.reason),
  };
}

function auditRow(a: AuditEntry): Row {
  return {
    id: a.id,
    timestamp: a.timestamp,
    user_id: a.userId,
    user_name: a.userName,
    action: a.action,
    entity_type: a.entityType,
    entity_id: a.entityId,
    summary: a.summary,
    previous_value: a.previousValue,
    new_value: a.newValue,
    reason: a.reason,
  };
}

/**
 * Resolve audit entries back to the property/unit their subject belongs to.
 * Covers entries whose subject is a tenant, notice, ledger, work order, or the
 * property itself. Entities that have since been deleted cannot be resolved
 * and are excluded when a property/unit filter is active.
 */
function buildPropertyUnitResolver(db: AppDatabase): (
  entityType: string,
  entityId: string | null,
) => { propertyId: string | null; unit: string | null } | null {
  const tenantLoc = new Map<string, { propertyId: string | null; unit: string | null }>();
  for (const r of db.all("SELECT id, property_id, unit FROM tenants")) {
    tenantLoc.set(asStr(r.id), { propertyId: strOrNull(r.property_id), unit: strOrNull(r.unit) });
  }
  const noticeLoc = new Map<string, { propertyId: string | null; unit: string | null }>();
  for (const r of db.all("SELECT id, property_id, unit FROM notices")) {
    noticeLoc.set(asStr(r.id), { propertyId: strOrNull(r.property_id), unit: strOrNull(r.unit) });
  }
  const ledgerTenant = new Map<string, string>();
  for (const r of db.all("SELECT id, tenant_id FROM ledgers")) {
    ledgerTenant.set(asStr(r.id), asStr(r.tenant_id));
  }
  const workOrderLoc = new Map<string, { propertyId: string | null; unit: string | null }>();
  for (const r of db.all("SELECT id, property_id, unit FROM work_orders")) {
    workOrderLoc.set(asStr(r.id), { propertyId: strOrNull(r.property_id), unit: strOrNull(r.unit) });
  }
  return (entityType, entityId) => {
    if (!entityId) return null;
    switch (entityType) {
      case "property":
        return { propertyId: entityId, unit: null };
      case "tenant":
        return tenantLoc.get(entityId) ?? null;
      case "notice":
        return noticeLoc.get(entityId) ?? null;
      case "ledger": {
        const tenantId = ledgerTenant.get(entityId);
        return tenantId ? (tenantLoc.get(tenantId) ?? null) : null;
      }
      case "work_order":
        return workOrderLoc.get(entityId) ?? null;
      default:
        return null;
    }
  };
}

export const auditRepo = {
  list(db: AppDatabase, filters?: AuditFilters): AuditEntry[] {
    let all = db.all("SELECT * FROM audit_log ORDER BY timestamp DESC").map(rowToAudit);
    if (filters) {
      if (filters.entityType) all = all.filter((a) => a.entityType === filters.entityType);
      if (filters.entityId) all = all.filter((a) => a.entityId === filters.entityId);
      if (filters.userId) all = all.filter((a) => a.userId === filters.userId);
      if (filters.action) all = all.filter((a) => a.action === filters.action);
      if (filters.actions && filters.actions.length > 0) {
        const set = new Set<string>(filters.actions);
        all = all.filter((a) => set.has(a.action));
      }
      if (filters.propertyId || filters.unit) {
        const resolve = buildPropertyUnitResolver(db);
        all = all.filter((a) => {
          const loc = resolve(a.entityType, a.entityId);
          if (!loc) return false;
          if (filters.propertyId && loc.propertyId !== filters.propertyId) return false;
          if (filters.unit && loc.unit !== filters.unit) return false;
          return true;
        });
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        all = all.filter(
          (a) =>
            a.summary.toLowerCase().includes(q) ||
            a.userName.toLowerCase().includes(q),
        );
      }
      if (filters.from) all = all.filter((a) => a.timestamp >= filters.from!);
      if (filters.to) all = all.filter((a) => a.timestamp <= `${filters.to}T23:59:59`);
    }
    const limit = filters?.limit ?? 200;
    if (limit === 0) return all;
    return all.slice(0, limit);
  },
  create(db: AppDatabase, entry: AuditEntry): AuditEntry {
    upsertRow(db, "audit_log", auditRow(entry));
    return entry;
  },
};

// =====================================================================
// Attachments (binary payload stored as BLOB, exposed as data URL)
// =====================================================================

function rowToAttachment(r: Row): Attachment {
  const bytes = asBytes(r.bytes);
  const mime = asStr(r.mime_type);
  return {
    id: asStr(r.id),
    entityType: asStr(r.entity_type) as Attachment["entityType"],
    entityId: asStr(r.entity_id),
    kind: asStr(r.kind) as Attachment["kind"],
    fileName: asStr(r.file_name),
    mimeType: mime,
    sizeBytes: asNum(r.size_bytes),
    dataUrl: bytes ? bytesToDataUrl(bytes, mime) : "",
    uploadedBy: strOrNull(r.uploaded_by),
    uploadedAt: asStr(r.uploaded_at),
    note: asStr(r.note),
  };
}

function attachmentRow(a: Attachment): Row {
  const { bytes } = dataUrlToBytes(a.dataUrl);
  return {
    id: a.id,
    entity_type: a.entityType,
    entity_id: a.entityId,
    kind: a.kind,
    file_name: a.fileName,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    bytes,
    uploaded_by: a.uploadedBy,
    uploaded_at: a.uploadedAt,
    note: a.note,
  };
}

export const attachmentsRepo = {
  list(
    db: AppDatabase,
    entityType: Attachment["entityType"],
    entityId: Id,
  ): Attachment[] {
    return db
      .all("SELECT * FROM attachments WHERE entity_type = ? AND entity_id = ? ORDER BY uploaded_at", [
        entityType,
        entityId,
      ])
      .map(rowToAttachment);
  },
  get(db: AppDatabase, id: Id): Attachment | null {
    const r = db.get("SELECT * FROM attachments WHERE id = ?", [id]);
    return r ? rowToAttachment(r) : null;
  },
  create(db: AppDatabase, attachment: Attachment): Attachment {
    upsertRow(db, "attachments", attachmentRow(attachment));
    return attachment;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM attachments WHERE id = ?", [id]);
  },
};

// =====================================================================
// Field assignments (+ evidence photos as BLOB)
// =====================================================================

function rowToEvidence(r: Row): FieldEvidence {
  const bytes = asBytes(r.photo_bytes);
  const mime = asStr(r.photo_mime);
  return {
    id: asStr(r.id),
    photoDataUrl: bytes ? bytesToDataUrl(bytes, mime) : "",
    latitude: numOrNull(r.latitude),
    longitude: numOrNull(r.longitude),
    accuracyMeters: numOrNull(r.accuracy_meters),
    capturedAt: asStr(r.captured_at),
    note: asStr(r.note),
  };
}

function evidenceRow(assignmentId: Id, e: FieldEvidence, orderIndex: number): Row {
  const { bytes, mime } = dataUrlToBytes(e.photoDataUrl);
  return {
    id: e.id,
    assignment_id: assignmentId,
    photo_bytes: bytes,
    photo_mime: mime || "image/jpeg",
    latitude: e.latitude,
    longitude: e.longitude,
    accuracy_meters: e.accuracyMeters,
    captured_at: e.capturedAt,
    note: e.note,
    order_index: orderIndex,
  };
}

function rowToAssignment(r: Row, evidence: FieldEvidence[]): FieldAssignment {
  return {
    id: asStr(r.id),
    noticeId: asStr(r.notice_id),
    assigneeName: asStr(r.assignee_name),
    instructions: asStr(r.instructions),
    status: asStr(r.status) as FieldAssignmentStatus,
    serviceMethod: strOrNull(r.service_method) as ServiceMethod | null,
    completedAt: strOrNull(r.completed_at),
    evidence,
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function assignmentRow(a: FieldAssignment): Row {
  return {
    id: a.id,
    notice_id: a.noticeId,
    assignee_name: a.assigneeName,
    instructions: a.instructions,
    status: a.status,
    service_method: a.serviceMethod,
    completed_at: a.completedAt,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

function loadEvidence(db: AppDatabase, assignmentId: Id): FieldEvidence[] {
  return db
    .all("SELECT * FROM field_evidence WHERE assignment_id = ? ORDER BY order_index", [assignmentId])
    .map(rowToEvidence);
}

function writeEvidence(db: AppDatabase, assignmentId: Id, evidence: FieldEvidence[]): void {
  db.run("DELETE FROM field_evidence WHERE assignment_id = ?", [assignmentId]);
  evidence.forEach((e, i) => upsertRow(db, "field_evidence", evidenceRow(assignmentId, e, i)));
}

export const fieldAssignmentsRepo = {
  list(db: AppDatabase, noticeId?: Id): FieldAssignment[] {
    const rows = noticeId
      ? db.all("SELECT * FROM field_assignments WHERE notice_id = ? ORDER BY created_at", [noticeId])
      : db.all("SELECT * FROM field_assignments ORDER BY created_at");
    return rows.map((r) => rowToAssignment(r, loadEvidence(db, asStr(r.id))));
  },
  get(db: AppDatabase, id: Id): FieldAssignment | null {
    const r = db.get("SELECT * FROM field_assignments WHERE id = ?", [id]);
    return r ? rowToAssignment(r, loadEvidence(db, id)) : null;
  },
  create(db: AppDatabase, assignment: FieldAssignment): FieldAssignment {
    db.transaction(() => {
      upsertRow(db, "field_assignments", assignmentRow(assignment));
      writeEvidence(db, assignment.id, assignment.evidence);
    });
    return assignment;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<FieldAssignment, "id" | "noticeId" | "createdAt">>,
  ): FieldAssignment {
    const current = fieldAssignmentsRepo.get(db, id);
    if (!current) throw new Error("Assignment not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    db.transaction(() => {
      upsertRow(db, "field_assignments", assignmentRow(next));
      if (patch.evidence !== undefined) writeEvidence(db, id, next.evidence);
    });
    return next;
  },
  addEvidence(db: AppDatabase, assignmentId: Id, evidence: FieldEvidence): FieldAssignment {
    const current = fieldAssignmentsRepo.get(db, assignmentId);
    if (!current) throw new Error("Assignment not found");
    const nextEvidence = [...current.evidence, evidence];
    const updatedAt = nowIso();
    db.transaction(() => {
      writeEvidence(db, assignmentId, nextEvidence);
      db.run("UPDATE field_assignments SET updated_at = ? WHERE id = ?", [updatedAt, assignmentId]);
    });
    return { ...current, evidence: nextEvidence, updatedAt };
  },
  remove(db: AppDatabase, id: Id): void {
    db.transaction(() => {
      db.run("DELETE FROM field_evidence WHERE assignment_id = ?", [id]);
      db.run("DELETE FROM field_assignments WHERE id = ?", [id]);
    });
  },
};

// =====================================================================
// Certified mail tracking
// =====================================================================

function rowToMailTracking(r: Row): MailTracking {
  return {
    id: asStr(r.id),
    noticeId: asStr(r.notice_id),
    carrier: asStr(r.carrier),
    trackingNumber: asStr(r.tracking_number),
    status: asStr(r.status) as MailStatus,
    mailedDate: strOrNull(r.mailed_date),
    events: parseJson<MailTrackingEvent[]>(r.events, []),
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function mailTrackingRow(m: MailTracking): Row {
  return {
    id: m.id,
    notice_id: m.noticeId,
    carrier: m.carrier,
    tracking_number: m.trackingNumber,
    status: m.status,
    mailed_date: m.mailedDate,
    events: toJson(m.events),
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  };
}

export const mailTrackingRepo = {
  list(db: AppDatabase, noticeId?: Id): MailTracking[] {
    const rows = noticeId
      ? db.all("SELECT * FROM mail_tracking WHERE notice_id = ? ORDER BY created_at", [noticeId])
      : db.all("SELECT * FROM mail_tracking ORDER BY created_at");
    return rows.map(rowToMailTracking);
  },
  get(db: AppDatabase, id: Id): MailTracking | null {
    const r = db.get("SELECT * FROM mail_tracking WHERE id = ?", [id]);
    return r ? rowToMailTracking(r) : null;
  },
  create(db: AppDatabase, tracking: MailTracking): MailTracking {
    upsertRow(db, "mail_tracking", mailTrackingRow(tracking));
    return tracking;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<MailTracking, "id" | "noticeId" | "createdAt">>,
  ): MailTracking {
    const current = mailTrackingRepo.get(db, id);
    if (!current) throw new Error("Tracking record not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "mail_tracking", mailTrackingRow(next));
    return next;
  },
  remove(db: AppDatabase, id: Id): void {
    db.run("DELETE FROM mail_tracking WHERE id = ?", [id]);
  },
};

// =====================================================================
// Maintenance / work orders
// =====================================================================

function rowToStatusChange(r: Row): WorkOrderStatusChange {
  return {
    id: asStr(r.id),
    workOrderId: asStr(r.work_order_id),
    fromStatus: strOrNull(r.from_status) as WorkOrderStatus | null,
    toStatus: asStr(r.to_status) as WorkOrderStatus,
    changedBy: strOrNull(r.changed_by),
    changedByName: asStr(r.changed_by_name),
    note: asStr(r.note),
    changedAt: asStr(r.changed_at),
  };
}

function loadStatusHistory(db: AppDatabase, workOrderId: Id): WorkOrderStatusChange[] {
  return db
    .all("SELECT * FROM work_order_status_history WHERE work_order_id = ? ORDER BY changed_at", [
      workOrderId,
    ])
    .map(rowToStatusChange);
}

function rowToWorkOrder(r: Row, statusHistory: WorkOrderStatusChange[]): WorkOrder {
  return {
    id: asStr(r.id),
    propertyId: asStr(r.property_id),
    tenantId: strOrNull(r.tenant_id),
    unit: asStr(r.unit),
    title: asStr(r.title),
    description: asStr(r.description),
    category: asStr(r.category) as WorkOrderCategory,
    priority: asStr(r.priority) as WorkOrderPriority,
    status: asStr(r.status) as WorkOrderStatus,
    dueDate: strOrNull(r.due_date),
    assigneeName: asStr(r.assignee_name),
    vendorName: asStr(r.vendor_name),
    vendorContact: asStr(r.vendor_contact),
    costEstimateCents: numOrNull(r.cost_estimate_cents),
    costActualCents: numOrNull(r.cost_actual_cents),
    internalNotes: asStr(r.internal_notes),
    completedAt: strOrNull(r.completed_at),
    statusHistory,
    createdAt: asStr(r.created_at),
    updatedAt: asStr(r.updated_at),
  };
}

function workOrderRow(w: WorkOrder): Row {
  return {
    id: w.id,
    property_id: w.propertyId,
    tenant_id: w.tenantId,
    unit: w.unit,
    title: w.title,
    description: w.description,
    category: w.category,
    priority: w.priority,
    status: w.status,
    due_date: w.dueDate,
    assignee_name: w.assigneeName,
    vendor_name: w.vendorName,
    vendor_contact: w.vendorContact,
    cost_estimate_cents: w.costEstimateCents,
    cost_actual_cents: w.costActualCents,
    internal_notes: w.internalNotes,
    completed_at: w.completedAt,
    created_at: w.createdAt,
    updated_at: w.updatedAt,
  };
}

export const workOrdersRepo = {
  list(db: AppDatabase, filters?: WorkOrderFilters): WorkOrder[] {
    const clauses: string[] = [];
    const params: SqlValue[] = [];
    if (filters?.propertyId) {
      clauses.push("property_id = ?");
      params.push(filters.propertyId);
    }
    if (filters?.tenantId) {
      clauses.push("tenant_id = ?");
      params.push(filters.tenantId);
    }
    if (filters?.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    if (filters?.priority) {
      clauses.push("priority = ?");
      params.push(filters.priority);
    }
    if (filters?.category) {
      clauses.push("category = ?");
      params.push(filters.category);
    }
    if (filters?.search) {
      clauses.push("(title LIKE ? OR description LIKE ? OR assignee_name LIKE ? OR vendor_name LIKE ?)");
      const like = `%${filters.search}%`;
      params.push(like, like, like, like);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = db.all(
      `SELECT * FROM work_orders${where} ORDER BY created_at DESC`,
      params,
    );
    return rows.map((r) => rowToWorkOrder(r, loadStatusHistory(db, asStr(r.id))));
  },
  get(db: AppDatabase, id: Id): WorkOrder | null {
    const r = db.get("SELECT * FROM work_orders WHERE id = ?", [id]);
    return r ? rowToWorkOrder(r, loadStatusHistory(db, id)) : null;
  },
  create(db: AppDatabase, workOrder: WorkOrder): WorkOrder {
    db.transaction(() => {
      upsertRow(db, "work_orders", workOrderRow(workOrder));
      for (const change of workOrder.statusHistory) {
        upsertRow(db, "work_order_status_history", {
          id: change.id,
          work_order_id: change.workOrderId,
          from_status: change.fromStatus,
          to_status: change.toStatus,
          changed_by: change.changedBy,
          changed_by_name: change.changedByName,
          note: change.note,
          changed_at: change.changedAt,
        });
      }
    });
    return workOrder;
  },
  update(
    db: AppDatabase,
    id: Id,
    patch: Partial<Omit<WorkOrder, "id" | "createdAt" | "statusHistory">>,
  ): WorkOrder {
    const current = workOrdersRepo.get(db, id);
    if (!current) throw new Error("Work order not found");
    const next = applyPatch(current, { ...patch, updatedAt: patch.updatedAt ?? nowIso() });
    upsertRow(db, "work_orders", workOrderRow(next));
    return next;
  },
  addStatusChange(db: AppDatabase, change: WorkOrderStatusChange): void {
    upsertRow(db, "work_order_status_history", {
      id: change.id,
      work_order_id: change.workOrderId,
      from_status: change.fromStatus,
      to_status: change.toStatus,
      changed_by: change.changedBy,
      changed_by_name: change.changedByName,
      note: change.note,
      changed_at: change.changedAt,
    });
  },
  remove(db: AppDatabase, id: Id): void {
    db.transaction(() => {
      db.run("DELETE FROM work_order_status_history WHERE work_order_id = ?", [id]);
      db.run("DELETE FROM attachments WHERE entity_type = 'work_order' AND entity_id = ?", [id]);
      db.run("DELETE FROM work_orders WHERE id = ?", [id]);
    });
  },
};
