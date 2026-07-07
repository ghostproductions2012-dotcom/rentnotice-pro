// ---------------------------------------------------------------------------
// Stub implementation of AppServices (in-memory, seeded).
// This unblocks the UI while the real engines (sql.js DB, parsers, calculation,
// document generation) are built. It will be replaced by the composed
// implementation in a later integration pass — the AppServices contract and
// all behavior semantics stay identical.
// ---------------------------------------------------------------------------

import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { registerServicesFactory } from "./services";
import type {
  AppServices,
  AddAttachmentInput,
  ClassificationOverrideInput,
  CreateFieldAssignmentInput,
  CreateMailTrackingInput,
  CreatePropertyInput,
  CreateTemplateInput,
  CreateTenantInput,
  CreateUserInput,
  LedgerDetail,
} from "./services";
import type {
  AppSettings,
  Attachment,
  AuditAction,
  AuditEntry,
  AuditFilters,
  BackupMeta,
  CalculationResult,
  ColumnMapping,
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
  MonthCalculation,
  Notice,
  NoticeDocument,
  NoticeFilters,
  NoticeInput,
  NoticeStatus,
  NoticeTemplate,
  NoticeType,
  ParsedLedgerFile,
  PaymentProfile,
  PmVendor,
  Property,
  RentClass,
  ReportKind,
  ReportResult,
  ServiceRecord,
  SessionInfo,
  StateRuleSummary,
  StatusHistoryEntry,
  TemplateUpdateInput,
  Tenant,
  User,
  ValidationIssue,
  ValidationResult,
} from "../types";
import {
  LEGAL_DISCLAIMER,
  NOTICE_TYPE_LABELS,
  formatCents,
} from "../types";

// ------------------------------- utilities ---------------------------------

const uid = (): Id =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const nowIso = () => new Date().toISOString();

function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = lastDayOfMonth(y, m - 1);
  return {
    start: `${month}-01`,
    end: `${month}-${String(last).padStart(2, "0")}`,
  };
}

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekend(dateIso: string): boolean {
  const d = new Date(`${dateIso}T12:00:00`).getDay();
  return d === 0 || d === 6;
}

function parseAmountToCents(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim().replace(/[$,\s]/g, "");
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return Math.round(n * 100) * (negative ? -1 : 1);
}

function parseDateFlexible(raw: string): string | null {
  if (!raw) return null;
  const t = raw.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  }
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

// --------------------------- classification --------------------------------

const CLASS_KEYWORDS: { cls: RentClass; words: string[] }[] = [
  { cls: "late_fee", words: ["late fee", "late charge", "latefee"] },
  { cls: "nsf_fee", words: ["nsf", "returned check", "insufficient"] },
  {
    cls: "utility",
    words: ["utility", "utilities", "water", "sewer", "trash", "electric", "gas bill", "rubs"],
  },
  { cls: "maintenance", words: ["maintenance", "service call"] },
  { cls: "legal_fee", words: ["legal", "attorney", "court cost", "filing fee"] },
  { cls: "deposit", words: ["deposit", "security dep"] },
  { cls: "pet_fee", words: ["pet"] },
  { cls: "parking_fee", words: ["parking", "garage"] },
  { cls: "storage_fee", words: ["storage"] },
  { cls: "application_fee", words: ["application"] },
  { cls: "admin_fee", words: ["admin", "administrative", "processing fee"] },
  { cls: "hoa", words: ["hoa"] },
  { cls: "insurance", words: ["insurance", "renters ins"] },
  { cls: "repair", words: ["repair"] },
  { cls: "damage", words: ["damage"] },
  { cls: "rent", words: ["rent"] },
];

function classifyDescription(desc: string, category: string): {
  cls: RentClass;
  confidence: number;
  reason: string;
} {
  const text = `${desc} ${category}`.toLowerCase();
  for (const { cls, words } of CLASS_KEYWORDS) {
    for (const w of words) {
      if (text.includes(w)) {
        // "rent" is last so fee keywords win (e.g. "late fee on rent")
        const confidence = cls === "rent" ? 0.9 : 0.92;
        return {
          cls,
          confidence,
          reason: `Matched keyword "${w}" in "${desc || category}"`,
        };
      }
    }
  }
  return { cls: "unclassified", confidence: 0.3, reason: "No keyword match — needs review" };
}

// ------------------------------- store --------------------------------------

interface Store {
  users: User[];
  session: SessionInfo;
  company: CompanyProfile;
  settings: AppSettings;
  properties: Property[];
  tenants: Tenant[];
  ledgers: Ledger[];
  transactions: LedgerTransaction[];
  mappingPresets: MappingPreset[];
  notices: Notice[];
  statusHistory: StatusHistoryEntry[];
  documents: NoticeDocument[];
  templates: NoticeTemplate[];
  holidays: Holiday[];
  audit: AuditEntry[];
  attachments: Attachment[];
  fieldAssignments: FieldAssignment[];
  mailTracking: MailTracking[];
  stateRules: StateRuleSummary[];
}

const defaultPayment = (): PaymentProfile => ({
  payToName: "",
  paymentAddress: "",
  phone: "",
  acceptedMethods: [],
  inPersonAllowed: false,
  officeHours: "",
  paymentDays: "",
  electronicInstructions: "",
});

