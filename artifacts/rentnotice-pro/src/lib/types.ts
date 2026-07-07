// ---------------------------------------------------------------------------
// RentNotice Pro — shared domain types
// All money values are integer cents. All dates are ISO strings (YYYY-MM-DD).
// Months are "YYYY-MM". IDs are string UUIDs.
// ---------------------------------------------------------------------------

export type Id = string;

// ----------------------------- Users & roles ------------------------------

export type UserRole = "admin" | "manager" | "staff" | "readonly";

export interface User {
  id: Id;
  name: string;
  initials: string;
  role: UserRole;
  pin: string | null; // 4-6 digit PIN, null = no PIN required
  active: boolean;
  createdAt: string; // ISO datetime
}

export interface SessionInfo {
  user: User | null;
  locked: boolean;
}

// ----------------------------- Company profile ----------------------------

export interface CompanyProfile {
  id: Id;
  name: string;
  address: string;
  phone: string;
  email: string;
  logoDataUrl: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------- Properties ---------------------------------

export type PaymentMethod =
  | "personal_check"
  | "cashiers_check"
  | "money_order"
  | "cash"
  | "electronic"
  | "online_portal"
  | "other";

export interface PaymentProfile {
  payToName: string; // authorized payment recipient
  paymentAddress: string;
  phone: string;
  acceptedMethods: PaymentMethod[];
  inPersonAllowed: boolean;
  officeHours: string; // e.g. "Mon–Fri 9:00 AM – 5:00 PM"
  paymentDays: string; // e.g. "Monday through Friday"
  electronicInstructions: string;
}

export interface Property {
  id: Id;
  nickname: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string; // 2-letter code
  zip: string;
  county: string;
  units: string[]; // unit labels
  ownerName: string;
  managementCompany: string;
  managerContact: string;
  payment: PaymentProfile;
  isLosAngelesCity: boolean; // triggers LAHD letter option
  notes: string;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------- Tenants -------------------------------------

export interface Tenant {
  id: Id;
  names: string[]; // all adult tenants on the lease
  propertyId: Id | null;
  unit: string;
  email: string;
  phone: string;
  monthlyRentCents: number | null; // scheduled rent if known
  leaseStart: string | null;
  moveOutDate: string | null;
  notes: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// ----------------------------- Ledgers & transactions ----------------------

export type LedgerSourceType = "csv" | "excel" | "pdf" | "pdf_ocr" | "manual";

export interface ColumnMapping {
  // maps a logical field -> source column header (or null if absent)
  date: string | null;
  description: string | null;
  chargeAmount: string | null;
  paymentAmount: string | null;
  creditAmount: string | null;
  amount: string | null; // single signed-amount column alternative
  balance: string | null;
  transactionType: string | null;
  category: string | null;
  memo: string | null;
  month: string | null;
  tenantIdentifier: string | null;
}

export type PmVendor =
  | "appfolio"
  | "buildium"
  | "yardi"
  | "propertyware"
  | "rent_manager"
  | "generic";

export interface MappingPreset {
  id: Id;
  name: string;
  vendor: PmVendor;
  mapping: ColumnMapping;
  createdAt: string;
}

export interface Ledger {
  id: Id;
  tenantId: Id;
  name: string; // e.g. "AppFolio export 2026-06"
  sourceType: LedgerSourceType;
  sourceFileName: string | null;
  vendor: PmVendor;
  mappingUsed: ColumnMapping | null;
  importedAt: string;
  importedBy: Id | null;
  transactionCount: number;
  periodStart: string | null; // earliest txn date
  periodEnd: string | null;
  notes: string;
}

export type TxnKind =
  | "rent_charge"
  | "payment"
  | "credit"
  | "reversal"
  | "void"
  | "refund"
  | "adjustment"
  | "non_rent_charge"
  | "deposit"
  | "unknown";

export type RentClass =
  | "rent" // included
  | "late_fee"
  | "nsf_fee"
  | "utility"
  | "maintenance"
  | "legal_fee"
  | "deposit"
  | "pet_fee"
  | "parking_fee"
  | "storage_fee"
  | "application_fee"
  | "admin_fee"
  | "rubs"
  | "hoa"
  | "insurance"
  | "repair"
  | "damage"
  | "court_cost"
  | "other_non_rent"
  | "payment"
  | "credit"
  | "unclassified";

export interface LedgerTransaction {
  id: Id;
  ledgerId: Id;
  rowIndex: number;
  date: string; // YYYY-MM-DD
  month: string; // YYYY-MM derived
  description: string;
  originalCategory: string;
  memo: string;
  kind: TxnKind;
  amountCents: number; // positive = charge, negative = payment/credit (normalized)
  balanceCents: number | null;
  // classification
  systemClass: RentClass;
  confidence: number; // 0..1
  includedInNotice: boolean;
  classReason: string; // system explanation
  userOverrideClass: RentClass | null;
  overrideReason: string | null;
  overriddenBy: Id | null;
  flagged: boolean; // ambiguous / needs manual review
  flagReason: string | null;
}

// ----------------------------- Import (wizard) -----------------------------

export interface ParsedLedgerFile {
  sourceType: LedgerSourceType;
  fileName: string;
  headers: string[];
  rows: Record<string, string>[]; // raw values by header
  detectedVendor: PmVendor;
  suggestedMapping: ColumnMapping;
  warnings: string[];
  ocrUsed: boolean;
}

export interface ImportLedgerInput {
  tenantId: Id;
  name: string;
  sourceType: LedgerSourceType;
  fileName: string | null;
  vendor: PmVendor;
  mapping: ColumnMapping | null;
  rows: Record<string, string>[]; // mapped raw rows (header -> value)
  manualTransactions?: ManualTransactionInput[]; // for manual entry
  savePresetName?: string | null;
}

export interface ManualTransactionInput {
  date: string;
  description: string;
  category: string;
  amountCents: number; // positive charge, negative payment
  memo?: string;
}

// ----------------------------- Calculation ---------------------------------

export interface MonthCalculation {
  month: string; // YYYY-MM
  periodStart: string; // first of month
  periodEnd: string; // last day of month
  rentChargedCents: number;
  paymentsAppliedCents: number;
  creditsAppliedCents: number;
  excludedChargesCents: number;
  excludedItems: { description: string; amountCents: number; class: RentClass }[];
  rentOnlyBalanceCents: number;
  carryInCents: number; // overpayment carried in from prior month (if supported)
  warnings: string[];
  transactions: LedgerTransaction[];
}

export interface CalculationResult {
  ledgerId: Id;
  months: MonthCalculation[];
  totalRentOnlyCents: number;
  totalExcludedCents: number;
  unappliedPaymentsCents: number;
  globalWarnings: string[];
  computedAt: string;
}

// ----------------------------- Notices --------------------------------------

export type NoticeType =
  | "pay_or_quit_3day"
  | "perform_covenant_3day"
  | "entry_24hr"
  | "termination_30day"
  | "termination_60day"
  | "rent_increase";

export type NoticeStatus =
  | "draft"
  | "needs_review"
  | "reviewed"
  | "finalized"
  | "served"
  | "mailed"
  | "expired"
  | "paid"
  | "sent_to_attorney"
  | "cancelled"
  | "revised";

export interface NoticeMonth {
  month: string;
  periodStart: string;
  periodEnd: string;
  rentChargedCents: number;
  paymentsAppliedCents: number;
  creditsAppliedCents: number;
  rentOnlyBalanceCents: number;
  selectedAmountCents: number; // amount actually demanded (may be overridden)
  overrideReason: string | null;
}

export type ServiceMethod =
  | "personal"
  | "substitute"
  | "post_and_mail"
  | "other";

export interface ServiceRecord {
  dateServed: string | null;
  timeServed: string | null;
  method: ServiceMethod | null;
  servedBy: string;
  serverNotes: string;
  mailedDate: string | null;
}

export interface Notice {
  id: Id;
  noticeType: NoticeType;
  jurisdiction: string; // state code, e.g. "CA"
  status: NoticeStatus;
  tenantId: Id;
  propertyId: Id;
  unit: string;
  tenantNames: string[]; // snapshot
  propertyAddress: string; // snapshot, single line
  ledgerId: Id | null;
  months: NoticeMonth[];
  totalAmountCents: number;
  payment: PaymentProfile; // snapshot, editable per notice
  templateId: Id | null;
  templateVersion: number | null;
  includeLahdLetter: boolean;
  // covenant / termination / rent-increase specifics
  covenantDescription: string; // perform-covenant details
  entryDate: string | null; // 24hr entry
  entryTimeWindow: string;
  entryReason: string;
  terminationDate: string | null;
  rentIncreaseNewAmountCents: number | null;
  rentIncreaseEffectiveDate: string | null;
  // workflow
  version: number; // 1..n
  revisedFromId: Id | null;
  reviewerApprovedBy: Id | null;
  reviewerApprovedAt: string | null;
  finalizedBy: Id | null;
  finalizedAt: string | null;
  attorneyExportFlag: boolean;
  service: ServiceRecord;
  deadlineDate: string | null; // computed expiration
  internalNotes: string;
  preparedBy: Id | null;
  createdAt: string;
  updatedAt: string;
}

export interface NoticeInput {
  noticeType: NoticeType;
  jurisdiction: string;
  tenantId: Id;
  propertyId: Id;
  unit: string;
  ledgerId: Id | null;
  months: NoticeMonth[];
  payment: PaymentProfile;
  templateId: Id | null;
  includeLahdLetter: boolean;
  covenantDescription?: string;
  entryDate?: string | null;
  entryTimeWindow?: string;
  entryReason?: string;
  terminationDate?: string | null;
  rentIncreaseNewAmountCents?: number | null;
  rentIncreaseEffectiveDate?: string | null;
  internalNotes?: string;
  duplicateOverrideReason?: string | null;
}

export interface NoticeFilters {
  search?: string;
  status?: NoticeStatus | "all";
  noticeType?: NoticeType | "all";
  propertyId?: Id | "all";
  tenantId?: Id;
  month?: string; // YYYY-MM
  createdFrom?: string;
  createdTo?: string;
  servedFrom?: string;
  servedTo?: string;
  amountMinCents?: number;
  amountMaxCents?: number;
  preparedBy?: Id | "all";
}

export interface DuplicateCheckResult {
  duplicate: boolean;
  existing: Notice[];
}

// ----------------------------- Validation ----------------------------------

export type ValidationLevel = "warning" | "blocker";

export interface ValidationIssue {
  code: string;
  level: ValidationLevel;
  message: string; // plain-English
  field: string | null;
  acknowledgeable: boolean; // warnings can be acknowledged with reason
}

export interface ValidationResult {
  noticeId: Id;
  issues: ValidationIssue[];
  blockers: number;
  warnings: number;
  passed: boolean; // no blockers
}

// ----------------------------- Documents ------------------------------------

export type DocumentKind =
  | "notice" // the notice itself
  | "proof_of_service"
  | "posting_checklist"
  | "calc_review"
  | "excluded_summary"
  | "audit_summary"
  | "ledger_backup"
  | "lahd_letter";

export type PacketKind = "draft" | "final" | "internal_packet" | "attorney_packet";

export interface NoticeDocument {
  id: Id;
  noticeId: Id;
  kind: DocumentKind | "packet";
  packetKind: PacketKind | null;
  fileName: string;
  watermarked: boolean;
  locked: boolean;
  pageCount: number;
  sizeBytes: number;
  generatedAt: string;
  generatedBy: Id | null;
  blobUrl: string; // object URL for preview/download (session-scoped)
}

export interface GenerateDocumentsInput {
  noticeId: Id;
  packetKind: PacketKind;
  acknowledgedWarnings?: { code: string; reason: string }[];
}

// ----------------------------- Templates ------------------------------------

export interface TemplateVersion {
  version: number;
  body: string; // template text with {{merge_fields}}
  changedBy: Id | null;
  changedAt: string;
  changeNote: string;
}

export interface NoticeTemplate {
  id: Id;
  name: string;
  noticeType: NoticeType;
  jurisdiction: string; // state code
  locality: string | null; // e.g. "los_angeles"
  active: boolean;
  attorneyReviewed: boolean;
  reviewedBy: string;
  reviewDate: string | null;
  currentVersion: number;
  versions: TemplateVersion[];
  mergeFields: string[]; // documented fields available
  builtIn: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateUpdateInput {
  name?: string;
  active?: boolean;
  attorneyReviewed?: boolean;
  reviewedBy?: string;
  reviewDate?: string | null;
  body?: string; // creates a new version when provided
  changeNote?: string;
}

// ----------------------------- Holidays & deadlines --------------------------

export interface Holiday {
  id: Id;
  date: string; // YYYY-MM-DD
  name: string;
  jurisdiction: string; // "CA"
  courtHoliday: boolean;
  builtIn: boolean;
}

export interface DeadlineResult {
  serviceDate: string;
  noticeType: NoticeType;
  jurisdiction: string;
  countedDays: number; // e.g. 3
  excludedDates: { date: string; reason: "weekend" | "holiday"; name?: string }[];
  expirationDate: string;
  explanation: string[]; // step-by-step day counting
  disclaimer: string;
}

// ----------------------------- Status & audit --------------------------------

export interface StatusHistoryEntry {
  id: Id;
  noticeId: Id;
  fromStatus: NoticeStatus | null;
  toStatus: NoticeStatus;
  changedBy: Id | null;
  changedAt: string;
  reason: string;
}

export type AuditAction =
  | "tenant_created"
  | "tenant_updated"
  | "tenant_deleted"
  | "property_created"
  | "property_updated"
  | "property_deleted"
  | "ledger_imported"
  | "ledger_deleted"
  | "mapping_changed"
  | "transaction_classified"
  | "charge_excluded"
  | "charge_included"
  | "manual_override"
  | "rent_amount_changed"
  | "draft_generated"
  | "notice_created"
  | "notice_updated"
  | "notice_finalized"
  | "notice_revised"
  | "pdf_exported"
  | "status_changed"
  | "attachment_added"
  | "attachment_deleted"
  | "draft_deleted"
  | "sent_to_attorney"
  | "template_created"
  | "template_updated"
  | "settings_changed"
  | "user_created"
  | "user_updated"
  | "holiday_changed"
  | "backup_exported"
  | "backup_restored"
  | "login"
  | "warning_acknowledged";

export interface AuditEntry {
  id: Id;
  timestamp: string;
  userId: Id | null;
  userName: string;
  action: AuditAction;
  entityType: string; // "tenant" | "notice" | ...
  entityId: Id | null;
  summary: string; // plain-English
  previousValue: string | null;
  newValue: string | null;
  reason: string | null;
}

export interface AuditFilters {
  entityType?: string;
  entityId?: Id;
  userId?: Id;
  action?: AuditAction;
  from?: string;
  to?: string;
  limit?: number;
}

// ----------------------------- Attachments -----------------------------------

export type AttachmentKind =
  | "original_ledger"
  | "cleaned_ledger"
  | "signed_notice"
  | "proof_of_service"
  | "photo"
  | "mailing_receipt"
  | "attorney_correspondence"
  | "lahd_letter"
  | "internal_notes"
  | "other";

export interface Attachment {
  id: Id;
  entityType: "notice" | "tenant" | "property" | "ledger";
  entityId: Id;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string; // base64 data URL (stored locally)
  uploadedBy: Id | null;
  uploadedAt: string;
  note: string;
}

// ----------------------------- Field assignments (mobile companion) ----------

export type FieldAssignmentStatus =
  | "assigned"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface FieldEvidence {
  id: Id;
  photoDataUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string;
  note: string;
}

export interface FieldAssignment {
  id: Id;
  noticeId: Id;
  assigneeName: string;
  instructions: string;
  status: FieldAssignmentStatus;
  serviceMethod: ServiceMethod | null;
  completedAt: string | null;
  evidence: FieldEvidence[];
  createdAt: string;
  updatedAt: string;
}

// ----------------------------- Certified mail tracking ------------------------

export type MailStatus =
  | "preparing"
  | "mailed"
  | "in_transit"
  | "delivered"
  | "returned"
  | "unknown";

export interface MailTrackingEvent {
  date: string;
  status: MailStatus;
  note: string;
}

export interface MailTracking {
  id: Id;
  noticeId: Id;
  carrier: string; // "USPS Certified" etc.
  trackingNumber: string;
  status: MailStatus;
  mailedDate: string | null;
  events: MailTrackingEvent[];
  createdAt: string;
  updatedAt: string;
}

// ----------------------------- Settings ---------------------------------------

export interface AppSettings {
  id: "app";
  companyProfileId: Id | null;
  defaultJurisdiction: string; // "CA"
  requireAttorneyReviewedTemplate: boolean;
  allowAdminTemplateOverride: boolean;
  pinLockEnabled: boolean;
  autoLockMinutes: number;
  aiAssistEnabled: boolean; // requires explicit opt-in
  aiConsentAcknowledged: boolean;
  syncEnabled: boolean; // mobile companion sync opt-in
  syncEndpoint: string;
  disclaimerAcknowledgedAt: string | null;
  onboardingCompleted: boolean;
  updatedAt: string;
}

// ----------------------------- Dashboard & reports -----------------------------

export interface DashboardData {
  countsByStatus: Record<NoticeStatus, number>;
  expiringSoon: Notice[]; // deadline within 3 days
  needsReview: Notice[];
  recentImports: Ledger[];
  recentActivity: AuditEntry[];
  complianceWarnings: { noticeId: Id; tenantNames: string[]; message: string }[];
  totals: {
    activeNotices: number;
    totalDemandedCents: number;
    paidAfterNoticeCents: number;
    tenants: number;
    properties: number;
  };
}

export type ReportKind =
  | "notices_by_month"
  | "notices_by_property"
  | "notices_by_status"
  | "amounts_noticed"
  | "amounts_paid_after_notice"
  | "sent_to_attorney"
  | "repeat_delinquencies"
  | "excluded_charges"
  | "staff_activity";

export interface ReportRow {
  label: string;
  value: number; // count or cents depending on report
  isMoney: boolean;
  extra?: Record<string, string | number>;
}

export interface ReportResult {
  kind: ReportKind;
  title: string;
  rows: ReportRow[];
  generatedAt: string;
}

// ----------------------------- State law reference (50 states) -----------------

export interface StateRuleSummary {
  stateCode: string;
  stateName: string;
  payOrQuitDays: number; // statutory cure period for nonpayment
  countingRule: string; // plain-English description of day counting
  weekendsExcluded: boolean;
  holidaysExcluded: boolean;
  templateStatus: "attorney_review_required" | "reviewed";
  notes: string;
}

// ----------------------------- Backup ------------------------------------------

export interface BackupMeta {
  exportedAt: string;
  appVersion: string;
  counts: Record<string, number>;
}

// ----------------------------- Constants ---------------------------------------

export const LEGAL_DISCLAIMER =
  "This software is a document-preparation and ledger-calculation tool. It does not provide legal advice. California landlord-tenant law and local requirements may change. All templates, notices, service procedures, deadlines, and attachments should be reviewed and approved by a qualified California attorney before use.";

export const NOTICE_TYPE_LABELS: Record<NoticeType, string> = {
  pay_or_quit_3day: "3-Day Notice to Pay Rent or Quit",
  perform_covenant_3day: "3-Day Notice to Perform Covenant or Quit",
  entry_24hr: "24-Hour Notice of Intent to Enter",
  termination_30day: "30-Day Notice of Termination of Tenancy",
  termination_60day: "60-Day Notice of Termination of Tenancy",
  rent_increase: "Notice of Rent Increase",
};

export const NOTICE_STATUS_LABELS: Record<NoticeStatus, string> = {
  draft: "Draft",
  needs_review: "Needs Review",
  reviewed: "Reviewed",
  finalized: "Finalized",
  served: "Served",
  mailed: "Mailed",
  expired: "Expired",
  paid: "Paid",
  sent_to_attorney: "Sent to Attorney",
  cancelled: "Cancelled",
  revised: "Revised",
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  personal_check: "Personal check",
  cashiers_check: "Cashier's check",
  money_order: "Money order",
  cash: "Cash",
  electronic: "Electronic transfer",
  online_portal: "Online portal",
  other: "Other",
};

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  notice: "Notice",
  proof_of_service: "Proof of Service",
  posting_checklist: "Posting / Mailing Checklist",
  calc_review: "Calculation Review",
  excluded_summary: "Excluded Charge Summary",
  audit_summary: "Audit Log Summary",
  ledger_backup: "Ledger Backup",
  lahd_letter: "LAHD Right to Counsel Letter",
};

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
