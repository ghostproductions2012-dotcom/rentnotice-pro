// ---------------------------------------------------------------------------
// Seed data — populates a fresh database with realistic demo content.
// Runs only when the users table is empty (see initDatabase in index.ts).
// PINs are stored as SHA-256 hex digests via WebCrypto (see util.sha256Hex).
// All money is integer cents; all dates are ISO strings.
// ---------------------------------------------------------------------------

import type { AppDatabase } from "./client";
import {
  companyRepo,
  emptyPayment,
  holidaysRepo,
  ledgersRepo,
  mappingPresetsRepo,
  noticesRepo,
  propertiesRepo,
  settingsRepo,
  templatesRepo,
  tenantsRepo,
  usersRepo,
} from "./repositories";
import { sha256Hex } from "./util";
import type {
  AppSettings,
  CompanyProfile,
  Holiday,
  Ledger,
  LedgerTransaction,
  MappingPreset,
  Notice,
  NoticeMonth,
  NoticeStatus,
  NoticeType,
  NoticeTemplate,
  PaymentProfile,
  Property,
  RentClass,
  ServiceRecord,
  Tenant,
  TxnKind,
  User,
} from "../types";

const SEED_TS = "2026-06-01T12:00:00.000Z";

// ------------------------------- helpers -----------------------------------

function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = lastDayOfMonth(y, m - 1);
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

