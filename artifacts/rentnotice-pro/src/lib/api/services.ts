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
  CommsAuditAction,
  BackupMeta,
  CalculationResult,
  CompanyProfile,
  DashboardData,
  DeadlineResult,
  DuplicateCheckResult,
  ExternalPropertyUpsert,
  ExternalTenantUpsert,
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
  ServiceMethod,
  ServiceRecord,
  SampleDataOptions,
  SampleDataState,
  SessionInfo,
  StateRuleReview,
  StateRuleSummary,
  TemplateUpdateInput,
  Tenant,
  User,
  UserRole,
  ValidationResult,
  WorkOrder,
  WorkOrderCategory,
  WorkOrderFilters,
  WorkOrderPriority,
  WorkOrderStatus,
  WorkspaceState,
} from "../types";
import type { LicenseSummary } from "../licensing/types";

export interface DeadlineContext {
  /** Service method used — enables rule-pack mail extensions in other states. */
  serviceMethod?: ServiceMethod;
  /** Rent-increase amount context — enables the 90-day rule under §827(b)(2). */
  rentIncrease?: {
    newRentCents: number | null;
    currentRentCents: number | null;
  };
}

export interface SetStateRuleReviewInput {
  /** 2-letter state code (case-insensitive). */
  state: string;
  reviewerName: string;
  /** ISO date (YYYY-MM-DD) the attorney completed the review. */
  reviewedAt: string;
  notes?: string;
}

export interface CreatePropertyInput {
  nickname: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  zip: string;
  county?: string;
  bedrooms?: number | null;
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
  username: string;
  email?: string | null;
  role: UserRole;
  pin?: string | null;
}

export interface ActivateWorkspaceInput {
  licenseKey: string;
  /** Username or email of a company directory member (typically the master admin). */
  identifier: string;
  /** Their cloud password — verified online, never stored raw. */
  secret: string;
}

export interface ChangeMyPasswordInput {
  /** The signed-in user's current password (may be a legacy short numeric secret). */
  currentPassword: string;
  /** The new password — minimum 8 characters. */
  newPassword: string;
}

export interface RedeemInviteCodeInput {
  /** Single-use invite code from a company admin (INV-XXXX-XXXX). */
  inviteCode: string;
  /** Full name the invitee chooses for their account. */
  name: string;
  /** Password the invitee sets — verified/set online, never stored raw. */
  password: string;
}

export interface CreateTemplateInput {
  name: string;
  noticeType: NoticeType;
  jurisdiction: string;
  locality?: string | null;
  body: string;
}

export interface AddAttachmentInput {
  entityType: "notice" | "tenant" | "property" | "ledger" | "work_order";
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

export interface FinalizeAttestation {
  /**
   * The preparer certifies the amounts demanded contain scheduled rent only —
   * no late fees, utilities, deposits, or other non-rent charges. Required
   * (must be true) for any notice that demands money.
   */
  rentOnlyConfirmed: boolean;
}

export interface CreateWorkOrderInput {
  propertyId: Id;
  tenantId?: Id | null;
  unit?: string;
  title: string;
  description?: string;
  category: WorkOrderCategory;
  priority: WorkOrderPriority;
  dueDate?: string | null;
  assigneeName?: string;
  vendorName?: string;
  vendorContact?: string;
  costEstimateCents?: number | null;
  costActualCents?: number | null;
  internalNotes?: string;
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
  /** Sign in with an email plus the account's password (legacy usernames and short numeric secrets are still accepted). */
  login(identifier: string, secret: string): Promise<SessionInfo>;
  lockApp(): Promise<SessionInfo>;
  /**
   * Forget the signed-in user's cached chat token. Called when the server
   * rejects it (expired or revoked); the Communications page then shows
   * sign-in guidance until the next online sign-in re-mints a fresh one.
   */
  clearChatToken(): Promise<SessionInfo>;
  createUser(input: CreateUserInput): Promise<User>;
  updateUser(id: Id, patch: Partial<Omit<User, "id" | "createdAt">>): Promise<User>;
  /**
   * Change the signed-in user's own password. Verifies the current password,
   * updates the cloud directory first in activated workspaces (requires an
   * internet connection there), then refreshes the local offline sign-in hash.
   */
  changeMyPassword(input: ChangeMyPasswordInput): Promise<User>;

  // --- workspace activation ---
  getWorkspaceState(): Promise<WorkspaceState>;
  /** Explicit first-run choice: seed the local demo workspace. */
  enterDemoMode(): Promise<void>;

