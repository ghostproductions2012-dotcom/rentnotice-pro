// ---------------------------------------------------------------------------
// AppServices — the single contract between the UI and the local data layer.
// The UI (pages/components) must ONLY talk to this via the hooks in hooks.ts.
// Implementations are swapped in impl.ts (stub now, sql.js-backed later).
// ---------------------------------------------------------------------------

import type {
  AppSettings,
  Attachment,
  AttachmentKind,
  AuditEntry,
  AuditFilters,
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
  MappingPreset,
  Notice,
  NoticeDocument,
  NoticeFilters,
  NoticeInput,
  NoticeStatus,
  NoticeTemplate,
  NoticeType,
  ParsedLedgerFile,
  Property,
  RentClass,
  ReportKind,
  ReportResult,
  ServiceRecord,
  SessionInfo,
  StateRuleSummary,
  TemplateUpdateInput,
  Tenant,
  User,
  UserRole,
  ValidationResult,
} from "../types";

export interface CreatePropertyInput {
  nickname: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  units?: string[];
  ownerName: string;
  managementCompany?: string;
  managerContact?: string;
  payment?: Partial<Property["payment"]>;
  isLosAngelesCity?: boolean;
  notes?: string;
}

export interface CreateTenantInput {
  names: string[];
  propertyId: Id | null;
  unit?: string;
  email?: string;
  phone?: string;
  monthlyRentCents?: number | null;
  leaseStart?: string | null;
  notes?: string;
}

export interface ClassificationOverrideInput {
  transactionId: Id;
  overrideClass: RentClass | null; // null clears the override
  includedInNotice: boolean;
  reason: string; // required for any override
}

export interface CreateUserInput {
  name: string;
  role: UserRole;
  pin?: string | null;
}

export interface CreateTemplateInput {
  name: string;
  noticeType: NoticeType;
  jurisdiction: string;
  locality?: string | null;
  body: string;
}

export interface AddAttachmentInput {
  entityType: "notice" | "tenant" | "property" | "ledger";
  entityId: Id;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  note?: string;
}

export interface CreateFieldAssignmentInput {
  noticeId: Id;
  assigneeName: string;
  instructions?: string;
}

export interface CreateMailTrackingInput {
  noticeId: Id;
  carrier: string;
  trackingNumber: string;
  mailedDate?: string | null;
}

export interface LedgerDetail {
  ledger: Ledger;
  transactions: LedgerTransaction[];
}