function addressLine(p: Property): string {
  return [p.addressLine1, p.addressLine2, `${p.city}, ${p.state} ${p.zip}`]
    .filter(Boolean)
    .join(", ");
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

// ------------------------------- users -------------------------------------

async function seedUsers(db: AppDatabase): Promise<void> {
  const [adminPin, managerPin, staffPin] = await Promise.all([
    sha256Hex("1234"),
    sha256Hex("2345"),
    sha256Hex("3456"),
  ]);
  const users: User[] = [
    {
      id: "user-admin",
      name: "Alex Rivera",
      initials: "AR",
      role: "admin",
      pin: adminPin,
      active: true,
      createdAt: SEED_TS,
    },
    {
      id: "user-manager",
      name: "Morgan Lee",
      initials: "ML",
      role: "manager",
      pin: managerPin,
      active: true,
      createdAt: SEED_TS,
    },
    {
      id: "user-staff",
      name: "Jamie Chen",
      initials: "JC",
      role: "staff",
      pin: staffPin,
      active: true,
      createdAt: SEED_TS,
    },
  ];
  for (const u of users) usersRepo.create(db, u);
}

// ------------------------- company & settings ------------------------------

function seedCompanyAndSettings(db: AppDatabase): void {
  const company: CompanyProfile = {
    id: "company-1",
    name: "Golden State Property Management, Inc.",
    address: "8383 Wilshire Blvd, Suite 400, Beverly Hills, CA 90211",
    phone: "(310) 555-0182",
    email: "office@gspm-example.com",
    logoDataUrl: null,
    notes: "Demo company profile.",
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
  };
  companyRepo.create(db, company);

  const settings: AppSettings = {
    id: "app",
    companyProfileId: company.id,
    defaultJurisdiction: "CA",
    requireAttorneyReviewedTemplate: true,
    allowAdminTemplateOverride: false,
    pinLockEnabled: true,
    autoLockMinutes: 15,
    aiAssistEnabled: false,
    aiConsentAcknowledged: false,
    syncEnabled: false,
    syncEndpoint: "",
    disclaimerAcknowledgedAt: null,
    onboardingCompleted: true,
    updatedAt: SEED_TS,
  };
  settingsRepo.create(db, settings);
}

// ------------------------------ properties ---------------------------------

const laPayment: PaymentProfile = {
  payToName: "Golden State Property Management, Inc.",
  paymentAddress: "8383 Wilshire Blvd, Suite 400, Beverly Hills, CA 90211",
  phone: "(310) 555-0182",
  acceptedMethods: ["cashiers_check", "money_order", "online_portal"],
  inPersonAllowed: true,
  officeHours: "Monday–Friday, 9:00 AM – 5:00 PM",
  paymentDays: "Monday through Friday (excluding holidays)",
  electronicInstructions: "Resident portal: portal.gspm-example.com",
};

function property(over: Partial<Property> & Pick<Property, "id" | "nickname" | "addressLine1" | "city" | "zip" | "county" | "units" | "ownerName" | "payment">): Property {
  return {
    addressLine2: "",
    state: "CA",
    managementCompany: "Golden State Property Management, Inc.",
    managerContact: "",
    isLosAngelesCity: false,
    notes: "",
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
    ...over,
  };
}

const PROPERTIES: Property[] = [
  property({
    id: "prop-1",
    nickname: "Vermont Terrace",
    addressLine1: "1244 S Vermont Avenue",
    city: "Los Angeles",
    zip: "90006",
    county: "Los Angeles",
    units: ["1A", "1B", "2A", "2B", "3A", "3B", "4A", "4B"],
    ownerName: "Vermont Terrace Holdings LLC",
    managerContact: "Morgan Lee — (310) 555-0182",
    payment: laPayment,
    isLosAngelesCity: true,
    notes: "Rent-stabilized building (LARSO).",
  }),
  property({
    id: "prop-2",
    nickname: "Maple Court",
    addressLine1: "77 Maple Court",
    city: "Sacramento",
    zip: "95814",
    county: "Sacramento",
    units: ["101", "102", "103", "104"],
    ownerName: "R. & C. Whitfield Family Trust",
    managerContact: "Jamie Chen — (916) 555-0140",
    payment: {
      ...laPayment,
      paymentAddress: "1420 J Street, Suite 200, Sacramento, CA 95814",
      phone: "(916) 555-0140",
    },
  }),
  property({
    id: "prop-3",
    nickname: "Bayview Apartments",
    addressLine1: "530 Bayview Terrace",
    city: "Oakland",
    zip: "94612",
    county: "Alameda",
    units: ["A", "B", "C", "D"],
    ownerName: "Bayview Terrace Partners LP",
    managerContact: "Morgan Lee — (510) 555-0119",
    payment: {
      ...laPayment,
      paymentAddress: "530 Bayview Terrace, Oakland, CA 94612",
      phone: "(510) 555-0119",
    },
  }),
  property({
    id: "prop-4",
    nickname: "Sunset Villas",
    addressLine1: "2810 Sunset Cliffs Blvd",
    city: "San Diego",
    zip: "92107",
    county: "San Diego",
    units: ["201", "202", "203", "204"],
    ownerName: "Sunset Villas Investors LLC",
    managerContact: "Jamie Chen — (619) 555-0166",
    payment: {
      ...laPayment,
      paymentAddress: "2810 Sunset Cliffs Blvd, San Diego, CA 92107",
      phone: "(619) 555-0166",
    },
  }),
];

function seedProperties(db: AppDatabase): void {
  for (const p of PROPERTIES) propertiesRepo.create(db, p);
}

function findProperty(id: string): Property {
  const p = PROPERTIES.find((x) => x.id === id);
  if (!p) throw new Error(`Seed property not found: ${id}`);
  return p;
}

// ------------------------------- tenants -----------------------------------

function tenant(over: Partial<Tenant> & Pick<Tenant, "id" | "names" | "propertyId" | "unit" | "monthlyRentCents">): Tenant {
  return {
    email: "",
    phone: "",
    leaseStart: null,
    moveOutDate: null,
    notes: "",
    archived: false,
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
    ...over,
  };
}

const TENANTS: Tenant[] = [
  tenant({ id: "tenant-1", names: ["Maria Gonzalez", "Luis Gonzalez"], propertyId: "prop-1", unit: "4B", monthlyRentCents: 250000, email: "m.gonzalez@example.com", phone: "(213) 555-0134", leaseStart: "2023-08-01" }),
  tenant({ id: "tenant-2", names: ["Daniel Kim"], propertyId: "prop-1", unit: "2A", monthlyRentCents: 218500, email: "dkim@example.com", phone: "(213) 555-0177", leaseStart: "2024-02-01" }),
  tenant({ id: "tenant-3", names: ["Aisha Patel"], propertyId: "prop-1", unit: "1A", monthlyRentCents: 232000, email: "aisha.patel@example.com", phone: "(213) 555-0192", leaseStart: "2023-05-15" }),
  tenant({ id: "tenant-4", names: ["Sarah Okafor"], propertyId: "prop-2", unit: "103", monthlyRentCents: 189000, phone: "(916) 555-0201", leaseStart: "2022-11-01" }),
  tenant({ id: "tenant-5", names: ["Robert Nguyen", "Linda Nguyen"], propertyId: "prop-2", unit: "101", monthlyRentCents: 205000, email: "rnguyen@example.com", leaseStart: "2021-09-01" }),
  tenant({ id: "tenant-6", names: ["James Carter"], propertyId: "prop-3", unit: "A", monthlyRentCents: 275000, email: "jcarter@example.com", phone: "(510) 555-0233", leaseStart: "2024-06-01" }),
  tenant({ id: "tenant-7", names: ["Emily Rodriguez"], propertyId: "prop-3", unit: "C", monthlyRentCents: 260000, email: "e.rodriguez@example.com", leaseStart: "2023-01-15" }),
  tenant({ id: "tenant-8", names: ["Michael Brown"], propertyId: "prop-4", unit: "201", monthlyRentCents: 310000, email: "mbrown@example.com", phone: "(619) 555-0244", leaseStart: "2022-03-01" }),
  tenant({ id: "tenant-9", names: ["Sofia Martinez"], propertyId: "prop-4", unit: "203", monthlyRentCents: 298000, email: "sofia.m@example.com", leaseStart: "2024-08-01" }),
  tenant({ id: "tenant-10", names: ["David Wilson"], propertyId: "prop-2", unit: "104", monthlyRentCents: 197500, phone: "(916) 555-0255", leaseStart: "2023-10-01", archived: true, moveOutDate: "2026-03-31" }),
];

function seedTenants(db: AppDatabase): void {
  for (const t of TENANTS) tenantsRepo.create(db, t);
}

function findTenant(id: string): Tenant {
  const t = TENANTS.find((x) => x.id === id);
  if (!t) throw new Error(`Seed tenant not found: ${id}`);
  return t;
}

// ------------------------------ templates ----------------------------------

function seedTemplates(db: AppDatabase): void {
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
      currentVersion: 1,
      versions: [
        {
          version: 1,
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
            "",
            "This notice is given pursuant to California Code of Civil Procedure section 1161(2).",
            "",
            "Date prepared: {{prepared_date}}",
            "",
            "____________________________________",
            "{{owner_agent_name}}",
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
        "prepared_date",
        "owner_agent_name",
        "management_company",
      ],
      builtIn: true,
      createdAt: SEED_TS,
      updatedAt: SEED_TS,
    },
    {
      id: "tpl-ca-60day",
      name: "CA 60-Day Notice of Termination",
      noticeType: "termination_60day",
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
          body: "SIXTY-DAY NOTICE OF TERMINATION OF TENANCY\n\nTO: {{tenant_names}}\n{{property_address}}, Unit {{unit}}\n\nYour tenancy is terminated effective {{termination_date}}, not less than sixty (60) days after service of this notice.\n\nDate prepared: {{prepared_date}}\n\n____________________________________\n{{owner_agent_name}}\n{{management_company}}",
          changedBy: "user-admin",
          changedAt: SEED_TS,
          changeNote: "Initial draft — requires attorney review",
        },
      ],
      mergeFields: ["tenant_names", "property_address", "unit", "termination_date", "prepared_date", "owner_agent_name", "management_company"],
      builtIn: true,
      createdAt: SEED_TS,
      updatedAt: SEED_TS,
    },
  ];
  for (const tpl of templates) templatesRepo.create(db, tpl);
}

