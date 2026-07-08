// ---------------------------------------------------------------------------
// AppServices implementation — composition layer over the real local stack:
//   db/        sql.js persistence (IndexedDB-backed) + repositories
//   import/    CSV / Excel / PDF / OCR ledger parsing + vendor presets
//   engine/    classification, rent-only calculation, validation, deadlines
//   documents/ PDF generation (notices, proofs, packets)
//
// The database opens lazily on first service call; nothing here runs at
// module top level except factory registration.
// ---------------------------------------------------------------------------

import type {
  Attachment,
  AuditAction,
  AuditEntry,
  BackupMeta,
  CalculationResult,
  CompanyProfile,
  DashboardData,
  DeadlineResult,
  DuplicateCheckResult,
  FieldAssignment,
  FieldEvidence,
  GenerateDocumentsInput,
  Holiday,
  Id,
  ImportLedgerInput,
  Ledger,
  LedgerTransaction,
  MailTracking,
  MailTrackingEvent,
  Notice,
  NoticeDocument,
  NoticeFilters,
  NoticeInput,
  NoticeStatus,
  NoticeTemplate,
  NoticeType,
  PaymentProfile,
  Property,
  ReportKind,
  ReportResult,
  ServiceRecord,
  SessionInfo,
  Tenant,
  User,
  ValidationResult,
} from "../types";
import { NOTICE_STATUS_LABELS, NOTICE_TYPE_LABELS } from "../types";
import type {
  AppServices,
  ClassificationOverrideInput,
  LedgerDetail,
} from "./services";
import { registerServicesFactory } from "./services";
import { type Permission, checkPermission } from "./permissions";
import {
  type AppDatabase,
  attachmentsRepo,
  auditRepo,
  calculationsRepo,
  companyRepo,
  dataUrlToBytes,
  documentsRepo,
  exportBackup as exportDbBackup,
  fieldAssignmentsRepo,
  holidaysRepo,
  importBackup as importDbBackup,
  initDatabase,
  ledgersRepo,
  mailTrackingRepo,
  mappingPresetsRepo,
  noticesRepo,
  nowIso,
  propertiesRepo,
  settingsRepo,
  sha256Hex,
  statusHistoryRepo,
  templatesRepo,
  tenantsRepo,
  todayIso,
  uid,
  usersRepo,
  validationResultsRepo,
} from "../db";
import { parseDateToIso, parseFile, parseMoneyToCents, toParsedLedgerFile } from "../import";
import {
  STATE_RULES,
  addDays,
  calculateRentOnly,
  classifyRow,
  computeDeadline as computeDeadlineEngine,
  confidenceToUnit,
  unacknowledgedWarnings,
  validateNotice as validateNoticeEngine,
} from "../engine";
import {
  assemblePacket,
  bytesToBlob,
  generateDocument,
  packetContents,
  type DocumentContext,
  type GeneratedDocument,
  type KindedDocument,
} from "../documents";
import { extractMergeFields } from "../documents/merge";

// ------------------------------- lazy database ------------------------------

let dbPromise: Promise<AppDatabase> | null = null;

function getDb(): Promise<AppDatabase> {
  if (!dbPromise) {
    dbPromise = initDatabase().catch((err) => {
      dbPromise = null; // allow retry after a failed open
      throw err;
    });
  }
  return dbPromise;
}

// ------------------------------- session ------------------------------------

const session: SessionInfo = { user: null, locked: false };

// Authoritative RBAC gate. Every state-changing service method calls this
// before touching the database; the UI mirrors the same rules (see
// usePermissions) but the enforcement here is the source of truth.
function requirePermission(permission: Permission): void {
  checkPermission({ role: session.user?.role, locked: session.locked }, permission);
}

// Object URLs are session-scoped; rebuild them from stored bytes on demand.
const blobUrlCache = new Map<Id, string>();

// ------------------------------- helpers ------------------------------------

function logAudit(
  db: AppDatabase,
  action: AuditAction,
  entityType: string,
  entityId: Id | null,
  summary: string,
  opts: { previousValue?: string | null; newValue?: string | null; reason?: string | null } = {},
): void {
  auditRepo.create(db, {
    id: uid("audit"),
    timestamp: nowIso(),
    userId: session.user?.id ?? null,
    userName: session.user?.name ?? "System",
    action,
    entityType,
    entityId,
    summary,
    previousValue: opts.previousValue ?? null,
    newValue: opts.newValue ?? null,
    reason: opts.reason ?? null,
  });
}

function requireCompany(db: AppDatabase): CompanyProfile {
  const company = companyRepo.get(db);
  if (!company) throw new Error("Company profile is not configured yet.");
  return company;
}

function customHolidays(db: AppDatabase): Holiday[] {
  return holidaysRepo.list(db).filter((h) => !h.builtIn);
}

function emptyService(): ServiceRecord {
  return {
    dateServed: null,
    timeServed: null,
    method: null,
    servedBy: "",
    serverNotes: "",
    mailedDate: null,
  };
}

function defaultPayment(company: CompanyProfile | null): PaymentProfile {
  return {
    payToName: company?.name ?? "",
    paymentAddress: company?.address ?? "",
    phone: company?.phone ?? "",
    acceptedMethods: ["personal_check", "cashiers_check", "money_order"],
    inPersonAllowed: true,
    officeHours: "Mon\u2013Fri 9:00 AM \u2013 5:00 PM",
    paymentDays: "Monday through Friday",
    electronicInstructions: "",
  };
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join("");
}

function looksLikeRawPin(pin: string | null | undefined): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

function singleLineAddress(property: Property): string {
  return [
    property.addressLine1,
    property.addressLine2,
    `${property.city}, ${property.state} ${property.zip}`,
  ]
    .filter(Boolean)
    .join(", ");
}

function freshCalculation(db: AppDatabase, ledgerId: Id): CalculationResult {
  const txns = ledgersRepo.listTransactions(db, ledgerId);
  const result = calculateRentOnly(ledgerId, txns);
  calculationsRepo.upsert(db, result);
  return result;
}

function statusChange(db: AppDatabase, notice: Notice, toStatus: NoticeStatus, reason = ""): Notice {
  const from = notice.status;
  const next = noticesRepo.update(db, notice.id, { status: toStatus });
  statusHistoryRepo.create(db, {
    id: uid("sh"),
    noticeId: notice.id,
    fromStatus: from,
    toStatus,
    changedBy: session.user?.id ?? null,
    changedAt: nowIso(),
    reason,
  });
  logAudit(
    db,
    toStatus === "sent_to_attorney" ? "sent_to_attorney" : "status_changed",
    "notice",
    notice.id,
    `Status changed: ${NOTICE_STATUS_LABELS[from]} \u2192 ${NOTICE_STATUS_LABELS[toStatus]}`,
    { previousValue: from, newValue: toStatus, reason: reason || null },
  );
  return next;
}