export interface AppServices {
  // --- session & users ---
  getSession(): Promise<SessionInfo>;
  listUsers(): Promise<User[]>;
  selectUser(userId: Id, pin?: string): Promise<SessionInfo>;
  lockApp(): Promise<SessionInfo>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: Id, patch: Partial<Omit<User, "id" | "createdAt">>): Promise<User>;

  // --- company & settings ---
  getCompanyProfile(): Promise<CompanyProfile>;
  updateCompanyProfile(patch: Partial<Omit<CompanyProfile, "id">>): Promise<CompanyProfile>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: Partial<Omit<AppSettings, "id">>): Promise<AppSettings>;

  // --- properties ---
  listProperties(search?: string): Promise<Property[]>;
  getProperty(id: Id): Promise<Property | null>;
  createProperty(input: CreatePropertyInput): Promise<Property>;
  updateProperty(id: Id, patch: Partial<Omit<Property, "id" | "createdAt">>): Promise<Property>;
  deleteProperty(id: Id): Promise<void>;

  // --- tenants ---
  listTenants(search?: string, propertyId?: Id): Promise<Tenant[]>;
  getTenant(id: Id): Promise<Tenant | null>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  updateTenant(id: Id, patch: Partial<Omit<Tenant, "id" | "createdAt">>): Promise<Tenant>;
  deleteTenant(id: Id): Promise<void>;

  // --- ledgers & import ---
  listLedgers(tenantId?: Id): Promise<Ledger[]>;
  getLedger(id: Id): Promise<LedgerDetail | null>;
  parseLedgerFile(file: File): Promise<ParsedLedgerFile>;
  importLedger(input: ImportLedgerInput): Promise<Ledger>;
  deleteLedger(id: Id): Promise<void>;
  overrideClassification(input: ClassificationOverrideInput): Promise<LedgerTransaction>;
  listMappingPresets(): Promise<MappingPreset[]>;
  saveMappingPreset(preset: Omit<MappingPreset, "id" | "createdAt">): Promise<MappingPreset>;
  deleteMappingPreset(id: Id): Promise<void>;

  // --- calculation ---
  calculateLedger(ledgerId: Id): Promise<CalculationResult>;

  // --- notices ---
  listNotices(filters?: NoticeFilters): Promise<Notice[]>;
  getNotice(id: Id): Promise<Notice | null>;
  checkDuplicateNotice(params: {
    tenantId: Id;
    propertyId: Id;
    unit: string;
    months: string[];
    noticeType: NoticeType;
  }): Promise<DuplicateCheckResult>;
  createNotice(input: NoticeInput): Promise<Notice>;
  updateNotice(id: Id, patch: Partial<NoticeInput> & { internalNotes?: string }): Promise<Notice>;
  deleteNotice(id: Id, reason: string): Promise<void>;
  validateNotice(id: Id): Promise<ValidationResult>;
  changeNoticeStatus(id: Id, toStatus: NoticeStatus, reason?: string): Promise<Notice>;
  approveNotice(id: Id): Promise<Notice>;
  finalizeNotice(
    id: Id,
    acknowledgedWarnings: { code: string; reason: string }[],
  ): Promise<Notice>;
  reviseNotice(id: Id, reason: string): Promise<Notice>;
  recordService(id: Id, service: ServiceRecord): Promise<Notice>;

  // --- documents ---
  generateDocuments(input: GenerateDocumentsInput): Promise<NoticeDocument[]>;
  listDocuments(noticeId: Id): Promise<NoticeDocument[]>;

  // --- templates ---
  listTemplates(filters?: {
    noticeType?: NoticeType;
    jurisdiction?: string;
  }): Promise<NoticeTemplate[]>;
  getTemplate(id: Id): Promise<NoticeTemplate | null>;
  createTemplate(input: CreateTemplateInput): Promise<NoticeTemplate>;
  updateTemplate(id: Id, patch: TemplateUpdateInput): Promise<NoticeTemplate>;

  // --- holidays & deadlines ---
  listHolidays(year?: number): Promise<Holiday[]>;
  addHoliday(input: Omit<Holiday, "id" | "builtIn">): Promise<Holiday>;
  deleteHoliday(id: Id): Promise<void>;
  computeDeadline(
    serviceDate: string,
    noticeType: NoticeType,
    jurisdiction: string,
  ): Promise<DeadlineResult>;

  // --- audit ---
  listAudit(filters?: AuditFilters): Promise<AuditEntry[]>;

  // --- attachments ---
  listAttachments(entityType: Attachment["entityType"], entityId: Id): Promise<Attachment[]>;
  addAttachment(input: AddAttachmentInput): Promise<Attachment>;
  deleteAttachment(id: Id): Promise<void>;

  // --- field assignments (mobile companion) ---
  listFieldAssignments(noticeId?: Id): Promise<FieldAssignment[]>;
  createFieldAssignment(input: CreateFieldAssignmentInput): Promise<FieldAssignment>;
  updateFieldAssignment(
    id: Id,
    patch: Partial<Omit<FieldAssignment, "id" | "noticeId" | "createdAt">>,
  ): Promise<FieldAssignment>;
  addFieldEvidence(assignmentId: Id, evidence: Omit<FieldEvidence, "id">): Promise<FieldAssignment>;

  // --- certified mail tracking ---
  listMailTracking(noticeId?: Id): Promise<MailTracking[]>;
  createMailTracking(input: CreateMailTrackingInput): Promise<MailTracking>;
  updateMailTracking(
    id: Id,
    patch: Partial<Omit<MailTracking, "id" | "noticeId" | "createdAt">>,
  ): Promise<MailTracking>;

  // --- dashboard, reports, search export ---
  getDashboard(): Promise<DashboardData>;
  getReport(kind: ReportKind): Promise<ReportResult>;
  exportNoticesCsv(filters?: NoticeFilters): Promise<Blob>;

  // --- state rules (50-state reference) ---
  listStateRules(): Promise<StateRuleSummary[]>;

  // --- backup / restore ---
  exportBackup(): Promise<Blob>;
  importBackup(file: File): Promise<BackupMeta>;
}

let instance: AppServices | null = null;
let factory: (() => AppServices) | null = null;

/** Called once at module-init time by impl.ts (or a test) to register the implementation. */
export function registerServicesFactory(f: () => AppServices): void {
  factory = f;
  instance = null;
}

export function getServices(): AppServices {
  if (!instance) {
    if (!factory) {
      // Lazily require the default implementation registration.
      throw new Error(
        "AppServices not registered. Ensure src/lib/api/impl.ts is imported before use.",
      );
    }
    instance = factory();
  }
  return instance;
}