function buildSeed(): Store {
  const t = nowIso();
  const admin: User = {
    id: "user-admin",
    name: "Alex Rivera",
    initials: "AR",
    role: "admin",
    pin: null,
    active: true,
    createdAt: t,
  };
  const manager: User = {
    id: "user-manager",
    name: "Morgan Lee",
    initials: "ML",
    role: "manager",
    pin: null,
    active: true,
    createdAt: t,
  };
  const staff: User = {
    id: "user-staff",
    name: "Jamie Chen",
    initials: "JC",
    role: "staff",
    pin: null,
    active: true,
    createdAt: t,
  };
  const readonly: User = {
    id: "user-readonly",
    name: "Pat Torres",
    initials: "PT",
    role: "readonly",
    pin: null,
    active: true,
    createdAt: t,
  };

  const paymentLa: PaymentProfile = {
    payToName: "Golden State Property Management, Inc.",
    paymentAddress: "8383 Wilshire Blvd, Suite 400, Beverly Hills, CA 90211",
    phone: "(310) 555-0182",
    acceptedMethods: ["cashiers_check", "money_order", "online_portal"],
    inPersonAllowed: true,
    officeHours: "Monday–Friday, 9:00 AM – 5:00 PM",
    paymentDays: "Monday through Friday (excluding holidays)",
    electronicInstructions: "Resident portal: portal.gspm-example.com",
  };

  const prop1: Property = {
    id: "prop-1",
    nickname: "Vermont Terrace",
    addressLine1: "1244 S Vermont Avenue",
    addressLine2: "",
    city: "Los Angeles",
    state: "CA",
    zip: "90006",
    county: "Los Angeles",
    units: ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"],
    ownerName: "Vermont Terrace Holdings LLC",
    managementCompany: "Golden State Property Management, Inc.",
    managerContact: "Morgan Lee — (310) 555-0182",
    payment: paymentLa,
    isLosAngelesCity: true,
    notes: "Rent-stabilized building (LARSO).",
    createdAt: t,
    updatedAt: t,
  };

  const prop2: Property = {
    id: "prop-2",
    nickname: "Maple Court",
    addressLine1: "77 Maple Court",
    addressLine2: "",
    city: "Sacramento",
    state: "CA",
    zip: "95814",
    county: "Sacramento",
    units: ["101", "102", "103", "104"],
    ownerName: "R. & C. Whitfield Family Trust",
    managementCompany: "Golden State Property Management, Inc.",
    managerContact: "Jamie Chen — (916) 555-0140",
    payment: {
      ...paymentLa,
      paymentAddress: "1420 J Street, Suite 200, Sacramento, CA 95814",
      phone: "(916) 555-0140",
    },
    isLosAngelesCity: false,
    notes: "",
    createdAt: t,
    updatedAt: t,
  };

  const tenant1: Tenant = {
    id: "tenant-1",
    names: ["Maria Gonzalez", "Luis Gonzalez"],
    propertyId: prop1.id,
    unit: "4B",
    email: "m.gonzalez@example.com",
    phone: "(213) 555-0134",
    monthlyRentCents: 250000,
    leaseStart: "2023-08-01",
    moveOutDate: null,
    notes: "",
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  const tenant2: Tenant = {
    id: "tenant-2",
    names: ["Daniel Kim"],
    propertyId: prop1.id,
    unit: "2A",
    email: "dkim@example.com",
    phone: "(213) 555-0177",
    monthlyRentCents: 218500,
    leaseStart: "2024-02-01",
    moveOutDate: null,
    notes: "",
    archived: false,
    createdAt: t,
    updatedAt: t,
  };
  const tenant3: Tenant = {
    id: "tenant-3",
    names: ["Sarah Okafor"],
    propertyId: prop2.id,
    unit: "103",
    email: "",
    phone: "",
    monthlyRentCents: 189000,
    leaseStart: "2022-11-01",
    moveOutDate: null,
    notes: "",
    archived: false,
    createdAt: t,
    updatedAt: t,
  };

  // Seed ledger for Maria Gonzalez — Apr–Jun 2026 with partials & exclusions
  const ledger1: Ledger = {
    id: "ledger-1",
    tenantId: tenant1.id,
    name: "AppFolio export — Apr–Jun 2026",
    sourceType: "csv",
    sourceFileName: "gonzalez_ledger_apr_jun_2026.csv",
    vendor: "appfolio",
    mappingUsed: null,
    importedAt: t,
    importedBy: staff.id,
    transactionCount: 0,
    periodStart: "2026-04-01",
    periodEnd: "2026-06-30",
    notes: "Seeded example ledger",
  };

  const mkTxn = (
    p: Partial<LedgerTransaction> &
      Pick<LedgerTransaction, "date" | "description" | "amountCents" | "kind" | "systemClass">,
    idx: number,
  ): LedgerTransaction => ({
    id: `txn-${idx}`,
    ledgerId: ledger1.id,
    rowIndex: idx,
    month: p.date.slice(0, 7),
    originalCategory: "",
    memo: "",
    balanceCents: null,
    confidence: 0.95,
    includedInNotice: p.systemClass === "rent",
    classReason:
      p.systemClass === "rent"
        ? 'Matched keyword "rent"'
        : p.kind === "payment"
          ? "Payment row"
          : `Classified as ${p.systemClass}`,
    userOverrideClass: null,
    overrideReason: null,
    overriddenBy: null,
    flagged: false,
    flagReason: null,
    ...p,
  });

  const txns: LedgerTransaction[] = [
    mkTxn({ date: "2026-04-01", description: "Monthly Rent", amountCents: 250000, kind: "rent_charge", systemClass: "rent" }, 1),
    mkTxn({ date: "2026-04-03", description: "Rent Payment — Check #2210", amountCents: -250000, kind: "payment", systemClass: "payment", includedInNotice: false }, 2),
    mkTxn({ date: "2026-05-01", description: "Monthly Rent", amountCents: 250000, kind: "rent_charge", systemClass: "rent" }, 3),
    mkTxn({ date: "2026-05-06", description: "Late Fee", amountCents: 12500, kind: "non_rent_charge", systemClass: "late_fee" }, 4),
    mkTxn({ date: "2026-05-12", description: "Rent Payment — Online Portal", amountCents: -100000, kind: "payment", systemClass: "payment", includedInNotice: false }, 5),
    mkTxn({ date: "2026-05-15", description: "Utility Reimbursement (RUBS)", amountCents: 8500, kind: "non_rent_charge", systemClass: "utility" }, 6),
    mkTxn({ date: "2026-06-01", description: "Monthly Rent", amountCents: 250000, kind: "rent_charge", systemClass: "rent" }, 7),
    mkTxn({ date: "2026-06-05", description: "Late Fee", amountCents: 12500, kind: "non_rent_charge", systemClass: "late_fee" }, 8),
  ];
  ledger1.transactionCount = txns.length;

  const templates: NoticeTemplate[] = [
    {
      id: "tpl-ca-3day-pay",
      name: "CA 3-Day Notice to Pay Rent or Quit (Standard)",
      noticeType: "pay_or_quit_3day",
      jurisdiction: "CA",
      locality: null,
      active: true,
      attorneyReviewed: true,
      reviewedBy: "Templeton & Associates LLP",
      reviewDate: "2026-01-15",
      currentVersion: 2,
      versions: [
        {
          version: 1,
          body: "(initial draft)",
          changedBy: "user-admin",
          changedAt: "2025-12-01T18:00:00.000Z",
          changeNote: "Initial",
        },
        {
          version: 2,
          body: [
            "THREE-DAY NOTICE TO PAY RENT OR QUIT",
            "",
            "TO: {{tenant_names}}, and all others in possession of the premises located at:",
            "{{property_address}}, Unit {{unit}}",
            "",
            "PLEASE TAKE NOTICE that the rent on the above-described premises is delinquent in the total sum of {{total_amount}}, representing rent due for the following period(s):",
            "",
            "{{rent_breakdown}}",
            "",
            "WITHIN THREE (3) DAYS after service on you of this notice (excluding Saturdays, Sundays, and judicial holidays), you are required to pay the above amount in full OR quit and deliver possession of the premises.",
            "",
            "Payment may be made to: {{pay_to_name}}",
            "Address: {{payment_address}}",
            "Telephone: {{payment_phone}}",
            "Accepted methods: {{payment_methods}}",
            "{{office_hours_block}}",
            "",
            "If you fail to pay the amount demanded or deliver possession within the required period, legal proceedings may be instituted against you to recover possession, damages, and costs as permitted by law.",
            "",
            "This notice is given pursuant to California Code of Civil Procedure section 1161(2). Nothing in this notice waives any of the landlord's rights.",
            "",
            "Date prepared: {{prepared_date}}",
            "",
            "____________________________________",
            "{{owner_agent_name}}",
            "Owner / Authorized Agent",
            "{{management_company}}",
          ].join("\n"),
          changedBy: "user-admin",
          changedAt: "2026-01-15T18:00:00.000Z",
          changeNote: "Attorney-reviewed revision",
        },
      ],
      mergeFields: [
        "tenant_names",
        "property_address",
        "unit",
        "total_amount",
        "rent_breakdown",
        "pay_to_name",
        "payment_address",
        "payment_phone",
        "payment_methods",
        "office_hours_block",
        "prepared_date",
        "owner_agent_name",
        "management_company",
      ],
      builtIn: true,
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "tpl-ca-3day-covenant",
      name: "CA 3-Day Notice to Perform Covenant or Quit",
      noticeType: "perform_covenant_3day",
      jurisdiction: "CA",
      locality: null,
      active: true,
      attorneyReviewed: false,
      reviewedBy: "",
      reviewDate: null,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          body: "THREE-DAY NOTICE TO PERFORM COVENANT OR QUIT\n\nTO: {{tenant_names}}\n{{property_address}}, Unit {{unit}}\n\nYou are in violation of the following covenant(s) of your rental agreement:\n\n{{covenant_description}}\n\nWithin THREE (3) days after service of this notice you must cure the violation described above or quit and deliver possession of the premises.\n\nDate prepared: {{prepared_date}}\n\n____________________________________\n{{owner_agent_name}}\n{{management_company}}",
          changedBy: "user-admin",
          changedAt: t,
          changeNote: "Initial draft — requires attorney review",
        },
      ],
      mergeFields: ["tenant_names", "property_address", "unit", "covenant_description", "prepared_date", "owner_agent_name", "management_company"],
      builtIn: true,
      createdAt: t,
      updatedAt: t,
    },
    {
      id: "tpl-ca-30day",
      name: "CA 30-Day Notice of Termination",
      noticeType: "termination_30day",
      jurisdiction: "CA",
      locality: null,
      active: true,
      attorneyReviewed: false,
      reviewedBy: "",
      reviewDate: null,
      currentVersion: 1,
      versions: [
        {
          version: 1,
          body: "THIRTY-DAY NOTICE OF TERMINATION OF TENANCY\n\nTO: {{tenant_names}}\n{{property_address}}, Unit {{unit}}\n\nYour tenancy is terminated effective {{termination_date}}, not less than thirty (30) days after service of this notice.\n\nDate prepared: {{prepared_date}}\n\n____________________________________\n{{owner_agent_name}}\n{{management_company}}",
          changedBy: "user-admin",
          changedAt: t,
          changeNote: "Initial draft — requires attorney review",
        },
      ],
      mergeFields: ["tenant_names", "property_address", "unit", "termination_date", "prepared_date", "owner_agent_name", "management_company"],
      builtIn: true,
      createdAt: t,
      updatedAt: t,
    },
  ];

  const holidays2026: Holiday[] = [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-19", "Martin Luther King Jr. Day"],
    ["2026-02-12", "Lincoln's Birthday"],
    ["2026-02-16", "Presidents' Day"],
    ["2026-03-31", "César Chávez Day"],
    ["2026-05-25", "Memorial Day"],
    ["2026-06-19", "Juneteenth"],
    ["2026-07-03", "Independence Day (observed)"],
    ["2026-09-07", "Labor Day"],
    ["2026-09-25", "Native American Day"],
    ["2026-11-11", "Veterans Day"],
    ["2026-11-26", "Thanksgiving Day"],
    ["2026-11-27", "Day after Thanksgiving"],
    ["2026-12-25", "Christmas Day"],
  ].map(([date, name], i) => ({
    id: `hol-2026-${i}`,
    date,
    name,
    jurisdiction: "CA",
    courtHoliday: true,
    builtIn: true,
  }));

  const stateRules: StateRuleSummary[] = [
    {
      stateCode: "CA",
      stateName: "California",
      payOrQuitDays: 3,
      countingRule: "3 days excluding Saturdays, Sundays, and judicial holidays (CCP §1161(2)).",
      weekendsExcluded: true,
      holidaysExcluded: true,
      templateStatus: "reviewed",
      notes: "Local ordinances (e.g., Los Angeles) may add requirements.",
    },
    {
      stateCode: "TX",
      stateName: "Texas",
      payOrQuitDays: 3,
      countingRule: "3 days' notice to vacate unless lease modifies the period.",
      weekendsExcluded: false,
      holidaysExcluded: false,
      templateStatus: "attorney_review_required",
      notes: "",
    },
    {
      stateCode: "NY",
      stateName: "New York",
      payOrQuitDays: 14,
      countingRule: "14-day written rent demand.",
      weekendsExcluded: false,
      holidaysExcluded: false,
      templateStatus: "attorney_review_required",
      notes: "",
    },
  ];

  const mappingPresets: MappingPreset[] = [
    {
      id: "preset-appfolio",
      name: "AppFolio ledger export",
      vendor: "appfolio",
      mapping: {
        date: "Date",
        description: "Description",
        chargeAmount: "Charge",
        paymentAmount: "Payment",
        creditAmount: null,
        amount: null,
        balance: "Balance",
        transactionType: null,
        category: null,
        memo: "Reference",
        month: null,
        tenantIdentifier: null,
      },
      createdAt: t,
    },
    {
      id: "preset-buildium",
      name: "Buildium ledger export",
      vendor: "buildium",
      mapping: {
        date: "Date",
        description: "Memo",
        chargeAmount: null,
        paymentAmount: null,
        creditAmount: null,
        amount: "Amount",
        balance: "Balance",
        transactionType: "Type",
        category: "Account",
        memo: null,
        month: null,
        tenantIdentifier: null,
      },
      createdAt: t,
    },
  ];

  return {
    users: [admin, manager, staff, readonly],
    session: { user: admin, locked: false },
    company: {
      id: "company-1",
      name: "Golden State Property Management, Inc.",
      address: "8383 Wilshire Blvd, Suite 400, Beverly Hills, CA 90211",
      phone: "(310) 555-0182",
      email: "office@gspm-example.com",
      logoDataUrl: null,
      notes: "",
      createdAt: t,
      updatedAt: t,
    },
    settings: {
      id: "app",
      companyProfileId: "company-1",
      defaultJurisdiction: "CA",
      requireAttorneyReviewedTemplate: true,
      allowAdminTemplateOverride: false,
      pinLockEnabled: false,
      autoLockMinutes: 15,
      aiAssistEnabled: false,
      aiConsentAcknowledged: false,
      syncEnabled: false,
      syncEndpoint: "",
      disclaimerAcknowledgedAt: null,
      onboardingCompleted: true,
      updatedAt: t,
    },
    properties: [prop1, prop2],
    tenants: [tenant1, tenant2, tenant3],
    ledgers: [ledger1],
    transactions: txns,
    mappingPresets,
    notices: [],
    statusHistory: [],
    documents: [],
    templates,
    holidays: holidays2026,
    audit: [],
    attachments: [],
    fieldAssignments: [],
    mailTracking: [],
    stateRules,
  };
}