// --------------------------- mapping presets -------------------------------

function seedMappingPresets(db: AppDatabase): void {
  const presets: MappingPreset[] = [
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
      createdAt: SEED_TS,
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
      createdAt: SEED_TS,
    },
  ];
  for (const p of presets) mappingPresetsRepo.create(db, p);
}

// ------------------------------- ledgers -----------------------------------

interface TxnSeed {
  date: string;
  description: string;
  amountCents: number; // positive charge, negative payment/credit
  kind: TxnKind;
  systemClass: RentClass;
  category?: string;
}

function buildTransactions(ledgerId: string, seeds: TxnSeed[]): LedgerTransaction[] {
  return seeds.map((s, i) => {
    const isPayment = s.systemClass === "payment" || s.systemClass === "credit";
    return {
      id: `${ledgerId}-txn-${i + 1}`,
      ledgerId,
      rowIndex: i + 1,
      date: s.date,
      month: s.date.slice(0, 7),
      description: s.description,
      originalCategory: s.category ?? "",
      memo: "",
      kind: s.kind,
      amountCents: s.amountCents,
      balanceCents: null,
      systemClass: s.systemClass,
      confidence: s.systemClass === "unclassified" ? 0.3 : 0.95,
      includedInNotice: s.systemClass === "rent",
      classReason:
        s.systemClass === "rent"
          ? 'Matched keyword "rent"'
          : isPayment
            ? "Negative amount — payment/credit"
            : `Classified as ${s.systemClass}`,
      userOverrideClass: null,
      overrideReason: null,
      overriddenBy: null,
      flagged: s.systemClass === "unclassified",
      flagReason: s.systemClass === "unclassified" ? "Could not classify from description" : null,
    };
  });
}