  // --- sample data ---
  /** Whether sample data is loaded and whether the current user may load it. */
  getSampleDataState(): Promise<SampleDataState>;
  /**
   * Generate a realistic sample portfolio (admin only, empty-ish workspaces).
   * Options are all optional — unset fields fall back to defaults (~1000
   * doors). Strictly additive; every record is tagged for clean removal.
   */
  loadSampleData(
    options?: SampleDataOptions | null,
    onProgress?: (step: string, done: number, total: number) => void,
  ): Promise<void>;
  /** Remove every sample-tagged record. Never touches real data. */
  removeSampleData(): Promise<void>;
  /** Check a license key online and return the company it belongs to. */
  validateLicenseKey(licenseKey: string): Promise<LicenseSummary>;
  /**
   * Activate this device with a company license: verifies the member's
   * credentials online, provisions a clean local workspace from the company
   * directory (replacing any demo data), and signs them in.
   */
  activateWorkspace(input: ActivateWorkspaceInput): Promise<SessionInfo>;
  /**
   * Redeem a single-use invite code from a company admin: sets the invitee's
   * name/password in the cloud, provisions a clean local workspace from the
   * company directory (replacing any demo data), and signs them in.
   */
  redeemInviteCode(input: RedeemInviteCodeInput): Promise<SessionInfo>;
  /**
   * Re-verify the license and sync the user directory from the cloud
   * (launch-time and manual "Sync now"). Offline is not an error: the cached
   * state is kept and the offline grace period governs lockout.
   */
  syncLicense(): Promise<WorkspaceState>;

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
  /** Create-or-update a property imported from an external system (matched by external ids). */
  upsertExternalProperty(input: ExternalPropertyUpsert): Promise<{ property: Property; created: boolean }>;

  // --- tenants ---
  listTenants(search?: string, propertyId?: Id): Promise<Tenant[]>;
  getTenant(id: Id): Promise<Tenant | null>;
  createTenant(input: CreateTenantInput): Promise<Tenant>;
  updateTenant(id: Id, patch: Partial<Omit<Tenant, "id" | "createdAt">>): Promise<Tenant>;
  deleteTenant(id: Id): Promise<void>;
  /** Create-or-update a tenant imported from an external system (matched by external ids). */
  upsertExternalTenant(input: ExternalTenantUpsert): Promise<{ tenant: Tenant; created: boolean }>;

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
    attestation: FinalizeAttestation,
  ): Promise<Notice>;
  reviseNotice(id: Id, reason: string): Promise<Notice>;
  recordService(
    id: Id,
    service: ServiceRecord,
    options?: { source?: "field_sync"; electronicConsent?: boolean },
  ): Promise<Notice>;

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
    context?: DeadlineContext,
  ): Promise<DeadlineResult>;

  // --- audit ---
  listAudit(filters?: AuditFilters): Promise<AuditEntry[]>;
  recordCommsAudit(
    action: CommsAuditAction,
    entityId: Id | null,
    summary: string,
  ): Promise<void>;

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

  // --- maintenance / work orders ---
  listWorkOrders(filters?: WorkOrderFilters): Promise<WorkOrder[]>;
  getWorkOrder(id: Id): Promise<WorkOrder | null>;
  createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder>;
  updateWorkOrder(
    id: Id,
    patch: Partial<Omit<WorkOrder, "id" | "createdAt" | "statusHistory" | "status">>,
  ): Promise<WorkOrder>;
  changeWorkOrderStatus(id: Id, toStatus: WorkOrderStatus, note?: string): Promise<WorkOrder>;
  deleteWorkOrder(id: Id, reason: string): Promise<void>;

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

  // --- state rule attorney reviews ---
  listStateRuleReviews(): Promise<StateRuleReview[]>;
  setStateRuleReview(input: SetStateRuleReviewInput): Promise<StateRuleReview>;
  clearStateRuleReview(state: string): Promise<void>;

  // --- backup / restore ---
  exportBackup(): Promise<Blob>;
  importBackup(file: File): Promise<BackupMeta>;

  // --- startup recovery ---
  /** Retry a failed database open/migration (used by the startup error screen). */
  retryDatabaseInit(): Promise<void>;
  /**
   * Destructive recovery: erase the locally persisted database so the app can
   * boot fresh. Callers must guard this behind an explicit confirmation.
   */
  resetLocalData(): Promise<void>;
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