let store: Store = buildSeed();

// ------------------------------- audit --------------------------------------

function logAudit(
  action: AuditAction,
  entityType: string,
  entityId: Id | null,
  summary: string,
  opts: { previousValue?: string | null; newValue?: string | null; reason?: string | null } = {},
) {
  store.audit.unshift({
    id: uid(),
    timestamp: nowIso(),
    userId: store.session.user?.id ?? null,
    userName: store.session.user?.name ?? "System",
    action,
    entityType,
    entityId,
    summary,
    previousValue: opts.previousValue ?? null,
    newValue: opts.newValue ?? null,
    reason: opts.reason ?? null,
  });
}

// ------------------------------- calculation --------------------------------

function computeCalculation(ledgerId: Id): CalculationResult {
  const txns = store.transactions.filter((x) => x.ledgerId === ledgerId);
  const byMonth = new Map<string, LedgerTransaction[]>();
  for (const txn of txns) {
    const list = byMonth.get(txn.month) ?? [];
    list.push(txn);
    byMonth.set(txn.month, list);
  }
  const months: MonthCalculation[] = [];
  let unapplied = 0;
  const globalWarnings: string[] = [];

  const effClass = (txn: LedgerTransaction): RentClass =>
    txn.userOverrideClass ?? txn.systemClass;

  for (const month of [...byMonth.keys()].sort()) {
    const list = byMonth.get(month)!;
    const { start, end } = monthBounds(month);
    let rentCharged = 0;
    let payments = 0;
    let credits = 0;
    let excluded = 0;
    const excludedItems: MonthCalculation["excludedItems"] = [];
    const warnings: string[] = [];

    for (const txn of list) {
      const cls = effClass(txn);
      if (txn.kind === "payment" || cls === "payment") {
        payments += -txn.amountCents;
      } else if (txn.kind === "credit" || cls === "credit") {
        credits += -txn.amountCents;
      } else if (cls === "rent" && txn.includedInNotice) {
        rentCharged += txn.amountCents;
      } else if (txn.amountCents > 0) {
        excluded += txn.amountCents;
        excludedItems.push({
          description: txn.description,
          amountCents: txn.amountCents,
          class: cls,
        });
      }
      if (txn.flagged) warnings.push(`Flagged: ${txn.description} — ${txn.flagReason ?? "review needed"}`);
      if (cls === "unclassified") warnings.push(`Unclassified transaction: "${txn.description}" — review required`);
      if (cls === "deposit" && txn.amountCents < 0)
        warnings.push("Security deposit activity present — not applied; requires manual authorization and legal review");
    }

    const rentOnly = Math.max(0, rentCharged - payments - credits);
    if (payments > 0 && rentCharged === 0) {
      unapplied += payments;
      warnings.push(`Payment of ${formatCents(payments)} received with no rent charge this month — allocation unclear`);
    }
    if (payments > 0 && payments < rentCharged) {
      warnings.push(`Partial payment: ${formatCents(payments)} of ${formatCents(rentCharged)} rent`);
    }

    months.push({
      month,
      periodStart: start,
      periodEnd: end,
      rentChargedCents: rentCharged,
      paymentsAppliedCents: payments,
      creditsAppliedCents: credits,
      excludedChargesCents: excluded,
      excludedItems,
      rentOnlyBalanceCents: rentOnly,
      carryInCents: 0,
      warnings,
      transactions: list,
    });
  }

  if (unapplied > 0)
    globalWarnings.push(`Ledger contains ${formatCents(unapplied)} in payments not clearly applied to a rent month`);

  return {
    ledgerId,
    months,
    totalRentOnlyCents: months.reduce((s, m) => s + m.rentOnlyBalanceCents, 0),
    totalExcludedCents: months.reduce((s, m) => s + m.excludedChargesCents, 0),
    unappliedPaymentsCents: unapplied,
    globalWarnings,
    computedAt: nowIso(),
  };
}

// ------------------------------- deadlines ----------------------------------

function isCourtHoliday(dateIso: string): { holiday: boolean; name?: string } {
  const h = store.holidays.find((x) => x.date === dateIso && x.courtHoliday);
  return h ? { holiday: true, name: h.name } : { holiday: false };
}

function computeDeadlineInternal(
  serviceDate: string,
  noticeType: NoticeType,
  jurisdiction: string,
): DeadlineResult {
  const excludeNonCourtDays =
    noticeType === "pay_or_quit_3day" || noticeType === "perform_covenant_3day";
  const countedDays =
    noticeType === "pay_or_quit_3day" || noticeType === "perform_covenant_3day"
      ? 3
      : noticeType === "entry_24hr"
        ? 1
        : noticeType === "termination_30day" || noticeType === "rent_increase"
          ? 30
          : 60;

  const excludedDates: DeadlineResult["excludedDates"] = [];
  const explanation: string[] = [
    `Service date: ${serviceDate} (day 0 — not counted).`,
  ];
  let cursor = serviceDate;
  let counted = 0;
  while (counted < countedDays) {
    cursor = addDays(cursor, 1);
    if (excludeNonCourtDays) {
      if (isWeekend(cursor)) {
        excludedDates.push({ date: cursor, reason: "weekend" });
        explanation.push(`${cursor}: weekend — not counted.`);
        continue;
      }
      const h = isCourtHoliday(cursor);
      if (h.holiday) {
        excludedDates.push({ date: cursor, reason: "holiday", name: h.name });
        explanation.push(`${cursor}: judicial holiday (${h.name}) — not counted.`);
        continue;
      }
    }
    counted += 1;
    explanation.push(`${cursor}: day ${counted} of ${countedDays}.`);
  }
  explanation.push(`Estimated expiration: end of day ${cursor}.`);

  return {
    serviceDate,
    noticeType,
    jurisdiction,
    countedDays,
    excludedDates,
    expirationDate: cursor,
    explanation,
    disclaimer:
      "This calculator is informational only and is not legal advice. Deadlines must be confirmed by a qualified attorney.",
  };
}

// ------------------------------- validation ---------------------------------