function seedLedger(
  db: AppDatabase,
  id: string,
  tenantId: string,
  name: string,
  seeds: TxnSeed[],
): void {
  const txns = buildTransactions(id, seeds);
  const dates = txns.map((t) => t.date).sort();
  const ledger: Ledger = {
    id,
    tenantId,
    name,
    sourceType: "csv",
    sourceFileName: `${id}.csv`,
    vendor: "appfolio",
    mappingUsed: null,
    importedAt: SEED_TS,
    importedBy: "user-staff",
    transactionCount: txns.length,
    periodStart: dates[0] ?? null,
    periodEnd: dates[dates.length - 1] ?? null,
    notes: "Seeded example ledger",
  };
  ledgersRepo.create(db, ledger, txns);
}

function seedLedgers(db: AppDatabase): void {
  seedLedger(db, "ledger-1", "tenant-1", "AppFolio export — Apr–Jun 2026", [
    { date: "2026-04-01", description: "Monthly Rent", amountCents: 250000, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-04-03", description: "Rent Payment — Check #2210", amountCents: -250000, kind: "payment", systemClass: "payment" },
    { date: "2026-05-01", description: "Monthly Rent", amountCents: 250000, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-05-06", description: "Late Fee", amountCents: 12500, kind: "non_rent_charge", systemClass: "late_fee" },
    { date: "2026-05-12", description: "Rent Payment — Online Portal", amountCents: -100000, kind: "payment", systemClass: "payment" },
    { date: "2026-05-15", description: "Utility Reimbursement (RUBS)", amountCents: 8500, kind: "non_rent_charge", systemClass: "utility" },
    { date: "2026-06-01", description: "Monthly Rent", amountCents: 250000, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-06-05", description: "Late Fee", amountCents: 12500, kind: "non_rent_charge", systemClass: "late_fee" },
  ]);

  seedLedger(db, "ledger-2", "tenant-2", "AppFolio export — May–Jun 2026", [
    { date: "2026-05-01", description: "Monthly Rent", amountCents: 218500, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-05-10", description: "Rent Payment — Check #1180", amountCents: -218500, kind: "payment", systemClass: "payment" },
    { date: "2026-06-01", description: "Monthly Rent", amountCents: 218500, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-06-07", description: "Parking Fee", amountCents: 7500, kind: "non_rent_charge", systemClass: "parking_fee" },
  ]);

  seedLedger(db, "ledger-3", "tenant-4", "Buildium export — Mar–May 2026", [
    { date: "2026-03-01", description: "Monthly Rent", amountCents: 189000, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-03-04", description: "Rent Payment — ACH", amountCents: -189000, kind: "payment", systemClass: "payment" },
    { date: "2026-04-01", description: "Monthly Rent", amountCents: 189000, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-04-09", description: "NSF Returned Payment Fee", amountCents: 3500, kind: "non_rent_charge", systemClass: "nsf_fee" },
    { date: "2026-05-01", description: "Monthly Rent", amountCents: 189000, kind: "rent_charge", systemClass: "rent" },
    { date: "2026-05-14", description: "Misc. Charge", amountCents: 4200, kind: "non_rent_charge", systemClass: "unclassified" },
  ]);
}

// ------------------------------- notices -----------------------------------

function month(
  m: string,
  rentChargedCents: number,
  paymentsAppliedCents: number,
  selectedAmountCents?: number,
): NoticeMonth {
  const { start, end } = monthBounds(m);
  const rentOnly = Math.max(0, rentChargedCents - paymentsAppliedCents);
  return {
    month: m,
    periodStart: start,
    periodEnd: end,
    rentChargedCents,
    paymentsAppliedCents,
    creditsAppliedCents: 0,
    rentOnlyBalanceCents: rentOnly,
    selectedAmountCents: selectedAmountCents ?? rentOnly,
    overrideReason: null,
  };
}

interface NoticeSeed {
  id: string;
  noticeType: NoticeType;
  status: NoticeStatus;
  tenantId: string;
  months: NoticeMonth[];
  templateId: string | null;
  over?: Partial<Notice>;
}

function buildNotice(seed: NoticeSeed): Notice {
  const tenant = findTenant(seed.tenantId);
  const property = findProperty(tenant.propertyId ?? "");
  const total = seed.months.reduce((s, m) => s + m.selectedAmountCents, 0);
  const base: Notice = {
    id: seed.id,
    noticeType: seed.noticeType,
    jurisdiction: "CA",
    status: seed.status,
    tenantId: tenant.id,
    propertyId: property.id,
    unit: tenant.unit,
    tenantNames: [...tenant.names],
    propertyAddress: addressLine(property),
    ledgerId: null,
    months: seed.months,
    totalAmountCents: total,
    payment: { ...property.payment },
    templateId: seed.templateId,
    templateVersion: seed.templateId ? 1 : null,
    includeLahdLetter: property.isLosAngelesCity,
    covenantDescription: "",
    entryDate: null,
    entryTimeWindow: "",
    entryReason: "",
    terminationDate: null,
    rentIncreaseNewAmountCents: null,
    rentIncreaseEffectiveDate: null,
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
    internalNotes: "",
    preparedBy: "user-staff",
    createdAt: SEED_TS,
    updatedAt: SEED_TS,
    ...seed.over,
  };
  return base;
}

function seedNotices(db: AppDatabase): void {
  const seeds: NoticeSeed[] = [
    {
      id: "notice-1",
      noticeType: "pay_or_quit_3day",
      status: "served",
      tenantId: "tenant-1",
      templateId: "tpl-ca-3day-pay",
      months: [month("2026-05", 250000, 100000), month("2026-06", 250000, 0)],
      over: {
        ledgerId: "ledger-1",
        createdAt: "2026-06-04T15:00:00.000Z",
        updatedAt: "2026-06-05T17:30:00.000Z",
        deadlineDate: "2026-06-11",
        service: {
          dateServed: "2026-06-05",
          timeServed: "10:15",
          method: "post_and_mail",
          servedBy: "Jamie Chen",
          serverNotes: "Posted on unit door and mailed same day.",
          mailedDate: "2026-06-05",
        },
      },
    },
    {
      id: "notice-2",
      noticeType: "pay_or_quit_3day",
      status: "draft",
      tenantId: "tenant-2",
      templateId: "tpl-ca-3day-pay",
      months: [month("2026-06", 218500, 0)],
      over: { ledgerId: "ledger-2", createdAt: "2026-06-08T09:00:00.000Z", updatedAt: "2026-06-08T09:00:00.000Z" },
    },
    {
      id: "notice-3",
      noticeType: "pay_or_quit_3day",
      status: "finalized",
      tenantId: "tenant-4",
      templateId: "tpl-ca-3day-pay",
      months: [month("2026-05", 189000, 0)],
      over: {
        ledgerId: "ledger-3",
        createdAt: "2026-05-20T14:00:00.000Z",
        updatedAt: "2026-05-22T11:00:00.000Z",
        reviewerApprovedBy: "user-manager",
        reviewerApprovedAt: "2026-05-21T16:00:00.000Z",
        finalizedBy: "user-admin",
        finalizedAt: "2026-05-22T11:00:00.000Z",
      },
    },
    {
      id: "notice-4",
      noticeType: "termination_60day",
      status: "reviewed",
      tenantId: "tenant-5",
      templateId: "tpl-ca-60day",
      months: [],
      over: {
        terminationDate: "2026-09-30",
        createdAt: "2026-05-28T10:00:00.000Z",
        updatedAt: "2026-05-29T10:00:00.000Z",
        reviewerApprovedBy: "user-manager",
        reviewerApprovedAt: "2026-05-29T10:00:00.000Z",
      },
    },
    {
      id: "notice-5",
      noticeType: "pay_or_quit_3day",
      status: "paid",
      tenantId: "tenant-6",
      templateId: "tpl-ca-3day-pay",
      months: [month("2026-04", 275000, 0)],
      over: {
        createdAt: "2026-04-06T09:00:00.000Z",
        updatedAt: "2026-04-12T13:00:00.000Z",
        deadlineDate: "2026-04-13",
        service: {
          dateServed: "2026-04-08",
          timeServed: "09:30",
          method: "personal",
          servedBy: "Morgan Lee",
          serverNotes: "Personally served the tenant.",
          mailedDate: null,
        },
      },
    },
    {
      id: "notice-6",
      noticeType: "pay_or_quit_3day",
      status: "needs_review",
      tenantId: "tenant-7",
      templateId: "tpl-ca-3day-pay",
      months: [month("2026-06", 260000, 0)],
      over: { createdAt: "2026-06-09T08:30:00.000Z", updatedAt: "2026-06-09T08:30:00.000Z" },
    },
  ];
  for (const seed of seeds) noticesRepo.create(db, buildNotice(seed));
}

// ------------------------------- holidays ----------------------------------

const HOLIDAYS_BY_YEAR: Record<string, [string, string][]> = {
  "2025": [
    ["2025-01-01", "New Year's Day"],
    ["2025-01-20", "Martin Luther King Jr. Day"],
    ["2025-02-12", "Lincoln's Birthday"],
    ["2025-02-17", "Presidents' Day"],
    ["2025-03-31", "César Chávez Day"],
    ["2025-05-26", "Memorial Day"],
    ["2025-06-19", "Juneteenth"],
    ["2025-07-04", "Independence Day"],
    ["2025-09-01", "Labor Day"],
    ["2025-11-11", "Veterans Day"],
    ["2025-11-27", "Thanksgiving Day"],
    ["2025-11-28", "Day after Thanksgiving"],
    ["2025-12-25", "Christmas Day"],
  ],
  "2026": [
    ["2026-01-01", "New Year's Day"],
    ["2026-01-19", "Martin Luther King Jr. Day"],
    ["2026-02-12", "Lincoln's Birthday"],
    ["2026-02-16", "Presidents' Day"],
    ["2026-03-31", "César Chávez Day"],
    ["2026-05-25", "Memorial Day"],
    ["2026-06-19", "Juneteenth"],
    ["2026-07-03", "Independence Day (observed)"],
    ["2026-09-07", "Labor Day"],
    ["2026-11-11", "Veterans Day"],
    ["2026-11-26", "Thanksgiving Day"],
    ["2026-11-27", "Day after Thanksgiving"],
    ["2026-12-25", "Christmas Day"],
  ],
  "2027": [
    ["2027-01-01", "New Year's Day"],
    ["2027-01-18", "Martin Luther King Jr. Day"],
    ["2027-02-12", "Lincoln's Birthday"],
    ["2027-02-15", "Presidents' Day"],
    ["2027-03-31", "César Chávez Day"],
    ["2027-05-31", "Memorial Day"],
    ["2027-06-18", "Juneteenth (observed)"],
    ["2027-07-05", "Independence Day (observed)"],
    ["2027-09-06", "Labor Day"],
    ["2027-11-11", "Veterans Day"],
    ["2027-11-25", "Thanksgiving Day"],
    ["2027-11-26", "Day after Thanksgiving"],
    ["2027-12-24", "Christmas Day (observed)"],
  ],
};

function seedHolidays(db: AppDatabase): void {
  for (const [year, entries] of Object.entries(HOLIDAYS_BY_YEAR)) {
    entries.forEach(([date, name], i) => {
      const holiday: Holiday = {
        id: `hol-${year}-${i}`,
        date,
        name,
        jurisdiction: "CA",
        courtHoliday: true,
        builtIn: true,
      };
      holidaysRepo.create(db, holiday);
    });
  }
}

// ------------------------------- entry point -------------------------------

/** Seeds demo data only when the users table is empty. Safe to call every boot. */
export async function seedDatabase(db: AppDatabase): Promise<void> {
  if (usersRepo.count(db) > 0) return;
  await seedUsers(db);
  seedCompanyAndSettings(db);
  seedProperties(db);
  seedTenants(db);
  seedTemplates(db);
  seedMappingPresets(db);
  seedLedgers(db);
  seedNotices(db);
  seedHolidays(db);
}