function runValidation(db: AppDatabase, notice: Notice): ValidationResult {
  const tenant = tenantsRepo.get(db, notice.tenantId);
  const property = propertiesRepo.get(db, notice.propertyId);
  const company = companyRepo.get(db);
  const settings = settingsRepo.get(db);
  const transactions = notice.ledgerId ? ledgersRepo.listTransactions(db, notice.ledgerId) : [];
  const calculation = notice.ledgerId
    ? calculationsRepo.get(db, notice.ledgerId) ??
      calculateRentOnly(notice.ledgerId, transactions)
    : null;
  const template = notice.templateId ? templatesRepo.get(db, notice.templateId) : null;
  const result = validateNoticeEngine({
    notice,
    tenant,
    property,
    company,
    calculation,
    transactions,
    existingNotices: noticesRepo.list(db).filter((n) => n.id !== notice.id),
    template: template ? { attorneyReviewed: template.attorneyReviewed } : null,
    settings: settings
      ? {
          requireAttorneyReviewedTemplate: settings.requireAttorneyReviewedTemplate,
          allowAdminTemplateOverride: settings.allowAdminTemplateOverride,
        }
      : undefined,
    currentUserRole: session.user?.role,
  });
  validationResultsRepo.upsert(db, result);
  return result;
}

function applyNoticeFilters(list: Notice[], filters?: NoticeFilters): Notice[] {
  let out = list;
  if (filters) {
    const f = filters;
    if (f.search) {
      const q = f.search.toLowerCase();
      out = out.filter(
        (n) =>
          n.tenantNames.some((x) => x.toLowerCase().includes(q)) ||
          n.propertyAddress.toLowerCase().includes(q) ||
          n.unit.toLowerCase().includes(q),
      );
    }
    if (f.status && f.status !== "all") out = out.filter((n) => n.status === f.status);
    if (f.noticeType && f.noticeType !== "all")
      out = out.filter((n) => n.noticeType === f.noticeType);
    if (f.propertyId && f.propertyId !== "all")
      out = out.filter((n) => n.propertyId === f.propertyId);
    if (f.tenantId) out = out.filter((n) => n.tenantId === f.tenantId);
    if (f.month) out = out.filter((n) => n.months.some((m) => m.month === f.month));
    if (f.createdFrom) out = out.filter((n) => n.createdAt >= f.createdFrom!);
    if (f.createdTo) out = out.filter((n) => n.createdAt <= `${f.createdTo}T23:59:59`);
    if (f.servedFrom) out = out.filter((n) => (n.service.dateServed ?? "") >= f.servedFrom!);
    if (f.servedTo) out = out.filter((n) => (n.service.dateServed ?? "9999") <= f.servedTo!);
    if (f.amountMinCents != null) out = out.filter((n) => n.totalAmountCents >= f.amountMinCents!);
    if (f.amountMaxCents != null) out = out.filter((n) => n.totalAmountCents <= f.amountMaxCents!);
    if (f.preparedBy && f.preparedBy !== "all") out = out.filter((n) => n.preparedBy === f.preparedBy);
  }
  return [...out].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function hydrateDocument(db: AppDatabase, doc: NoticeDocument): NoticeDocument {
  let url = blobUrlCache.get(doc.id);
  if (!url) {
    const bytes = documentsRepo.getBytes(db, doc.id);
    if (bytes) {
      url = URL.createObjectURL(bytesToBlob(bytes));
      blobUrlCache.set(doc.id, url);
    }
  }
  return { ...doc, blobUrl: url ?? "" };
}

// ------------------------------- services -----------------------------------

function createServices(): AppServices {
  const services = {
    // --- session & users ---
    async getSession(): Promise<SessionInfo> {
      await getDb();
      return { user: session.user ? { ...session.user } : null, locked: session.locked };
    },
    async listUsers(): Promise<User[]> {
      const db = await getDb();
      return usersRepo.list(db);
    },
    async selectUser(userId: Id, pin?: string): Promise<SessionInfo> {
      const db = await getDb();
      const user = usersRepo.get(db, userId);
      if (!user || !user.active) throw new Error("User not found or inactive");
      if (user.pin) {
        if (!pin) throw new Error("PIN required");
        const hash = await sha256Hex(pin);
        if (hash !== user.pin) throw new Error("Incorrect PIN");
      }
      session.user = user;
      session.locked = false;
      logAudit(db, "login", "user", user.id, `${user.name} signed in`);
      return { user: { ...user }, locked: false };
    },
    async lockApp(): Promise<SessionInfo> {
      await getDb();
      session.locked = true;
      return { user: session.user ? { ...session.user } : null, locked: true };
    },
    async createUser(input): Promise<User> {
      requirePermission("user.manage");
      const db = await getDb();
      const user: User = {
        id: uid("user"),
        name: input.name,
        initials: initialsOf(input.name),
        role: input.role,
        pin: looksLikeRawPin(input.pin) ? await sha256Hex(input.pin) : null,
        active: true,
        createdAt: nowIso(),
      };
      usersRepo.create(db, user);
      logAudit(db, "user_created", "user", user.id, `Created user ${user.name} (${user.role})`);
      return user;
    },
    async updateUser(id, patch): Promise<User> {
      requirePermission("user.manage");
      const db = await getDb();
      const next = { ...patch };
      if (looksLikeRawPin(next.pin)) next.pin = await sha256Hex(next.pin);
      if (next.name) next.initials = patch.initials ?? initialsOf(next.name);
      const user = usersRepo.update(db, id, next);
      if (session.user?.id === id) session.user = user;
      logAudit(db, "user_updated", "user", id, `Updated user ${user.name}`);
      return user;
    },

    // --- company & settings ---
    async getCompanyProfile(): Promise<CompanyProfile> {
      const db = await getDb();
      return requireCompany(db);
    },
    async updateCompanyProfile(patch): Promise<CompanyProfile> {
      requirePermission("settings.manage");
      const db = await getDb();
      const current = requireCompany(db);
      const next = companyRepo.update(db, current.id, patch);
      logAudit(db, "settings_changed", "company", current.id, "Updated company profile");
      return next;
    },
    async getSettings() {
      const db = await getDb();
      const settings = settingsRepo.get(db);
      if (!settings) throw new Error("Application settings are not initialized.");
      return settings;
    },
    async updateSettings(patch) {
      requirePermission("settings.manage");
      const db = await getDb();
      const next = settingsRepo.update(db, patch);
      logAudit(db, "settings_changed", "settings", "app", "Updated application settings");
      return next;
    },

    // --- properties ---
    async listProperties(search?: string): Promise<Property[]> {
      const db = await getDb();
      return propertiesRepo.list(db, search);
    },
    async getProperty(id: Id): Promise<Property | null> {
      const db = await getDb();
      return propertiesRepo.get(db, id);
    },
    async createProperty(input): Promise<Property> {
      requirePermission("property.manage");
      const db = await getDb();
      const t = nowIso();
      const property: Property = {
        id: uid("prop"),
        nickname: input.nickname,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? "",
        city: input.city,
        state: input.state,
        zip: input.zip,
        county: input.county ?? "",
        units: input.units ?? [],
        ownerName: input.ownerName,
        managementCompany: input.managementCompany ?? "",
        managerContact: input.managerContact ?? "",
        payment: { ...defaultPayment(companyRepo.get(db)), ...(input.payment ?? {}) },
        isLosAngelesCity: input.isLosAngelesCity ?? false,
        notes: input.notes ?? "",
        createdAt: t,
        updatedAt: t,
      };
      propertiesRepo.create(db, property);
      logAudit(db, "property_created", "property", property.id, `Added property ${property.nickname}`);
      return property;
    },
    async updateProperty(id, patch): Promise<Property> {
      requirePermission("property.manage");
      const db = await getDb();
      const next = propertiesRepo.update(db, id, patch);
      logAudit(db, "property_updated", "property", id, `Updated property ${next.nickname}`);
      return next;
    },
    async deleteProperty(id: Id): Promise<void> {
      requirePermission("property.manage");
      const db = await getDb();
      const property = propertiesRepo.get(db, id);
      propertiesRepo.remove(db, id);
      logAudit(db, "property_deleted", "property", id, `Deleted property ${property?.nickname ?? id}`);
    },

    // --- tenants ---
    async listTenants(search?: string, propertyId?: Id): Promise<Tenant[]> {
      const db = await getDb();
      return tenantsRepo.list(db, search, propertyId);
    },
    async getTenant(id: Id): Promise<Tenant | null> {
      const db = await getDb();
      return tenantsRepo.get(db, id);
    },
    async createTenant(input): Promise<Tenant> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const t = nowIso();
      const tenant: Tenant = {
        id: uid("tenant"),
        names: input.names,
        propertyId: input.propertyId,
        unit: input.unit ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        monthlyRentCents: input.monthlyRentCents ?? null,
        leaseStart: input.leaseStart ?? null,
        moveOutDate: null,
        notes: input.notes ?? "",
        archived: false,
        createdAt: t,
        updatedAt: t,
      };
      tenantsRepo.create(db, tenant);
      logAudit(db, "tenant_created", "tenant", tenant.id, `Added tenant ${tenant.names.join(", ")}`);
      return tenant;
    },
    async updateTenant(id, patch): Promise<Tenant> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const next = tenantsRepo.update(db, id, patch);
      logAudit(db, "tenant_updated", "tenant", id, `Updated tenant ${next.names.join(", ")}`);
      return next;
    },
    async deleteTenant(id: Id): Promise<void> {
      requirePermission("tenant.manage");
      const db = await getDb();
      const tenant = tenantsRepo.get(db, id);
      tenantsRepo.remove(db, id);
      logAudit(db, "tenant_deleted", "tenant", id, `Deleted tenant ${tenant?.names.join(", ") ?? id}`);
    },

    // --- ledgers & import ---
    async listLedgers(tenantId?: Id): Promise<Ledger[]> {
      const db = await getDb();
      return ledgersRepo.list(db, tenantId);
    },
    async getLedger(id: Id): Promise<LedgerDetail | null> {
      const db = await getDb();
      return ledgersRepo.getDetail(db, id);
    },
    async parseLedgerFile(file: File) {
      await getDb();
      const parsed = await parseFile(file);
      return toParsedLedgerFile(file.name, parsed);
    },
    async importLedger(input: ImportLedgerInput): Promise<Ledger> {
      requirePermission("ledger.manage");
      const db = await getDb();
      const t = nowIso();
      const ledger: Ledger = {
        id: uid("ledger"),
        tenantId: input.tenantId,
        name: input.name,
        sourceType: input.sourceType,
        sourceFileName: input.fileName,
        vendor: input.vendor,
        mappingUsed: input.mapping,
        importedAt: t,
        importedBy: session.user?.id ?? null,
        transactionCount: 0,
        periodStart: null,
        periodEnd: null,
        notes: "",
      };
      const txns: LedgerTransaction[] = [];

      const pushTxn = (
        date: string,
        description: string,
        category: string,
        memo: string,
        amountCents: number,
        rowIndex: number,
        balance: number | null,
        transactionType = "",
      ) => {
        const cls = classifyRow({ description, category, memo, transactionType, amountCents });
        txns.push({
          id: uid("txn"),
          ledgerId: ledger.id,
          rowIndex,
          date,
          month: date.slice(0, 7),
          description,
          originalCategory: category,
          memo,
          kind: cls.kind,
          amountCents,
          balanceCents: balance,
          systemClass: cls.category,
          confidence: confidenceToUnit(cls.confidence),
          includedInNotice: cls.includedInNotice,
          classReason: cls.reason,
          userOverrideClass: null,
          overrideReason: null,
          overriddenBy: null,
          flagged: cls.needsReview,
          flagReason: cls.needsReview ? cls.reason : null,
        });
      };

      const m = input.mapping;
      if (input.manualTransactions?.length) {
        input.manualTransactions.forEach((mt, i) =>
          pushTxn(mt.date, mt.description, mt.category, mt.memo ?? "", mt.amountCents, i + 1, null),
        );
      } else if (m) {
        input.rows.forEach((row, i) => {
          const date = parseDateToIso(m.date ? row[m.date] ?? "" : "");
          if (!date) return;
          const description = (m.description ? row[m.description] : "") ?? "";
          const category = (m.category ? row[m.category] : "") ?? "";
          const memo = (m.memo ? row[m.memo] : "") ?? "";
          const txnType = (m.transactionType ? row[m.transactionType] : "") ?? "";
          const balance = m.balance ? parseMoneyToCents(row[m.balance] ?? "") : null;
          const charge = m.chargeAmount ? parseMoneyToCents(row[m.chargeAmount] ?? "") : null;
          const payment = m.paymentAmount ? parseMoneyToCents(row[m.paymentAmount] ?? "") : null;
          const credit = m.creditAmount ? parseMoneyToCents(row[m.creditAmount] ?? "") : null;
          const single = m.amount ? parseMoneyToCents(row[m.amount] ?? "") : null;
          if (charge && charge !== 0)
            pushTxn(date, description, category, memo, Math.abs(charge), i + 1, balance, txnType);
          if (payment && payment !== 0)
            pushTxn(date, description || "Payment", category, memo, -Math.abs(payment), i + 1, balance, txnType);
          if (credit && credit !== 0)
            pushTxn(date, description || "Credit", category, memo, -Math.abs(credit), i + 1, balance, txnType);
          if (!charge && !payment && !credit && single != null && single !== 0) {
            const typeLower = txnType.toLowerCase();
            const negative =
              typeLower.includes("payment") || typeLower.includes("credit")
                ? -Math.abs(single)
                : single;
            pushTxn(date, description, category, memo, negative, i + 1, balance, txnType);
          }
        });
      }

      ledger.transactionCount = txns.length;
      const dates = txns.map((x) => x.date).sort();
      ledger.periodStart = dates[0] ?? null;
      ledger.periodEnd = dates[dates.length - 1] ?? null;

      ledgersRepo.create(db, ledger, txns);

      if (input.savePresetName && input.mapping) {
        mappingPresetsRepo.create(db, {
          id: uid("preset"),
          name: input.savePresetName,
          vendor: input.vendor,
          mapping: input.mapping,
          createdAt: t,
        });
      }
      logAudit(
        db,
        "ledger_imported",
        "ledger",
        ledger.id,
        `Imported ledger "${ledger.name}" (${txns.length} transactions)`,
      );
      return ledger;
    },
    async deleteLedger(id: Id): Promise<void> {
      requirePermission("ledger.manage");
      const db = await getDb();
      calculationsRepo.remove(db, id);
      ledgersRepo.remove(db, id);
      logAudit(db, "ledger_deleted", "ledger", id, "Deleted ledger");
    },
    async overrideClassification(input: ClassificationOverrideInput): Promise<LedgerTransaction> {
      requirePermission("ledger.manage");
      const db = await getDb();
      if (!input.reason.trim()) throw new Error("A reason is required for manual overrides");
      const current = ledgersRepo.getTransaction(db, input.transactionId);
      if (!current) throw new Error("Transaction not found");
      const prev = `${current.userOverrideClass ?? current.systemClass}/${current.includedInNotice ? "included" : "excluded"}`;
      const next = ledgersRepo.overrideClassification(db, input, session.user?.id ?? null);
      const nextLabel = `${next.userOverrideClass ?? next.systemClass}/${next.includedInNotice ? "included" : "excluded"}`;
      // Invalidate the cached calculation for this ledger.
      calculationsRepo.remove(db, current.ledgerId);
      logAudit(db, "manual_override", "transaction", next.id, `Reclassified "${next.description}"`, {
        previousValue: prev,
        newValue: nextLabel,
        reason: input.reason,
      });
      return next;
    },
    async listMappingPresets() {
      const db = await getDb();
      return mappingPresetsRepo.list(db);
    },
    async saveMappingPreset(preset) {
      requirePermission("ledger.manage");
      const db = await getDb();
      return mappingPresetsRepo.create(db, { ...preset, id: uid("preset"), createdAt: nowIso() });
    },
    async deleteMappingPreset(id: Id): Promise<void> {
      requirePermission("ledger.manage");
      const db = await getDb();
      mappingPresetsRepo.remove(db, id);
    },

    // --- calculation ---
    async calculateLedger(ledgerId: Id): Promise<CalculationResult> {
      const db = await getDb();
      return freshCalculation(db, ledgerId);
    },

    // --- notices ---
    async listNotices(filters?: NoticeFilters): Promise<Notice[]> {
      const db = await getDb();
      return applyNoticeFilters(noticesRepo.list(db), filters);
    },
    async getNotice(id: Id): Promise<Notice | null> {
      const db = await getDb();
      return noticesRepo.get(db, id);
    },
    async checkDuplicateNotice(params): Promise<DuplicateCheckResult> {
      const db = await getDb();
      return noticesRepo.checkDuplicate(db, params);
    },
    async createNotice(input: NoticeInput): Promise<Notice> {
      requirePermission("notice.create");
      const db = await getDb();
      const tenant = tenantsRepo.get(db, input.tenantId);
      const property = propertiesRepo.get(db, input.propertyId);
      if (!tenant || !property) throw new Error("Tenant and property are required");
      const t = nowIso();
      const template = input.templateId ? templatesRepo.get(db, input.templateId) : null;
      const notice: Notice = {
        id: uid("notice"),
        noticeType: input.noticeType,
        jurisdiction: input.jurisdiction,
        status: "draft",
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        unit: input.unit,
        tenantNames: [...tenant.names],
        propertyAddress: singleLineAddress(property),
        ledgerId: input.ledgerId,
        months: input.months,
        totalAmountCents: input.months.reduce((s, m) => s + m.selectedAmountCents, 0),
        payment: input.payment,
        templateId: input.templateId,
        templateVersion: template?.currentVersion ?? null,
        includeLahdLetter: input.includeLahdLetter,
        covenantDescription: input.covenantDescription ?? "",
        entryDate: input.entryDate ?? null,
        entryTimeWindow: input.entryTimeWindow ?? "",
        entryReason: input.entryReason ?? "",
        terminationDate: input.terminationDate ?? null,
        rentIncreaseNewAmountCents: input.rentIncreaseNewAmountCents ?? null,
        rentIncreaseEffectiveDate: input.rentIncreaseEffectiveDate ?? null,
        version: 1,
        revisedFromId: null,
        reviewerApprovedBy: null,
        reviewerApprovedAt: null,
        finalizedBy: null,
        finalizedAt: null,
        rentOnlyAttestedBy: null,
        rentOnlyAttestedAt: null,
        attorneyExportFlag: false,
        service: emptyService(),
        deadlineDate: null,
        internalNotes: input.internalNotes ?? "",
        preparedBy: session.user?.id ?? null,
        createdAt: t,
        updatedAt: t,
      };
      noticesRepo.create(db, notice);
      statusHistoryRepo.create(db, {
        id: uid("sh"),
        noticeId: notice.id,
        fromStatus: null,
        toStatus: "draft",
        changedBy: session.user?.id ?? null,
        changedAt: t,
        reason: input.duplicateOverrideReason ?? "",
      });
      logAudit(
        db,
        "notice_created",
        "notice",
        notice.id,
        `Created ${NOTICE_TYPE_LABELS[notice.noticeType]} draft for ${notice.tenantNames.join(", ")}`,
        { reason: input.duplicateOverrideReason ?? null },
      );
      return notice;
    },
    async updateNotice(id, patch): Promise<Notice> {
      requirePermission("notice.create");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      if (["finalized", "served", "mailed", "expired", "paid", "sent_to_attorney"].includes(n.status))
        throw new Error("Finalized notices cannot be edited. Create a revised version instead.");
      const p: Partial<Omit<Notice, "id" | "createdAt">> = {};
      if (patch.months) {
        p.months = patch.months;
        p.totalAmountCents = patch.months.reduce((s, m) => s + m.selectedAmountCents, 0);
      }
      if (patch.payment) p.payment = patch.payment;
      if (patch.templateId !== undefined) {
        p.templateId = patch.templateId;
        p.templateVersion = patch.templateId
          ? templatesRepo.get(db, patch.templateId)?.currentVersion ?? null
          : null;
      }
      if (patch.includeLahdLetter !== undefined) p.includeLahdLetter = patch.includeLahdLetter;
      if (patch.unit !== undefined) p.unit = patch.unit;
      if (patch.covenantDescription !== undefined) p.covenantDescription = patch.covenantDescription;
      if (patch.terminationDate !== undefined) p.terminationDate = patch.terminationDate ?? null;
      if (patch.entryDate !== undefined) p.entryDate = patch.entryDate ?? null;
      if (patch.entryTimeWindow !== undefined) p.entryTimeWindow = patch.entryTimeWindow;
      if (patch.entryReason !== undefined) p.entryReason = patch.entryReason;
      if (patch.rentIncreaseNewAmountCents !== undefined)
        p.rentIncreaseNewAmountCents = patch.rentIncreaseNewAmountCents ?? null;
      if (patch.rentIncreaseEffectiveDate !== undefined)
        p.rentIncreaseEffectiveDate = patch.rentIncreaseEffectiveDate ?? null;
      if (patch.internalNotes !== undefined) p.internalNotes = patch.internalNotes;
      const next = noticesRepo.update(db, id, p);
      logAudit(db, "notice_updated", "notice", id, "Updated notice draft");
      return next;
    },
    async deleteNotice(id: Id, reason: string): Promise<void> {
      requirePermission("notice.delete");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) return;
      if (n.status !== "draft" && n.status !== "needs_review")
        throw new Error("Only drafts can be deleted");
      noticesRepo.remove(db, id);
      logAudit(db, "draft_deleted", "notice", id, `Deleted draft for ${n.tenantNames.join(", ")}`, {
        reason,
      });
    },
    async validateNotice(id: Id): Promise<ValidationResult> {
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      return runValidation(db, n);
    },
    async changeNoticeStatus(id, toStatus, reason): Promise<Notice> {
      requirePermission("notice.status");
      if (toStatus === "reviewed") requirePermission("notice.approve");
      if (toStatus === "finalized") requirePermission("notice.finalize");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      let next = statusChange(db, n, toStatus, reason ?? "");
      if (toStatus === "sent_to_attorney")
        next = noticesRepo.update(db, id, { attorneyExportFlag: true });
      return next;
    },
    async approveNotice(id: Id): Promise<Notice> {
      requirePermission("notice.approve");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      const withApproval = noticesRepo.update(db, id, {
        reviewerApprovedBy: session.user?.id ?? null,
        reviewerApprovedAt: nowIso(),
      });
      return statusChange(db, withApproval, "reviewed", "Reviewer approval");
    },
    async finalizeNotice(id, acknowledgedWarnings, attestation): Promise<Notice> {
      requirePermission("notice.finalize");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      const demandsMoney = n.totalAmountCents > 0 || n.months.length > 0;
      if (demandsMoney && !attestation?.rentOnlyConfirmed)
        throw new Error(
          "Cannot finalize: you must confirm the demanded amounts contain scheduled rent only (no late fees, utilities, deposits, or other non-rent charges).",
        );
      const validation = runValidation(db, n);
      if (!validation.passed)
        throw new Error(
          `Cannot finalize: ${validation.blockers} blocking issue(s) must be fixed first.`,
        );
      const unacked = unacknowledgedWarnings(validation.issues, acknowledgedWarnings);
      if (unacked.length > 0)
        throw new Error(
          `All warnings must be acknowledged with a non-empty reason before finalizing (${unacked.length} remaining).`,
        );
      for (const ack of acknowledgedWarnings) {
        logAudit(db, "warning_acknowledged", "notice", id, `Acknowledged warning ${ack.code}`, {
          reason: ack.reason,
        });
      }
      const t = nowIso();
      const withFinal = noticesRepo.update(db, id, {
        finalizedBy: session.user?.id ?? null,
        finalizedAt: t,
        ...(demandsMoney
          ? { rentOnlyAttestedBy: session.user?.id ?? null, rentOnlyAttestedAt: t }
          : {}),
      });
      const next = statusChange(db, withFinal, "finalized", "Notice finalized and locked");
      logAudit(
        db,
        "notice_finalized",
        "notice",
        id,
        `Finalized notice v${next.version} for ${next.tenantNames.join(", ")}`,
      );
      return next;
    },
    async reviseNotice(id: Id, reason: string): Promise<Notice> {
      requirePermission("notice.status");
      const db = await getDb();
      const orig = noticesRepo.get(db, id);
      if (!orig) throw new Error("Notice not found");
      const t = nowIso();
      const copy: Notice = {
        ...structuredClone(orig),
        id: uid("notice"),
        status: "draft",
        version: orig.version + 1,
        revisedFromId: orig.id,
        reviewerApprovedBy: null,
        reviewerApprovedAt: null,
        finalizedBy: null,
        finalizedAt: null,
        rentOnlyAttestedBy: null,
        rentOnlyAttestedAt: null,
        service: emptyService(),
        deadlineDate: null,
        createdAt: t,
        updatedAt: t,
      };
      noticesRepo.create(db, copy);
      statusHistoryRepo.create(db, {
        id: uid("sh"),
        noticeId: copy.id,
        fromStatus: null,
        toStatus: "draft",
        changedBy: session.user?.id ?? null,
        changedAt: t,
        reason: `Revision of notice v${orig.version}`,
      });
      statusChange(db, orig, "revised", reason);
      logAudit(
        db,
        "notice_revised",
        "notice",
        copy.id,
        `Created revision v${copy.version} of notice for ${copy.tenantNames.join(", ")}`,
        { reason },
      );
      return copy;
    },
    async recordService(id, service: ServiceRecord): Promise<Notice> {
      requirePermission("notice.status");
      const db = await getDb();
      const n = noticesRepo.get(db, id);
      if (!n) throw new Error("Notice not found");
      let next = noticesRepo.update(db, id, { service });
      if (service.dateServed) {
        const deadline = computeDeadlineEngine(service.dateServed, n.noticeType, n.jurisdiction, {
          holidays: customHolidays(db),
        });
        next = noticesRepo.update(db, id, { deadlineDate: deadline.expirationDate });
        next = statusChange(
          db,
          next,
          service.method === "post_and_mail" && service.mailedDate ? "mailed" : "served",
          "Service recorded",
        );
      }
      return next;
    },

    // --- documents ---
    async generateDocuments(input: GenerateDocumentsInput): Promise<NoticeDocument[]> {
      requirePermission("notice.generate");
      const db = await getDb();
      const notice = noticesRepo.get(db, input.noticeId);
      if (!notice) throw new Error("Notice not found");
      const company = requireCompany(db);
      const tenant = tenantsRepo.get(db, notice.tenantId);
      const property = propertiesRepo.get(db, notice.propertyId);
      const template = notice.templateId ? templatesRepo.get(db, notice.templateId) : null;
      const transactions = notice.ledgerId
        ? ledgersRepo.listTransactions(db, notice.ledgerId)
        : [];
      const calculation = notice.ledgerId
        ? calculationsRepo.get(db, notice.ledgerId) ??
          calculateRentOnly(notice.ledgerId, transactions)
        : null;
      const auditEntries = auditRepo.list(db, { entityType: "notice", entityId: notice.id });
      const ctx: DocumentContext = {
        notice,
        tenant,
        property,
        calculation,
        companyProfile: company,
        template,
        auditEntries,
        serviceInfo: notice.service,
      };
      const isDraft = input.packetKind === "draft";
      const opts = isDraft ? { watermark: true } : undefined;

      for (const ack of input.acknowledgedWarnings ?? []) {
        logAudit(db, "warning_acknowledged", "notice", notice.id, `Acknowledged warning ${ack.code}`, {
          reason: ack.reason,
        });
      }

      const kinds = packetContents(input.packetKind).filter(
        (k) => k !== "lahd_letter" || notice.includeLahdLetter,
      );
      const generated: KindedDocument[] = [];
      for (const kind of kinds) {
        generated.push({ kind, doc: await generateDocument(kind, ctx, opts) });
      }
      const packet = await assemblePacket(input.packetKind, generated);

      // Revoke and evict blob URLs for the documents being replaced so
      // regenerating a packet does not leak object URLs for the session.
      for (const existing of documentsRepo.listByNotice(db, notice.id)) {
        if (existing.packetKind !== input.packetKind) continue;
        const staleUrl = blobUrlCache.get(existing.id);
        if (staleUrl) {
          URL.revokeObjectURL(staleUrl);
          blobUrlCache.delete(existing.id);
        }
      }
      documentsRepo.removeByNoticeAndPacket(db, notice.id, input.packetKind);
      const t = nowIso();
      const out: NoticeDocument[] = [];
      const saveDoc = (kind: NoticeDocument["kind"], doc: GeneratedDocument) => {
        const record: NoticeDocument = {
          id: uid("doc"),
          noticeId: notice.id,
          kind,
          packetKind: input.packetKind,
          fileName: doc.filename,
          watermarked: isDraft,
          locked: !isDraft,
          pageCount: doc.pageCount,
          sizeBytes: doc.bytes.length,
          generatedAt: t,
          generatedBy: session.user?.id ?? null,
          blobUrl: "",
        };
        documentsRepo.create(db, record, doc.bytes);
        const url = URL.createObjectURL(doc.blob);
        blobUrlCache.set(record.id, url);
        out.push({ ...record, blobUrl: url });
      };
      for (const g of generated) saveDoc(g.kind, g.doc);
      saveDoc("packet", packet);
      logAudit(
        db,
        "pdf_exported",
        "notice",
        notice.id,
        `Generated ${input.packetKind.replace(/_/g, " ")} (${out.length} document(s))`,
      );
      return out;
    },
    async listDocuments(noticeId: Id): Promise<NoticeDocument[]> {
      const db = await getDb();
      return documentsRepo.listByNotice(db, noticeId).map((d) => hydrateDocument(db, d));
    },

    // --- templates ---
    async listTemplates(filters): Promise<NoticeTemplate[]> {
      const db = await getDb();
      return templatesRepo.list(db, filters);
    },
    async getTemplate(id: Id): Promise<NoticeTemplate | null> {
      const db = await getDb();
      return templatesRepo.get(db, id);
    },
    async createTemplate(input): Promise<NoticeTemplate> {
      requirePermission("template.manage");
      const db = await getDb();
      const t = nowIso();
      const template: NoticeTemplate = {
        id: uid("tpl"),
        name: input.name,
        noticeType: input.noticeType,
        jurisdiction: input.jurisdiction,
        locality: input.locality ?? null,
        active: true,
        attorneyReviewed: false,
        reviewedBy: "",
        reviewDate: null,
        currentVersion: 1,
        versions: [
          {
            version: 1,
            body: input.body,
            changedBy: session.user?.id ?? null,
            changedAt: t,
            changeNote: "Created",
          },
        ],
        mergeFields: extractMergeFields(input.body),
        builtIn: false,
        createdAt: t,
        updatedAt: t,
      };
      templatesRepo.create(db, template);
      logAudit(db, "template_created", "template", template.id, `Created template "${template.name}"`);
      return template;
    },
    async updateTemplate(id, patch): Promise<NoticeTemplate> {
      requirePermission("template.manage");
      const db = await getDb();
      const current = templatesRepo.get(db, id);
      if (!current) throw new Error("Template not found");
      const p: Partial<Omit<NoticeTemplate, "id" | "createdAt">> = {};
      if (patch.name !== undefined) p.name = patch.name;
      if (patch.active !== undefined) p.active = patch.active;
      if (patch.attorneyReviewed !== undefined) p.attorneyReviewed = patch.attorneyReviewed;
      if (patch.reviewedBy !== undefined) p.reviewedBy = patch.reviewedBy;
      if (patch.reviewDate !== undefined) p.reviewDate = patch.reviewDate;
      if (patch.body !== undefined) {
        const version = current.currentVersion + 1;
        p.versions = [
          ...current.versions,
          {
            version,
            body: patch.body,
            changedBy: session.user?.id ?? null,
            changedAt: nowIso(),
            changeNote: patch.changeNote ?? "",
          },
        ];
        p.currentVersion = version;
        p.mergeFields = extractMergeFields(patch.body);
      }
      const next = templatesRepo.update(db, id, p);
      logAudit(db, "template_updated", "template", id, `Updated template "${next.name}"`, {
        reason: patch.changeNote ?? null,
      });
      return next;
    },

    // --- holidays & deadlines ---
    async listHolidays(year?: number): Promise<Holiday[]> {
      const db = await getDb();
      return holidaysRepo.list(db, year);
    },
    async addHoliday(input): Promise<Holiday> {
      requirePermission("settings.manage");
      const db = await getDb();
      const holiday: Holiday = { ...input, id: uid("holiday"), builtIn: false };
      holidaysRepo.create(db, holiday);
      logAudit(db, "holiday_changed", "holiday", holiday.id, `Added holiday ${holiday.name} (${holiday.date})`);
      return holiday;
    },
    async deleteHoliday(id: Id): Promise<void> {
      requirePermission("settings.manage");
      const db = await getDb();
      const holiday = holidaysRepo.get(db, id);
      if (holiday?.builtIn) throw new Error("Built-in court holidays cannot be removed");
      holidaysRepo.remove(db, id);
      logAudit(db, "holiday_changed", "holiday", id, `Removed holiday ${holiday?.name ?? id}`);
    },
    async computeDeadline(serviceDate, noticeType, jurisdiction): Promise<DeadlineResult> {
      const db = await getDb();
      return computeDeadlineEngine(serviceDate, noticeType, jurisdiction, {
        holidays: customHolidays(db),
      });
    },

    // --- audit ---
    async listAudit(filters): Promise<AuditEntry[]> {
      const db = await getDb();
      return auditRepo.list(db, filters);
    },

    // --- attachments ---
    async listAttachments(entityType, entityId): Promise<Attachment[]> {
      const db = await getDb();
      return attachmentsRepo.list(db, entityType, entityId);
    },
    async addAttachment(input): Promise<Attachment> {
      requirePermission("attachment.manage");
      const db = await getDb();
      let sizeBytes = 0;
      try {
        sizeBytes = dataUrlToBytes(input.dataUrl).bytes.length;
      } catch {
        sizeBytes = Math.floor((input.dataUrl.length * 3) / 4);
      }
      const attachment: Attachment = {
        id: uid("att"),
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes,
        dataUrl: input.dataUrl,
        uploadedBy: session.user?.id ?? null,
        uploadedAt: nowIso(),
        note: input.note ?? "",
      };
      attachmentsRepo.create(db, attachment);
      logAudit(db, "attachment_added", input.entityType, input.entityId, `Attached ${input.fileName}`);
      return attachment;
    },
    async deleteAttachment(id: Id): Promise<void> {
      requirePermission("attachment.manage");
      const db = await getDb();
      const att = attachmentsRepo.get(db, id);
      attachmentsRepo.remove(db, id);
      logAudit(
        db,
        "attachment_deleted",
        att?.entityType ?? "attachment",
        att?.entityId ?? id,
        `Deleted attachment ${att?.fileName ?? id}`,
      );
    },

    // --- field assignments (mobile companion) ---
    async listFieldAssignments(noticeId?: Id): Promise<FieldAssignment[]> {
      const db = await getDb();
      return fieldAssignmentsRepo.list(db, noticeId);
    },
    async createFieldAssignment(input): Promise<FieldAssignment> {
      requirePermission("field.manage");
      const db = await getDb();
      const t = nowIso();
      const assignment: FieldAssignment = {
        id: uid("fa"),
        noticeId: input.noticeId,
        assigneeName: input.assigneeName,
        instructions: input.instructions ?? "",
        status: "assigned",
        serviceMethod: null,
        completedAt: null,
        evidence: [],
        createdAt: t,
        updatedAt: t,
      };
      fieldAssignmentsRepo.create(db, assignment);
      return assignment;
    },
    async updateFieldAssignment(id, patch): Promise<FieldAssignment> {
      requirePermission("field.manage");
      const db = await getDb();
      return fieldAssignmentsRepo.update(db, id, patch);
    },
    async addFieldEvidence(assignmentId, evidence): Promise<FieldAssignment> {
      requirePermission("field.manage");
      const db = await getDb();
      const full: FieldEvidence = { ...evidence, id: uid("ev") };
      return fieldAssignmentsRepo.addEvidence(db, assignmentId, full);
    },

    // --- certified mail tracking ---
    async listMailTracking(noticeId?: Id): Promise<MailTracking[]> {
      const db = await getDb();
      return mailTrackingRepo.list(db, noticeId);
    },
    async createMailTracking(input): Promise<MailTracking> {
      requirePermission("mail.manage");
      const db = await getDb();
      const t = nowIso();
      const mailed = input.mailedDate ?? null;
      const tracking: MailTracking = {
        id: uid("mail"),
        noticeId: input.noticeId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        status: mailed ? "mailed" : "preparing",
        mailedDate: mailed,
        events: mailed ? [{ date: mailed, status: "mailed", note: "Marked as mailed" }] : [],
        createdAt: t,
        updatedAt: t,
      };
      mailTrackingRepo.create(db, tracking);
      return tracking;
    },
    async updateMailTracking(id, patch): Promise<MailTracking> {
      requirePermission("mail.manage");
      const db = await getDb();
      const current = mailTrackingRepo.get(db, id);
      if (!current) throw new Error("Tracking record not found");
      const p = { ...patch };
      if (p.status && p.status !== current.status && !p.events) {
        const event: MailTrackingEvent = { date: todayIso(), status: p.status, note: "" };
        p.events = [...current.events, event];
      }
      return mailTrackingRepo.update(db, id, { ...p, updatedAt: nowIso() });
    },

    // --- dashboard, reports, export ---
    async getDashboard(): Promise<DashboardData> {
      const db = await getDb();
      const notices = noticesRepo.list(db);
      const counts = Object.fromEntries(
        (Object.keys(NOTICE_STATUS_LABELS) as NoticeStatus[]).map((s) => [s, 0]),
      ) as Record<NoticeStatus, number>;
      for (const n of notices) counts[n.status] += 1;

      const soon = addDays(todayIso(), 3);
      const complianceWarnings: DashboardData["complianceWarnings"] = [];
      for (const n of notices) {
        if (!["draft", "needs_review", "reviewed"].includes(n.status)) continue;
        const v = runValidation(db, n);
        if (v.blockers > 0)
          complianceWarnings.push({
            noticeId: n.id,
            tenantNames: n.tenantNames,
            message: `${v.blockers} blocking issue(s): ${v.issues.find((i) => i.level === "blocker")?.message ?? ""}`,
          });
      }
      return {
        countsByStatus: counts,
        expiringSoon: notices.filter(
          (n) => n.deadlineDate && n.deadlineDate <= soon && ["served", "mailed"].includes(n.status),
        ),
        needsReview: notices.filter((n) => n.status === "needs_review"),
        recentImports: ledgersRepo.list(db).slice(0, 5),
        recentActivity: auditRepo.list(db, { limit: 12 }),
        complianceWarnings,
        totals: {
          activeNotices: notices.filter(
            (n) => !["cancelled", "revised", "paid", "expired"].includes(n.status),
          ).length,
          totalDemandedCents: notices
            .filter((n) => !["cancelled", "revised"].includes(n.status))
            .reduce((s, n) => s + n.totalAmountCents, 0),
          paidAfterNoticeCents: notices
            .filter((n) => n.status === "paid")
            .reduce((s, n) => s + n.totalAmountCents, 0),
          tenants: tenantsRepo.list(db).length,
          properties: propertiesRepo.list(db).length,
        },
      };
    },
    async getReport(kind: ReportKind): Promise<ReportResult> {
      const db = await getDb();
      const notices = noticesRepo.list(db);
      const active = notices.filter((n) => !["cancelled", "revised"].includes(n.status));
      const rows: ReportResult["rows"] = [];
      const titleMap: Record<ReportKind, string> = {
        notices_by_month: "Notices Created by Month",
        notices_by_property: "Notices by Property",
        notices_by_status: "Notices by Status",
        amounts_noticed: "Amounts Noticed by Month",
        amounts_paid_after_notice: "Amounts Paid After Notice",
        sent_to_attorney: "Notices Sent to Attorney",
        repeat_delinquencies: "Repeat Tenant Delinquencies",
        excluded_charges: "Excluded Non-Rent Charges",
        staff_activity: "Staff Activity",
      };
      const group = <T,>(
        items: T[],
        key: (x: T) => string,
        val: (x: T) => number,
        isMoney: boolean,
      ) => {
        const map = new Map<string, number>();
        for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + val(item));
        for (const [label, value] of [...map.entries()].sort()) rows.push({ label, value, isMoney });
      };
      switch (kind) {
        case "notices_by_month":
          group(active, (n) => n.createdAt.slice(0, 7), () => 1, false);
          break;
        case "notices_by_property":
          group(
            active,
            (n) => propertiesRepo.get(db, n.propertyId)?.nickname ?? "Unknown",
            () => 1,
            false,
          );
          break;
        case "notices_by_status":
          group(notices, (n) => n.status, () => 1, false);
          break;
        case "amounts_noticed":
          group(active, (n) => n.createdAt.slice(0, 7), (n) => n.totalAmountCents, true);
          break;
        case "amounts_paid_after_notice":
          group(
            notices.filter((n) => n.status === "paid"),
            (n) => n.createdAt.slice(0, 7),
            (n) => n.totalAmountCents,
            true,
          );
          break;
        case "sent_to_attorney":
          group(
            notices.filter((n) => n.status === "sent_to_attorney" || n.attorneyExportFlag),
            (n) => n.tenantNames.join(", "),
            () => 1,
            false,
          );
          break;
        case "repeat_delinquencies": {
          const byTenant = new Map<string, number>();
          for (const n of active.filter((x) => x.noticeType === "pay_or_quit_3day"))
            byTenant.set(n.tenantNames.join(", "), (byTenant.get(n.tenantNames.join(", ")) ?? 0) + 1);
          for (const [label, value] of [...byTenant.entries()].filter(([, v]) => v > 1))
            rows.push({ label, value, isMoney: false });
          break;
        }
        case "excluded_charges": {
          const byClass = new Map<string, number>();
          for (const ledger of ledgersRepo.list(db)) {
            for (const txn of ledgersRepo.listTransactions(db, ledger.id)) {
              const cls = txn.userOverrideClass ?? txn.systemClass;
              if (cls !== "rent" && cls !== "payment" && cls !== "credit" && txn.amountCents > 0)
                byClass.set(cls, (byClass.get(cls) ?? 0) + txn.amountCents);
            }
          }
          for (const [label, value] of [...byClass.entries()].sort())
            rows.push({ label: label.replace(/_/g, " "), value, isMoney: true });
          break;
        }
        case "staff_activity":
          group(auditRepo.list(db), (a) => a.userName, () => 1, false);
          break;
      }
      return { kind, title: titleMap[kind], rows, generatedAt: nowIso() };
    },
    async exportNoticesCsv(filters?: NoticeFilters): Promise<Blob> {
      const db = await getDb();
      const list = applyNoticeFilters(noticesRepo.list(db), filters);
      const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
      const lines = [
        "Tenant,Property,Unit,Type,Status,Months,Total,Created,Served,Deadline",
        ...list.map((n) =>
          [
            esc(n.tenantNames.join("; ")),
            esc(n.propertyAddress),
            esc(n.unit),
            esc(NOTICE_TYPE_LABELS[n.noticeType]),
            esc(n.status),
            esc(n.months.map((m) => m.month).join("; ")),
            (n.totalAmountCents / 100).toFixed(2),
            n.createdAt.slice(0, 10),
            n.service.dateServed ?? "",
            n.deadlineDate ?? "",
          ].join(","),
        ),
      ];
      return new Blob([lines.join("\n")], { type: "text/csv" });
    },

    // --- state rules (50-state reference) ---
    async listStateRules() {
      await getDb();
      return [...STATE_RULES];
    },

    // --- backup / restore ---
    async exportBackup(): Promise<Blob> {
      requirePermission("settings.manage");
      const db = await getDb();
      logAudit(db, "backup_exported", "settings", null, "Exported local backup");
      const { blob } = await exportDbBackup(db);
      return blob;
    },
    async importBackup(file: File): Promise<BackupMeta> {
      requirePermission("settings.manage");
      const db = await getDb();
      const meta = await importDbBackup(db, file);
      for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
      blobUrlCache.clear();
      logAudit(db, "backup_restored", "settings", null, `Restored backup from ${meta.exportedAt}`);
      return meta;
    },
  } satisfies AppServices;

  return services;
}

registerServicesFactory(createServices);