function validateNoticeInternal(notice: Notice): ValidationResult {
  const issues: ValidationIssue[] = [];
  const add = (
    code: string,
    level: ValidationIssue["level"],
    message: string,
    field: string | null = null,
  ) => issues.push({ code, level, message, field, acknowledgeable: level === "warning" });

  const tenant = store.tenants.find((x) => x.id === notice.tenantId);
  const property = store.properties.find((x) => x.id === notice.propertyId);

  if (!notice.tenantNames.length || notice.tenantNames.every((n) => !n.trim()))
    add("tenant_name_missing", "blocker", "Tenant name is missing.", "tenantNames");
  if (!notice.propertyAddress.trim())
    add("property_address_missing", "blocker", "Property address is missing.", "propertyAddress");
  if (!notice.unit.trim())
    add("unit_missing", "warning", "Unit number is missing.", "unit");
  if (property && !property.ownerName.trim())
    add("owner_missing", "blocker", "Owner/landlord name is missing on the property.", "ownerName");
  if (!notice.payment.payToName.trim())
    add("payment_recipient_missing", "blocker", "Authorized payment recipient is missing.", "payment.payToName");
  if (!notice.payment.paymentAddress.trim())
    add("payment_address_missing", "blocker", "Payment address is missing.", "payment.paymentAddress");
  if (notice.noticeType === "pay_or_quit_3day" && notice.payment.acceptedMethods.length === 0)
    add("payment_methods_missing", "blocker", "Accepted payment methods are missing.", "payment.acceptedMethods");
  if (notice.payment.inPersonAllowed && !notice.payment.officeHours.trim())
    add("office_hours_missing", "blocker", "Office hours are required when in-person payment is allowed.", "payment.officeHours");
  if (notice.payment.inPersonAllowed && !notice.payment.paymentDays.trim())
    add("payment_days_missing", "blocker", "Payment days are required when in-person payment is allowed.", "payment.paymentDays");

  for (const m of notice.months) {
    const { start, end } = monthBounds(m.month);
    if (m.periodStart !== start)
      add("period_not_first", "blocker", `Rent period for ${m.month} does not begin on the 1st.`, "months");
    if (m.periodEnd !== end)
      add("period_not_last", "blocker", `Rent period for ${m.month} does not end on the last day of the month.`, "months");
    if (m.selectedAmountCents !== m.rentOnlyBalanceCents && !m.overrideReason)
      add("amount_overridden_no_reason", "blocker", `Amount for ${m.month} was changed from the calculated balance without a reason.`, "months");
    if (m.selectedAmountCents !== m.rentOnlyBalanceCents && m.overrideReason)
      add("amount_overridden", "warning", `Amount for ${m.month} was manually overridden (${formatCents(m.rentOnlyBalanceCents)} → ${formatCents(m.selectedAmountCents)}).`, "months");
  }

  if (notice.ledgerId) {
    const calc = computeCalculation(notice.ledgerId);
    if (calc.unappliedPaymentsCents > 0)
      add("unapplied_payments", "warning", `Ledger contains ${formatCents(calc.unappliedPaymentsCents)} in payments not clearly applied.`, null);
    const txns = store.transactions.filter((x) => x.ledgerId === notice.ledgerId);
    const nonRentIncluded = txns.some(
      (x) => x.includedInNotice && (x.userOverrideClass ?? x.systemClass) !== "rent",
    );
    if (nonRentIncluded)
      add("non_rent_included", "blocker", "The notice amount includes charges classified as non-rent.", null);
    const depositApplied = txns.some(
      (x) => (x.userOverrideClass ?? x.systemClass) === "deposit" && x.includedInNotice,
    );
    if (depositApplied)
      add("deposit_applied", "warning", "A security deposit is being applied — requires legal review.", null);
  }

  if (tenant && tenant.names.length > 1 && notice.tenantNames.length < tenant.names.length)
    add("tenant_names_partial", "warning", "Multiple tenants are on file but not all names are on the notice.", "tenantNames");

  const dup = store.notices.filter(
    (n) =>
      n.id !== notice.id &&
      n.revisedFromId !== notice.id &&
      notice.revisedFromId !== n.id &&
      n.tenantId === notice.tenantId &&
      n.unit === notice.unit &&
      n.noticeType === notice.noticeType &&
      !["cancelled", "revised"].includes(n.status) &&
      n.months.some((m) => notice.months.some((mm) => mm.month === m.month)),
  );
  if (dup.length > 0)
    add("duplicate_notice", "warning", `A notice already exists for this tenant/unit covering the same rent month (${dup.length} found).`, null);

  const tpl = notice.templateId ? store.templates.find((x) => x.id === notice.templateId) : null;
  if (store.settings.requireAttorneyReviewedTemplate) {
    if (!tpl)
      add("template_missing", "blocker", "No template selected for this notice.", "templateId");
    else if (!tpl.attorneyReviewed) {
      if (store.settings.allowAdminTemplateOverride && store.session.user?.role === "admin")
        add("template_not_reviewed", "warning", "Selected template has not been marked attorney-reviewed (admin override enabled).", "templateId");
      else
        add("template_not_reviewed", "blocker", "Selected template has not been marked attorney-reviewed.", "templateId");
    }
  }

  if (notice.noticeType === "pay_or_quit_3day" && notice.totalAmountCents <= 0)
    add("zero_amount", "blocker", "Total demanded amount must be greater than zero.", "months");

  const blockers = issues.filter((i) => i.level === "blocker").length;
  const warnings = issues.filter((i) => i.level === "warning").length;
  return { noticeId: notice.id, issues, blockers, warnings, passed: blockers === 0 };
}

// ------------------------------- documents ----------------------------------

async function makePdf(
  title: string,
  lines: string[],
  opts: { watermark?: string } = {},
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let page = doc.addPage([612, 792]);
  const margin = 60;
  let y = 792 - margin;
  page.drawText(title, { x: margin, y, size: 14, font: bold, color: rgb(0.1, 0.1, 0.12) });
  y -= 28;
  for (const line of lines) {
    if (y < margin) {
      page = doc.addPage([612, 792]);
      y = 792 - margin;
    }
    const chunks = line.match(/.{1,90}(\s|$)|.{1,90}/g) ?? [""];
    for (const chunk of chunks) {
      page.drawText(chunk.trimEnd(), { x: margin, y, size: 10.5, font, color: rgb(0.15, 0.15, 0.18) });
      y -= 15;
    }
  }
  if (opts.watermark) {
    for (const p of doc.getPages()) {
      p.drawText(opts.watermark, {
        x: 130,
        y: 300,
        size: 72,
        font: bold,
        color: rgb(0.85, 0.2, 0.2),
        opacity: 0.15,
        rotate: degrees(45),
      });
    }
  }
  const bytes = await doc.save();
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return new Blob([buf], { type: "application/pdf" });
}

function renderTemplate(body: string, fields: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => fields[key] ?? `[${key}]`);
}

function noticeMergeFields(notice: Notice): Record<string, string> {
  const property = store.properties.find((x) => x.id === notice.propertyId);
  const breakdown = notice.months
    .map(
      (m) =>
        `${m.periodStart} through ${m.periodEnd}: ${formatCents(m.selectedAmountCents)}`,
    )
    .join("\n");
  return {
    tenant_names: notice.tenantNames.join(", "),
    property_address: notice.propertyAddress,
    unit: notice.unit,
    total_amount: formatCents(notice.totalAmountCents),
    rent_breakdown: breakdown,
    pay_to_name: notice.payment.payToName,
    payment_address: notice.payment.paymentAddress,
    payment_phone: notice.payment.phone,
    payment_methods: notice.payment.acceptedMethods.join(", "),
    office_hours_block: notice.payment.inPersonAllowed
      ? `In-person payment accepted: ${notice.payment.officeHours} (${notice.payment.paymentDays})`
      : "In-person payment is not accepted.",
    prepared_date: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
    owner_agent_name: property?.ownerName ?? "",
    management_company: property?.managementCompany ?? "",
    covenant_description: notice.covenantDescription,
    termination_date: notice.terminationDate ?? "",
  };
}

// ------------------------------- CSV parsing --------------------------------

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cur.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      cur.push(field);
      field = "";
      if (cur.some((x) => x.trim() !== "")) lines.push(cur);
      cur = [];
    } else field += c;
  }
  if (field !== "" || cur.length) {
    cur.push(field);
    if (cur.some((x) => x.trim() !== "")) lines.push(cur);
  }
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map((h) => h.trim());
  const rows = lines.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = (cells[idx] ?? "").trim();
    });
    return row;
  });
  return { headers, rows };
}

function suggestMapping(headers: string[]): ColumnMapping {
  const find = (...cands: string[]): string | null => {
    for (const h of headers) {
      const l = h.toLowerCase();
      if (cands.some((c) => l.includes(c))) return h;
    }
    return null;
  };
  return {
    date: find("date"),
    description: find("description", "memo", "detail"),
    chargeAmount: find("charge", "debit"),
    paymentAmount: find("payment", "paid"),
    creditAmount: find("credit"),
    amount: find("amount"),
    balance: find("balance"),
    transactionType: find("type"),
    category: find("category", "account", "gl "),
    memo: find("reference", "ref", "notes"),
    month: find("month", "period"),
    tenantIdentifier: find("tenant", "resident", "unit id"),
  };
}

function detectVendor(headers: string[]): PmVendor {
  const joined = headers.join("|").toLowerCase();
  if (joined.includes("gl account") || joined.includes("appfolio")) return "appfolio";
  if (joined.includes("account") && joined.includes("memo")) return "buildium";
  if (joined.includes("chg code") || joined.includes("yardi")) return "yardi";
  return "generic";
}

// ------------------------------- notices ------------------------------------

function statusChange(notice: Notice, toStatus: NoticeStatus, reason?: string) {
  store.statusHistory.unshift({
    id: uid(),
    noticeId: notice.id,
    fromStatus: notice.status,
    toStatus,
    changedBy: store.session.user?.id ?? null,
    changedAt: nowIso(),
    reason: reason ?? "",
  });
  logAudit("status_changed", "notice", notice.id, `Status changed: ${notice.status} → ${toStatus}`, {
    previousValue: notice.status,
    newValue: toStatus,
    reason: reason ?? null,
  });
  notice.status = toStatus;
  notice.updatedAt = nowIso();
}

// ------------------------------- services -----------------------------------

function createStubServices(): AppServices {
  return {
    // --- session & users ---
    async getSession() {
      return { ...store.session };
    },
    async listUsers() {
      return [...store.users];
    },
    async selectUser(userId, pin) {
      const user = store.users.find((x) => x.id === userId && x.active);
      if (!user) throw new Error("User not found");
      if (user.pin && user.pin !== pin) throw new Error("Incorrect PIN");
      store.session = { user, locked: false };
      logAudit("login", "user", user.id, `${user.name} signed in`);
      return { ...store.session };
    },
    async lockApp() {
      store.session = { ...store.session, locked: true };
      return { ...store.session };
    },
    async createUser(input: CreateUserInput) {
      const user: User = {
        id: uid(),
        name: input.name,
        initials: input.name
          .split(/\s+/)
          .map((p) => p[0] ?? "")
          .join("")
          .slice(0, 2)
          .toUpperCase(),
        role: input.role,
        pin: input.pin ?? null,
        active: true,
        createdAt: nowIso(),
      };
      store.users.push(user);
      logAudit("user_created", "user", user.id, `Created user ${user.name} (${user.role})`);
      return user;
    },
    async updateUser(id, patch) {
      const user = store.users.find((x) => x.id === id);
      if (!user) throw new Error("User not found");
      Object.assign(user, patch);
      logAudit("user_updated", "user", id, `Updated user ${user.name}`);
      return { ...user };
    },

    // --- company & settings ---
    async getCompanyProfile() {
      return { ...store.company };
    },
    async updateCompanyProfile(patch) {
      Object.assign(store.company, patch, { updatedAt: nowIso() });
      logAudit("settings_changed", "company", store.company.id, "Updated company profile");
      return { ...store.company };
    },
    async getSettings() {
      return { ...store.settings };
    },
    async updateSettings(patch) {
      Object.assign(store.settings, patch, { updatedAt: nowIso() });
      logAudit("settings_changed", "settings", "app", "Updated application settings");
      return { ...store.settings };
    },

    // --- properties ---
    async listProperties(search) {
      const q = (search ?? "").toLowerCase();
      return store.properties
        .filter(
          (p) =>
            !q ||
            p.nickname.toLowerCase().includes(q) ||
            p.addressLine1.toLowerCase().includes(q) ||
            p.city.toLowerCase().includes(q) ||
            p.ownerName.toLowerCase().includes(q),
        )
        .map((p) => ({ ...p }));
    },
    async getProperty(id) {
      const p = store.properties.find((x) => x.id === id);
      return p ? { ...p } : null;
    },
    async createProperty(input: CreatePropertyInput) {
      const t = nowIso();
      const property: Property = {
        id: uid(),
        nickname: input.nickname,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2 ?? "",
        city: input.city,
        state: input.state,
        zip: input.zip,
        county: input.county ?? "",
        units: input.units ?? [],
        ownerName: input.ownerName,
        managementCompany: input.managementCompany ?? store.company.name,
        managerContact: input.managerContact ?? "",
        payment: { ...defaultPayment(), ...(input.payment ?? {}) },
        isLosAngelesCity: input.isLosAngelesCity ?? false,
        notes: input.notes ?? "",
        createdAt: t,
        updatedAt: t,
      };
      store.properties.push(property);
      logAudit("property_created", "property", property.id, `Created property ${property.nickname}`);
      return { ...property };
    },
    async updateProperty(id, patch) {
      const p = store.properties.find((x) => x.id === id);
      if (!p) throw new Error("Property not found");
      Object.assign(p, patch, { updatedAt: nowIso() });
      logAudit("property_updated", "property", id, `Updated property ${p.nickname}`);
      return { ...p };
    },
    async deleteProperty(id) {
      const p = store.properties.find((x) => x.id === id);
      store.properties = store.properties.filter((x) => x.id !== id);
      logAudit("property_deleted", "property", id, `Deleted property ${p?.nickname ?? id}`);
    },

    // --- tenants ---
    async listTenants(search, propertyId) {
      const q = (search ?? "").toLowerCase();
      return store.tenants
        .filter((tn) => (!propertyId || tn.propertyId === propertyId))
        .filter(
          (tn) =>
            !q ||
            tn.names.some((n) => n.toLowerCase().includes(q)) ||
            tn.unit.toLowerCase().includes(q),
        )
        .map((tn) => ({ ...tn }));
    },
    async getTenant(id) {
      const tn = store.tenants.find((x) => x.id === id);
      return tn ? { ...tn } : null;
    },
    async createTenant(input: CreateTenantInput) {
      const t = nowIso();
      const tenant: Tenant = {
        id: uid(),
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
      store.tenants.push(tenant);
      logAudit("tenant_created", "tenant", tenant.id, `Created tenant ${tenant.names.join(", ")}`);
      return { ...tenant };
    },
    async updateTenant(id, patch) {
      const tn = store.tenants.find((x) => x.id === id);
      if (!tn) throw new Error("Tenant not found");
      Object.assign(tn, patch, { updatedAt: nowIso() });
      logAudit("tenant_updated", "tenant", id, `Updated tenant ${tn.names.join(", ")}`);
      return { ...tn };
    },
    async deleteTenant(id) {
      const tn = store.tenants.find((x) => x.id === id);
      store.tenants = store.tenants.filter((x) => x.id !== id);
      logAudit("tenant_deleted", "tenant", id, `Deleted tenant ${tn?.names.join(", ") ?? id}`);
    },

    // --- ledgers & import ---
    async listLedgers(tenantId) {
      return store.ledgers
        .filter((l) => !tenantId || l.tenantId === tenantId)
        .map((l) => ({ ...l }));
    },
    async getLedger(id): Promise<LedgerDetail | null> {
      const ledger = store.ledgers.find((x) => x.id === id);
      if (!ledger) return null;
      return {
        ledger: { ...ledger },
        transactions: store.transactions
          .filter((x) => x.ledgerId === id)
          .map((x) => ({ ...x })),
      };
    },
    async parseLedgerFile(file): Promise<ParsedLedgerFile> {
      const name = file.name.toLowerCase();
      if (name.endsWith(".csv") || name.endsWith(".txt")) {
        const text = await file.text();
        const { headers, rows } = parseCsv(text);
        return {
          sourceType: "csv",
          fileName: file.name,
          headers,
          rows,
          detectedVendor: detectVendor(headers),
          suggestedMapping: suggestMapping(headers),
          warnings: rows.length === 0 ? ["No data rows detected in file."] : [],
          ocrUsed: false,
        };
      }
      throw new Error(
        "Excel and PDF parsing engines are still being installed in this preview build. Please use a CSV export for now.",
      );
    },
    async importLedger(input: ImportLedgerInput) {
      const t = nowIso();
      const ledger: Ledger = {
        id: uid(),
        tenantId: input.tenantId,
        name: input.name,
        sourceType: input.sourceType,
        sourceFileName: input.fileName,
        vendor: input.vendor,
        mappingUsed: input.mapping,
        importedAt: t,
        importedBy: store.session.user?.id ?? null,
        transactionCount: 0,
        periodStart: null,
        periodEnd: null,
        notes: "",
      };
      const txns: LedgerTransaction[] = [];
      const m = input.mapping;

      const pushTxn = (
        date: string,
        description: string,
        category: string,
        memo: string,
        amountCents: number,
        rowIndex: number,
        balance: number | null,
      ) => {
        const isPayment = amountCents < 0;
        const { cls, confidence, reason } = isPayment
          ? { cls: "payment" as RentClass, confidence: 0.95, reason: "Negative amount — payment/credit" }
          : classifyDescription(description, category);
        const flagged = !isPayment && cls === "unclassified";
        txns.push({
          id: uid(),
          ledgerId: ledger.id,
          rowIndex,
          date,
          month: date.slice(0, 7),
          description,
          originalCategory: category,
          memo,
          kind: isPayment ? "payment" : cls === "rent" ? "rent_charge" : "non_rent_charge",
          amountCents,
          balanceCents: balance,
          systemClass: cls,
          confidence,
          includedInNotice: cls === "rent",
          classReason: reason,
          userOverrideClass: null,
          overrideReason: null,
          overriddenBy: null,
          flagged,
          flagReason: flagged ? "Could not classify from description" : null,
        });
      };

      if (input.manualTransactions?.length) {
        input.manualTransactions.forEach((mt, i) =>
          pushTxn(mt.date, mt.description, mt.category, mt.memo ?? "", mt.amountCents, i + 1, null),
        );
      } else if (m) {
        input.rows.forEach((row, i) => {
          const dateRaw = m.date ? row[m.date] : "";
          const date = parseDateFlexible(dateRaw ?? "");
          if (!date) return;
          const description = (m.description ? row[m.description] : "") ?? "";
          const category = (m.category ? row[m.category] : "") ?? "";
          const memo = (m.memo ? row[m.memo] : "") ?? "";
          const balance = m.balance ? parseAmountToCents(row[m.balance] ?? "") : null;
          const charge = m.chargeAmount ? parseAmountToCents(row[m.chargeAmount] ?? "") : null;
          const payment = m.paymentAmount ? parseAmountToCents(row[m.paymentAmount] ?? "") : null;
          const credit = m.creditAmount ? parseAmountToCents(row[m.creditAmount] ?? "") : null;
          const single = m.amount ? parseAmountToCents(row[m.amount] ?? "") : null;
          if (charge && charge !== 0) pushTxn(date, description, category, memo, Math.abs(charge), i + 1, balance);
          if (payment && payment !== 0) pushTxn(date, description || "Payment", category, memo, -Math.abs(payment), i + 1, balance);
          if (credit && credit !== 0) pushTxn(date, description || "Credit", category, memo, -Math.abs(credit), i + 1, balance);
          if (!charge && !payment && !credit && single != null && single !== 0) {
            const type = (m.transactionType ? row[m.transactionType] : "")?.toLowerCase() ?? "";
            const negative = type.includes("payment") || type.includes("credit") ? -Math.abs(single) : single;
            pushTxn(date, description, category, memo, negative, i + 1, balance);
          }
        });
      }

      ledger.transactionCount = txns.length;
      const dates = txns.map((x) => x.date).sort();
      ledger.periodStart = dates[0] ?? null;
      ledger.periodEnd = dates[dates.length - 1] ?? null;
      store.ledgers.unshift(ledger);
      store.transactions.push(...txns);

      if (input.savePresetName && input.mapping) {
        store.mappingPresets.push({
          id: uid(),
          name: input.savePresetName,
          vendor: input.vendor,
          mapping: input.mapping,
          createdAt: t,
        });
      }
      logAudit("ledger_imported", "ledger", ledger.id, `Imported ledger "${ledger.name}" (${txns.length} transactions)`);
      return { ...ledger };
    },
    async deleteLedger(id) {
      store.ledgers = store.ledgers.filter((x) => x.id !== id);
      store.transactions = store.transactions.filter((x) => x.ledgerId !== id);
      logAudit("ledger_deleted", "ledger", id, "Deleted ledger");
    },
    async overrideClassification(input: ClassificationOverrideInput) {
      const txn = store.transactions.find((x) => x.id === input.transactionId);
      if (!txn) throw new Error("Transaction not found");
      if (!input.reason.trim()) throw new Error("A reason is required for manual overrides");
      const prev = `${txn.userOverrideClass ?? txn.systemClass}/${txn.includedInNotice ? "included" : "excluded"}`;
      txn.userOverrideClass = input.overrideClass;
      txn.includedInNotice = input.includedInNotice;
      txn.overrideReason = input.reason;
      txn.overriddenBy = store.session.user?.id ?? null;
      txn.flagged = false;
      const next = `${txn.userOverrideClass ?? txn.systemClass}/${txn.includedInNotice ? "included" : "excluded"}`;
      logAudit("manual_override", "transaction", txn.id, `Reclassified "${txn.description}"`, {
        previousValue: prev,
        newValue: next,
        reason: input.reason,
      });
      return { ...txn };
    },
    async listMappingPresets() {
      return [...store.mappingPresets];
    },
    async saveMappingPreset(preset) {
      const p: MappingPreset = { ...preset, id: uid(), createdAt: nowIso() };
      store.mappingPresets.push(p);
      return { ...p };
    },
    async deleteMappingPreset(id) {
      store.mappingPresets = store.mappingPresets.filter((x) => x.id !== id);
    },

    // --- calculation ---
    async calculateLedger(ledgerId) {
      return computeCalculation(ledgerId);
    },

    // --- notices ---
    async listNotices(filters) {
      let list = store.notices.map((n) => ({ ...n }));
      if (filters) {
        const f = filters;
        if (f.search) {
          const q = f.search.toLowerCase();
          list = list.filter(
            (n) =>
              n.tenantNames.some((x) => x.toLowerCase().includes(q)) ||
              n.propertyAddress.toLowerCase().includes(q) ||
              n.unit.toLowerCase().includes(q),
          );
        }
        if (f.status && f.status !== "all") list = list.filter((n) => n.status === f.status);
        if (f.noticeType && f.noticeType !== "all") list = list.filter((n) => n.noticeType === f.noticeType);
        if (f.propertyId && f.propertyId !== "all") list = list.filter((n) => n.propertyId === f.propertyId);
        if (f.tenantId) list = list.filter((n) => n.tenantId === f.tenantId);
        if (f.month) list = list.filter((n) => n.months.some((m) => m.month === f.month));
        if (f.createdFrom) list = list.filter((n) => n.createdAt >= f.createdFrom!);
        if (f.createdTo) list = list.filter((n) => n.createdAt <= `${f.createdTo}T23:59:59`);
        if (f.servedFrom) list = list.filter((n) => (n.service.dateServed ?? "") >= f.servedFrom!);
        if (f.servedTo) list = list.filter((n) => (n.service.dateServed ?? "9999") <= f.servedTo!);
        if (f.amountMinCents != null) list = list.filter((n) => n.totalAmountCents >= f.amountMinCents!);
        if (f.amountMaxCents != null) list = list.filter((n) => n.totalAmountCents <= f.amountMaxCents!);
        if (f.preparedBy && f.preparedBy !== "all") list = list.filter((n) => n.preparedBy === f.preparedBy);
      }
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async getNotice(id) {
      const n = store.notices.find((x) => x.id === id);
      return n ? { ...n } : null;
    },
    async checkDuplicateNotice(params): Promise<DuplicateCheckResult> {
      const existing = store.notices.filter(
        (n) =>
          n.tenantId === params.tenantId &&
          n.propertyId === params.propertyId &&
          n.unit === params.unit &&
          n.noticeType === params.noticeType &&
          !["cancelled", "revised"].includes(n.status) &&
          n.months.some((m) => params.months.includes(m.month)),
      );
      return { duplicate: existing.length > 0, existing: existing.map((n) => ({ ...n })) };
    },
    async createNotice(input: NoticeInput) {
      const tenant = store.tenants.find((x) => x.id === input.tenantId);
      const property = store.properties.find((x) => x.id === input.propertyId);
      if (!tenant || !property) throw new Error("Tenant and property are required");
      const t = nowIso();
      const address = [
        property.addressLine1,
        property.addressLine2,
        `${property.city}, ${property.state} ${property.zip}`,
      ]
        .filter(Boolean)
        .join(", ");
      const notice: Notice = {
        id: uid(),
        noticeType: input.noticeType,
        jurisdiction: input.jurisdiction,
        status: "draft",
        tenantId: input.tenantId,
        propertyId: input.propertyId,
        unit: input.unit,
        tenantNames: [...tenant.names],
        propertyAddress: address,
        ledgerId: input.ledgerId,
        months: input.months,
        totalAmountCents: input.months.reduce((s, m) => s + m.selectedAmountCents, 0),
        payment: input.payment,
        templateId: input.templateId,
        templateVersion:
          store.templates.find((x) => x.id === input.templateId)?.currentVersion ?? null,
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
        attorneyExportFlag: false,
        service: {
          dateServed: null,
          timeServed: null,
          method: null,
          servedBy: "",
          serverNotes: "",
          mailedDate: null,
        },
        deadlineDate: null,
        internalNotes: input.internalNotes ?? "",
        preparedBy: store.session.user?.id ?? null,
        createdAt: t,
        updatedAt: t,
      };
      store.notices.unshift(notice);
      store.statusHistory.unshift({
        id: uid(),
        noticeId: notice.id,
        fromStatus: null,
        toStatus: "draft",
        changedBy: store.session.user?.id ?? null,
        changedAt: t,
        reason: input.duplicateOverrideReason ?? "",
      });
      logAudit("notice_created", "notice", notice.id, `Created ${NOTICE_TYPE_LABELS[notice.noticeType]} draft for ${notice.tenantNames.join(", ")}`, {
        reason: input.duplicateOverrideReason ?? null,
      });
      return { ...notice };
    },
    async updateNotice(id, patch) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) throw new Error("Notice not found");
      if (["finalized", "served", "mailed", "expired", "paid", "sent_to_attorney"].includes(n.status))
        throw new Error("Finalized notices cannot be edited. Create a revised version instead.");
      if (patch.months) {
        n.months = patch.months;
        n.totalAmountCents = patch.months.reduce((s, m) => s + m.selectedAmountCents, 0);
      }
      if (patch.payment) n.payment = patch.payment;
      if (patch.templateId !== undefined) {
        n.templateId = patch.templateId;
        n.templateVersion =
          store.templates.find((x) => x.id === patch.templateId)?.currentVersion ?? null;
      }
      if (patch.includeLahdLetter !== undefined) n.includeLahdLetter = patch.includeLahdLetter;
      if (patch.unit !== undefined) n.unit = patch.unit;
      if (patch.covenantDescription !== undefined) n.covenantDescription = patch.covenantDescription;
      if (patch.terminationDate !== undefined) n.terminationDate = patch.terminationDate ?? null;
      if (patch.entryDate !== undefined) n.entryDate = patch.entryDate ?? null;
      if (patch.entryTimeWindow !== undefined) n.entryTimeWindow = patch.entryTimeWindow;
      if (patch.entryReason !== undefined) n.entryReason = patch.entryReason;
      if (patch.rentIncreaseNewAmountCents !== undefined)
        n.rentIncreaseNewAmountCents = patch.rentIncreaseNewAmountCents ?? null;
      if (patch.rentIncreaseEffectiveDate !== undefined)
        n.rentIncreaseEffectiveDate = patch.rentIncreaseEffectiveDate ?? null;
      if (patch.internalNotes !== undefined) n.internalNotes = patch.internalNotes;
      n.updatedAt = nowIso();
      logAudit("notice_updated", "notice", id, "Updated notice draft");
      return { ...n };
    },
    async deleteNotice(id, reason) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) return;
      if (n.status !== "draft" && n.status !== "needs_review")
        throw new Error("Only drafts can be deleted");
      store.notices = store.notices.filter((x) => x.id !== id);
      logAudit("draft_deleted", "notice", id, `Deleted draft for ${n.tenantNames.join(", ")}`, { reason });
    },
    async validateNotice(id) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) throw new Error("Notice not found");
      return validateNoticeInternal(n);
    },
    async changeNoticeStatus(id, toStatus, reason) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) throw new Error("Notice not found");
      statusChange(n, toStatus, reason);
      if (toStatus === "sent_to_attorney") n.attorneyExportFlag = true;
      return { ...n };
    },
    async approveNotice(id) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) throw new Error("Notice not found");
      n.reviewerApprovedBy = store.session.user?.id ?? null;
      n.reviewerApprovedAt = nowIso();
      statusChange(n, "reviewed", "Reviewer approval");
      return { ...n };
    },
    async finalizeNotice(id, acknowledgedWarnings) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) throw new Error("Notice not found");
      const validation = validateNoticeInternal(n);
      if (!validation.passed)
        throw new Error(
          `Cannot finalize: ${validation.blockers} blocking issue(s) must be fixed first.`,
        );
      const unacked = validation.issues.filter(
        (i) => i.level === "warning" && !acknowledgedWarnings.some((a) => a.code === i.code),
      );
      if (unacked.length > 0)
        throw new Error(
          `All warnings must be acknowledged with a reason before finalizing (${unacked.length} remaining).`,
        );
      for (const ack of acknowledgedWarnings) {
        logAudit("warning_acknowledged", "notice", id, `Acknowledged warning ${ack.code}`, {
          reason: ack.reason,
        });
      }
      n.finalizedBy = store.session.user?.id ?? null;
      n.finalizedAt = nowIso();
      statusChange(n, "finalized", "Notice finalized and locked");
      logAudit("notice_finalized", "notice", id, `Finalized notice v${n.version} for ${n.tenantNames.join(", ")}`);
      return { ...n };
    },
    async reviseNotice(id, reason) {
      const orig = store.notices.find((x) => x.id === id);
      if (!orig) throw new Error("Notice not found");
      const t = nowIso();
      const copy: Notice = {
        ...JSON.parse(JSON.stringify(orig)),
        id: uid(),
        status: "draft",
        version: orig.version + 1,
        revisedFromId: orig.id,
        reviewerApprovedBy: null,
        reviewerApprovedAt: null,
        finalizedBy: null,
        finalizedAt: null,
        service: {
          dateServed: null,
          timeServed: null,
          method: null,
          servedBy: "",
          serverNotes: "",
          mailedDate: null,
        },
        deadlineDate: null,
        createdAt: t,
        updatedAt: t,
      };
      store.notices.unshift(copy);
      statusChange(orig, "revised", reason);
      logAudit("notice_revised", "notice", copy.id, `Created revision v${copy.version} of notice for ${copy.tenantNames.join(", ")}`, { reason });
      return { ...copy };
    },
    async recordService(id, service: ServiceRecord) {
      const n = store.notices.find((x) => x.id === id);
      if (!n) throw new Error("Notice not found");
      n.service = service;
      if (service.dateServed) {
        const deadline = computeDeadlineInternal(service.dateServed, n.noticeType, n.jurisdiction);
        n.deadlineDate = deadline.expirationDate;
        statusChange(n, service.method === "post_and_mail" && service.mailedDate ? "mailed" : "served", "Service recorded");
      }
      n.updatedAt = nowIso();
      return { ...n };
    },

    // --- documents ---
    async generateDocuments(input: GenerateDocumentsInput) {
      const n = store.notices.find((x) => x.id === input.noticeId);
      if (!n) throw new Error("Notice not found");
      const isDraft = input.packetKind === "draft";
      const watermark = isDraft ? "DRAFT" : undefined;
      const tpl = n.templateId ? store.templates.find((x) => x.id === n.templateId) : null;
      const body = tpl
        ? renderTemplate(tpl.versions[tpl.versions.length - 1].body, noticeMergeFields(n))
        : `No template selected.\n\n${NOTICE_TYPE_LABELS[n.noticeType]} for ${n.tenantNames.join(", ")}`;

      const docs: NoticeDocument[] = [];
      const push = async (kind: NoticeDocument["kind"], fileName: string, title: string, lines: string[]) => {
        const blob = await makePdf(title, [...lines, "", "—", LEGAL_DISCLAIMER], { watermark });
        docs.push({
          id: uid(),
          noticeId: n.id,
          kind,
          packetKind: input.packetKind,
          fileName,
          watermarked: isDraft,
          locked: !isDraft,
          pageCount: 1,
          sizeBytes: blob.size,
          generatedAt: nowIso(),
          generatedBy: store.session.user?.id ?? null,
          blobUrl: URL.createObjectURL(blob),
        });
      };

      await push("notice", `${isDraft ? "DRAFT_" : ""}notice_${n.id.slice(0, 8)}.pdf`, NOTICE_TYPE_LABELS[n.noticeType], body.split("\n"));
      await push("proof_of_service", `proof_of_service_${n.id.slice(0, 8)}.pdf`, "PROOF OF SERVICE", [
        `Tenant(s): ${n.tenantNames.join(", ")}`,
        `Premises: ${n.propertyAddress}, Unit ${n.unit}`,
        "",
        "Date served: ______________    Time served: ______________",
        "",
        "Method of service (check one):",
        "[  ] Personal service    [  ] Substitute service    [  ] Posting and mailing",
        "",
        "Person serving: ____________________________",
        "",
        "Notes: _______________________________________________",
        "",
        "Signature: ____________________________   Date: ______________",
      ]);
      if (input.packetKind === "internal_packet" || input.packetKind === "attorney_packet") {
        const calc = n.ledgerId ? computeCalculation(n.ledgerId) : null;
        await push("calc_review", `calc_review_${n.id.slice(0, 8)}.pdf`, "INTERNAL CALCULATION REVIEW", [
          ...(calc
            ? calc.months.map(
                (m) =>
                  `${m.periodStart} – ${m.periodEnd}: rent ${formatCents(m.rentChargedCents)}, payments ${formatCents(m.paymentsAppliedCents)}, credits ${formatCents(m.creditsAppliedCents)}, rent-only balance ${formatCents(m.rentOnlyBalanceCents)}`,
              )
            : ["No ledger linked."]),
          "",
          `Total rent-only amount: ${formatCents(n.totalAmountCents)}`,
        ]);
        await push("excluded_summary", `excluded_${n.id.slice(0, 8)}.pdf`, "EXCLUDED CHARGE SUMMARY", [
          ...(calc
            ? calc.months.flatMap((m) =>
                m.excludedItems.map(
                  (e) => `${m.month}: ${e.description} — ${formatCents(e.amountCents)} (${e.class})`,
                ),
              )
            : ["No ledger linked."]),
        ]);
        await push("audit_summary", `audit_${n.id.slice(0, 8)}.pdf`, "AUDIT LOG SUMMARY", [
          ...store.audit
            .filter((a) => a.entityId === n.id)
            .slice(0, 40)
            .map((a) => `${a.timestamp.slice(0, 16).replace("T", " ")} — ${a.userName}: ${a.summary}`),
        ]);
      }
      if (n.includeLahdLetter) {
        await push("lahd_letter", `lahd_letter_${n.id.slice(0, 8)}.pdf`, "NOTICE OF TENANT'S RIGHT TO LEGAL COUNSEL (LAHD)", [
          "Placeholder for the Los Angeles Housing Department Right to Counsel notice.",
          "Replace with the current official LAHD letter before use.",
        ]);
      }

      store.documents = store.documents.filter(
        (d) => !(d.noticeId === n.id && d.packetKind === input.packetKind),
      );
      store.documents.push(...docs);
      logAudit("pdf_exported", "notice", n.id, `Generated ${input.packetKind.replace("_", " ")} (${docs.length} document(s))`);
      return docs.map((d) => ({ ...d }));
    },
    async listDocuments(noticeId) {
      return store.documents.filter((d) => d.noticeId === noticeId).map((d) => ({ ...d }));
    },

    // --- templates ---
    async listTemplates(filters) {
      return store.templates
        .filter(
          (tpl) =>
            (!filters?.noticeType || tpl.noticeType === filters.noticeType) &&
            (!filters?.jurisdiction || tpl.jurisdiction === filters.jurisdiction),
        )
        .map((tpl) => ({ ...tpl }));
    },
    async getTemplate(id) {
      const tpl = store.templates.find((x) => x.id === id);
      return tpl ? { ...tpl } : null;
    },
    async createTemplate(input: CreateTemplateInput) {
      const t = nowIso();
      const tpl: NoticeTemplate = {
        id: uid(),
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
            changedBy: store.session.user?.id ?? null,
            changedAt: t,
            changeNote: "Created",
          },
        ],
        mergeFields: [...new Set([...input.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))],
        builtIn: false,
        createdAt: t,
        updatedAt: t,
      };
      store.templates.push(tpl);
      logAudit("template_created", "template", tpl.id, `Created template "${tpl.name}"`);
      return { ...tpl };
    },
    async updateTemplate(id, patch: TemplateUpdateInput) {
      const tpl = store.templates.find((x) => x.id === id);
      if (!tpl) throw new Error("Template not found");
      if (patch.name !== undefined) tpl.name = patch.name;
      if (patch.active !== undefined) tpl.active = patch.active;
      if (patch.attorneyReviewed !== undefined) tpl.attorneyReviewed = patch.attorneyReviewed;
      if (patch.reviewedBy !== undefined) tpl.reviewedBy = patch.reviewedBy;
      if (patch.reviewDate !== undefined) tpl.reviewDate = patch.reviewDate;
      if (patch.body !== undefined) {
        tpl.currentVersion += 1;
        tpl.versions.push({
          version: tpl.currentVersion,
          body: patch.body,
          changedBy: store.session.user?.id ?? null,
          changedAt: nowIso(),
          changeNote: patch.changeNote ?? "",
        });
        tpl.mergeFields = [...new Set([...patch.body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))];
      }
      tpl.updatedAt = nowIso();
      logAudit("template_updated", "template", id, `Updated template "${tpl.name}"`);
      return { ...tpl };
    },

    // --- holidays & deadlines ---
    async listHolidays(year) {
      return store.holidays
        .filter((h) => !year || h.date.startsWith(String(year)))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((h) => ({ ...h }));
    },
    async addHoliday(input) {
      const h: Holiday = { ...input, id: uid(), builtIn: false };
      store.holidays.push(h);
      logAudit("holiday_changed", "holiday", h.id, `Added holiday ${h.name} (${h.date})`);
      return { ...h };
    },
    async deleteHoliday(id) {
      const h = store.holidays.find((x) => x.id === id);
      store.holidays = store.holidays.filter((x) => x.id !== id);
      logAudit("holiday_changed", "holiday", id, `Removed holiday ${h?.name ?? id}`);
    },
    async computeDeadline(serviceDate, noticeType, jurisdiction) {
      return computeDeadlineInternal(serviceDate, noticeType, jurisdiction);
    },

    // --- audit ---
    async listAudit(filters?: AuditFilters) {
      let list = [...store.audit];
      if (filters) {
        if (filters.entityType) list = list.filter((a) => a.entityType === filters.entityType);
        if (filters.entityId) list = list.filter((a) => a.entityId === filters.entityId);
        if (filters.userId) list = list.filter((a) => a.userId === filters.userId);
        if (filters.action) list = list.filter((a) => a.action === filters.action);
        if (filters.from) list = list.filter((a) => a.timestamp >= filters.from!);
        if (filters.to) list = list.filter((a) => a.timestamp <= `${filters.to}T23:59:59`);
      }
      return list.slice(0, filters?.limit ?? 200);
    },

    // --- attachments ---
    async listAttachments(entityType, entityId) {
      return store.attachments
        .filter((a) => a.entityType === entityType && a.entityId === entityId)
        .map((a) => ({ ...a }));
    },
    async addAttachment(input: AddAttachmentInput) {
      const a: Attachment = {
        id: uid(),
        entityType: input.entityType,
        entityId: input.entityId,
        kind: input.kind,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: Math.round((input.dataUrl.length * 3) / 4),
        dataUrl: input.dataUrl,
        uploadedBy: store.session.user?.id ?? null,
        uploadedAt: nowIso(),
        note: input.note ?? "",
      };
      store.attachments.push(a);
      logAudit("attachment_added", input.entityType, input.entityId, `Attached ${input.fileName}`);
      return { ...a };
    },
    async deleteAttachment(id) {
      const a = store.attachments.find((x) => x.id === id);
      store.attachments = store.attachments.filter((x) => x.id !== id);
      if (a) logAudit("attachment_deleted", a.entityType, a.entityId, `Removed ${a.fileName}`);
    },

    // --- field assignments ---
    async listFieldAssignments(noticeId) {
      return store.fieldAssignments
        .filter((f) => !noticeId || f.noticeId === noticeId)
        .map((f) => ({ ...f }));
    },
    async createFieldAssignment(input: CreateFieldAssignmentInput) {
      const t = nowIso();
      const f: FieldAssignment = {
        id: uid(),
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
      store.fieldAssignments.push(f);
      return { ...f };
    },
    async updateFieldAssignment(id, patch) {
      const f = store.fieldAssignments.find((x) => x.id === id);
      if (!f) throw new Error("Assignment not found");
      Object.assign(f, patch, { updatedAt: nowIso() });
      return { ...f };
    },
    async addFieldEvidence(assignmentId, evidence) {
      const f = store.fieldAssignments.find((x) => x.id === assignmentId);
      if (!f) throw new Error("Assignment not found");
      const e: FieldEvidence = { ...evidence, id: uid() };
      f.evidence.push(e);
      f.updatedAt = nowIso();
      return { ...f };
    },

    // --- mail tracking ---
    async listMailTracking(noticeId) {
      return store.mailTracking
        .filter((m) => !noticeId || m.noticeId === noticeId)
        .map((m) => ({ ...m }));
    },
    async createMailTracking(input: CreateMailTrackingInput) {
      const t = nowIso();
      const m: MailTracking = {
        id: uid(),
        noticeId: input.noticeId,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber,
        status: input.mailedDate ? "mailed" : "preparing",
        mailedDate: input.mailedDate ?? null,
        events: input.mailedDate
          ? [{ date: input.mailedDate, status: "mailed", note: "Marked as mailed" }]
          : [],
        createdAt: t,
        updatedAt: t,
      };
      store.mailTracking.push(m);
      return { ...m };
    },
    async updateMailTracking(id, patch) {
      const m = store.mailTracking.find((x) => x.id === id);
      if (!m) throw new Error("Tracking record not found");
      Object.assign(m, patch, { updatedAt: nowIso() });
      return { ...m };
    },

    // --- dashboard & reports ---
    async getDashboard(): Promise<DashboardData> {
      const counts = {} as DashboardData["countsByStatus"];
      const statuses: NoticeStatus[] = [
        "draft",
        "needs_review",
        "reviewed",
        "finalized",
        "served",
        "mailed",
        "expired",
        "paid",
        "sent_to_attorney",
        "cancelled",
        "revised",
      ];
      for (const s of statuses) counts[s] = store.notices.filter((n) => n.status === s).length;
      const soon = addDays(new Date().toISOString().slice(0, 10), 3);
      const complianceWarnings: DashboardData["complianceWarnings"] = [];
      for (const n of store.notices.filter((x) => ["draft", "needs_review"].includes(x.status))) {
        const v = validateNoticeInternal(n);
        if (v.blockers > 0)
          complianceWarnings.push({
            noticeId: n.id,
            tenantNames: n.tenantNames,
            message: `${v.blockers} blocking issue(s): ${v.issues.find((i) => i.level === "blocker")?.message ?? ""}`,
          });
      }
      return {
        countsByStatus: counts,
        expiringSoon: store.notices
          .filter((n) => n.deadlineDate && n.deadlineDate <= soon && ["served", "mailed"].includes(n.status))
          .map((n) => ({ ...n })),
        needsReview: store.notices.filter((n) => n.status === "needs_review").map((n) => ({ ...n })),
        recentImports: store.ledgers.slice(0, 5).map((l) => ({ ...l })),
        recentActivity: store.audit.slice(0, 12),
        complianceWarnings,
        totals: {
          activeNotices: store.notices.filter(
            (n) => !["cancelled", "revised", "paid", "expired"].includes(n.status),
          ).length,
          totalDemandedCents: store.notices
            .filter((n) => !["cancelled", "revised"].includes(n.status))
            .reduce((s, n) => s + n.totalAmountCents, 0),
          paidAfterNoticeCents: store.notices
            .filter((n) => n.status === "paid")
            .reduce((s, n) => s + n.totalAmountCents, 0),
          tenants: store.tenants.length,
          properties: store.properties.length,
        },
      };
    },
    async getReport(kind: ReportKind): Promise<ReportResult> {
      const rows: ReportResult["rows"] = [];
      const active = store.notices.filter((n) => !["cancelled", "revised"].includes(n.status));
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
      const group = <T,>(items: T[], key: (x: T) => string, val: (x: T) => number, isMoney: boolean) => {
        const map = new Map<string, number>();
        for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + val(item));
        for (const [label, value] of [...map.entries()].sort()) rows.push({ label, value, isMoney });
      };
      switch (kind) {
        case "notices_by_month":
          group(active, (n) => n.createdAt.slice(0, 7), () => 1, false);
          break;
        case "notices_by_property":
          group(active, (n) => store.properties.find((p) => p.id === n.propertyId)?.nickname ?? "Unknown", () => 1, false);
          break;
        case "notices_by_status":
          group(store.notices, (n) => n.status, () => 1, false);
          break;
        case "amounts_noticed":
          group(active, (n) => n.createdAt.slice(0, 7), (n) => n.totalAmountCents, true);
          break;
        case "amounts_paid_after_notice":
          group(store.notices.filter((n) => n.status === "paid"), (n) => n.createdAt.slice(0, 7), (n) => n.totalAmountCents, true);
          break;
        case "sent_to_attorney":
          group(store.notices.filter((n) => n.status === "sent_to_attorney" || n.attorneyExportFlag), (n) => n.tenantNames.join(", "), () => 1, false);
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
          for (const txn of store.transactions) {
            const cls = txn.userOverrideClass ?? txn.systemClass;
            if (cls !== "rent" && cls !== "payment" && cls !== "credit" && txn.amountCents > 0)
              byClass.set(cls, (byClass.get(cls) ?? 0) + txn.amountCents);
          }
          for (const [label, value] of [...byClass.entries()].sort())
            rows.push({ label: label.replace(/_/g, " "), value, isMoney: true });
          break;
        }
        case "staff_activity":
          group(store.audit, (a) => a.userName, () => 1, false);
          break;
      }
      return { kind, title: titleMap[kind], rows, generatedAt: nowIso() };
    },
    async exportNoticesCsv(filters) {
      const list = await this.listNotices(filters);
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

    // --- state rules ---
    async listStateRules() {
      return [...store.stateRules];
    },

    // --- backup ---
    async exportBackup() {
      logAudit("backup_exported", "settings", null, "Exported local backup");
      const payload = {
        meta: {
          exportedAt: nowIso(),
          appVersion: "0.1.0",
          counts: {
            tenants: store.tenants.length,
            properties: store.properties.length,
            ledgers: store.ledgers.length,
            notices: store.notices.length,
          },
        },
        store: { ...store, documents: [] },
      };
      return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    },
    async importBackup(file): Promise<BackupMeta> {
      const text = await file.text();
      const payload = JSON.parse(text);
      if (!payload?.store || !payload?.meta) throw new Error("Invalid backup file");
      store = { ...buildSeed(), ...payload.store, documents: [] };
      logAudit("backup_restored", "settings", null, `Restored backup from ${payload.meta.exportedAt}`);
      return payload.meta;
    },
  };
}

registerServicesFactory(createStubServices);
