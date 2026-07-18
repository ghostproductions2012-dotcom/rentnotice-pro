// ---------------------------------------------------------------------------
// Sample portfolio generator — builds a realistic ~1000-door portfolio so
// prospects can explore the app at production scale. Strictly additive: it
// only ever inserts rows whose ids carry the SAMPLE_ID_PREFIX and never
// touches users, company, settings, license/activation, or existing records.
// Removal deletes exactly the sample-tagged rows (plus dependents users may
// have generated from them, e.g. documents attached to a sample notice).
// All money is integer cents; all dates are ISO strings. Deterministic PRNG
// so repeated loads produce the same portfolio.
// ---------------------------------------------------------------------------

import type { AppDatabase } from "./client";
import {
  appMetaRepo,
  ledgersRepo,
  noticesRepo,
  propertiesRepo,
  tenantsRepo,
} from "./repositories";
import type {
  Ledger,
  LedgerTransaction,
  Notice,
  NoticeMonth,
  NoticeStatus,
  PaymentProfile,
  Property,
  SampleDataOptions,
  Tenant,
} from "../types";

export const SAMPLE_ID_PREFIX = "sample-";
const SAMPLE_META_KEY = "sample_data_loaded_at";

/** True when a sample portfolio is currently loaded in this workspace. */
export function isSampleDataLoaded(db: AppDatabase): boolean {
  return appMetaRepo.get(db, SAMPLE_META_KEY) !== null;
}

/** Count of properties that are NOT part of the sample portfolio. */
export function countRealProperties(db: AppDatabase): number {
  const r = db.get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM properties WHERE id NOT LIKE ?",
    [`${SAMPLE_ID_PREFIX}%`],
  );
  return r ? Number(r.n) : 0;
}

// ------------------------------ deterministic RNG ---------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------ name/address pools --------------------------

const FIRST_NAMES = [
  "Maria", "James", "Jennifer", "Robert", "Linda", "Michael", "Patricia", "David",
  "Elizabeth", "William", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Carlos", "Karen", "Daniel", "Nancy", "Miguel", "Lisa",
  "Anthony", "Sandra", "Kevin", "Ashley", "Jose", "Emily", "Brian", "Michelle",
  "Angela", "Marcus", "Diana", "Luis", "Rachel", "Andre", "Sofia", "Derek",
  "Priya", "Wei", "Amara", "Hiro", "Fatima", "Dmitri", "Rosa", "Tyrone",
  "Grace", "Omar", "Elena", "Jamal", "Mei", "Andres", "Nia", "Viktor", "Leila",
] as const;

const LAST_NAMES = [
  "Garcia", "Smith", "Johnson", "Martinez", "Brown", "Rodriguez", "Davis",
  "Hernandez", "Lopez", "Wilson", "Gonzalez", "Anderson", "Thomas", "Taylor",
  "Moore", "Jackson", "Perez", "White", "Nguyen", "Kim", "Chen", "Patel",
  "Torres", "Ramirez", "Lee", "Walker", "Hall", "Young", "Allen", "Sanchez",
  "Wright", "King", "Scott", "Green", "Baker", "Adams", "Nelson", "Rivera",
  "Campbell", "Mitchell", "Carter", "Roberts", "Gomez", "Phillips", "Evans",
  "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes", "Stewart",
  "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz",
] as const;

const STREET_NAMES = [
  "Willow", "Cedar", "Magnolia", "Sycamore", "Juniper", "Alder", "Palm",
  "Cypress", "Laurel", "Poplar", "Sunset", "Harbor", "Vista", "Canyon",
  "Meadow", "Orchard", "Granite", "Sierra", "Pacific", "Del Mar", "Mission",
  "Fair Oaks", "Crescent", "Highland", "Foothill", "Riverside", "Lakeview",
  "Monterey", "Cambridge", "Ashford", "Brookside", "Clearwater", "Dover",
  "Eastwood", "Fremont", "Glenwood", "Hillcrest", "Ironwood", "Kensington",
  "Larchmont", "Norwood", "Oakhurst", "Pinehurst", "Redwood", "Rosemont",
] as const;

const STREET_SUFFIXES = ["Avenue", "Street", "Drive", "Lane", "Way", "Court", "Boulevard", "Place"] as const;

interface CityBand {
  city: string;
  county: string;
  zips: string[];
  /** typical 2BR rent, cents */
  baseRentCents: number;
  areaCode: string;
  isLosAngelesCity?: boolean;
}

const CITIES: CityBand[] = [
  { city: "Los Angeles", county: "Los Angeles", zips: ["90006", "90019", "90026", "90042", "90065"], baseRentCents: 245000, areaCode: "213", isLosAngelesCity: true },
  { city: "Long Beach", county: "Los Angeles", zips: ["90802", "90804", "90813"], baseRentCents: 205000, areaCode: "562" },
  { city: "Sacramento", county: "Sacramento", zips: ["95814", "95816", "95818", "95822"], baseRentCents: 172500, areaCode: "916" },
  { city: "Oakland", county: "Alameda", zips: ["94601", "94606", "94610", "94612"], baseRentCents: 225000, areaCode: "510" },
  { city: "San Diego", county: "San Diego", zips: ["92104", "92105", "92107", "92115"], baseRentCents: 235000, areaCode: "619" },
  { city: "Fresno", county: "Fresno", zips: ["93701", "93704", "93726"], baseRentCents: 132500, areaCode: "559" },
  { city: "Riverside", county: "Riverside", zips: ["92501", "92504", "92506"], baseRentCents: 187500, areaCode: "951" },
  { city: "Bakersfield", county: "Kern", zips: ["93301", "93304", "93309"], baseRentCents: 127500, areaCode: "661" },
] as const;

const OWNER_SUFFIXES = ["Holdings LLC", "Properties LLC", "Investments LP", "Family Trust", "Capital Partners LLC", "Realty Group LLC"] as const;

// ------------------------------ helpers -------------------------------------

const GEN_TS = "2026-07-01T12:00:00.000Z";
// Ledger history always ends June 2026; "today" for the portfolio is mid-July.
const HISTORY_END = { year: 2026, month: 6 };

/** The last `count` calendar months ending at HISTORY_END, as "YYYY-MM". */
function historyMonths(count: number): string[] {
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(HISTORY_END.year, HISTORY_END.month - 1 - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function lastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const last = lastDayOfMonth(y, m - 1);
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function phone(rng: () => number, areaCode: string): string {
  const n = () => Math.floor(rng() * 10);
  return `(${areaCode}) 555-0${n()}${n()}${n()}`;
}

// ------------------------------ generation ----------------------------------

export interface SamplePortfolioStats {
  properties: number;
  units: number;
  tenants: number;
  ledgers: number;
  transactions: number;
  notices: number;
}

// --------------------------- option resolution -------------------------------

interface ResolvedSampleOptions {
  totalDoors: number;
  singleFamilyPct: number;
  avgUnitsPerBuilding: number;
  vacancyPct: number;
  latePayerPct: number;
  monthsOfHistory: number;
  /** null = use the per-city market bands unscaled */
  avgRentCents: number | null;
}

export const SAMPLE_DEFAULTS = {
  totalDoors: 1000,
  singleFamilyPct: 62,
  avgUnitsPerBuilding: 3,
  vacancyPct: 5,
  latePayerPct: 12,
  monthsOfHistory: 6,
} as const;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Fill in any unset/invalid options with defaults and clamp the rest to safe
 * ranges — a partially filled form must always yield a valid portfolio.
 */
export function resolveSampleOptions(options?: SampleDataOptions | null): ResolvedSampleOptions {
  const num = (v: number | null | undefined): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const o = options ?? {};
  const rent = num(o.avgRentDollars);
  return {
    totalDoors: Math.round(clamp(num(o.totalDoors) ?? SAMPLE_DEFAULTS.totalDoors, 10, 5000)),
    singleFamilyPct: clamp(num(o.singleFamilyPct) ?? SAMPLE_DEFAULTS.singleFamilyPct, 0, 100),
    avgUnitsPerBuilding: clamp(
      num(o.avgUnitsPerBuilding) ?? SAMPLE_DEFAULTS.avgUnitsPerBuilding,
      2,
      4,
    ),
    vacancyPct: clamp(num(o.vacancyPct) ?? SAMPLE_DEFAULTS.vacancyPct, 0, 90),
    latePayerPct: clamp(num(o.latePayerPct) ?? SAMPLE_DEFAULTS.latePayerPct, 0, 100),
    monthsOfHistory: Math.round(
      clamp(num(o.monthsOfHistory) ?? SAMPLE_DEFAULTS.monthsOfHistory, 1, 24),
    ),
    avgRentCents: rent === null ? null : Math.round(clamp(rent, 300, 20000)) * 100,
  };
}

interface TenantPlan {
  tenant: Tenant;
  property: Property;
  /** months of rent-only arrears at the end of the history (0 = current) */
  monthsBehind: number;
}

function buildPayment(company: string, address: string, areaPhone: string): PaymentProfile {
  return {
    payToName: company,
    payToPerson: "",
    paymentAddress: address,
    phone: areaPhone,
    acceptedMethods: ["cashiers_check", "money_order", "online_portal"],
    inPersonAllowed: true,
    officeHours: "Monday–Friday, 9:00 AM – 5:00 PM",
    paymentDays: "Monday through Friday (excluding holidays)",
    electronicInstructions: "Resident portal: portal.example.com",
  };
}

/**
 * Generate the whole portfolio in memory first, then insert. Insertion is
 * split into phases so the caller can report progress and yield to the UI.
 */
export function planSamplePortfolio(options?: SampleDataOptions | null): {
  properties: Property[];
  plans: TenantPlan[];
  months: string[];
} {
  const resolved = resolveSampleOptions(options);
  const months = historyMonths(resolved.monthsOfHistory);
  const sfShare = resolved.singleFamilyPct / 100;
  const avgMulti = resolved.avgUnitsPerBuilding;
  const vacancy = resolved.vacancyPct / 100;
  const lateShare = resolved.latePayerPct / 100;
  // Rent scaling: when a target average rent is given, scale the city bands
  // so the portfolio-wide average lands near it. Mean band rent is fixed;
  // approximate the mean size factor from the requested mix.
  const meanBand = CITIES.reduce((s, c) => s + c.baseRentCents, 0) / CITIES.length;
  const sfDoorShare = sfShare * 1 / (sfShare * 1 + (1 - sfShare) * avgMulti || 1);
  const meanSizeFactor = sfDoorShare * 1.15 + (1 - sfDoorShare) * 0.92;
  const rentScale =
    resolved.avgRentCents === null ? 1 : resolved.avgRentCents / (meanBand * meanSizeFactor);

  const rng = mulberry32(20260718);
  const properties: Property[] = [];
  const plans: TenantPlan[] = [];
  let doors = 0;
  let propNo = 0;
  let tenantNo = 0;

  while (doors < resolved.totalDoors) {
    propNo += 1;
    const band = pick(rng, CITIES);
    // Portfolio mix: single-family share per options; multi-unit buildings
    // sized 2–4 with a mean near avgUnitsPerBuilding.
    let unitCount: number;
    if (rng() < sfShare) {
      unitCount = 1;
    } else {
      const lo = Math.min(4, Math.floor(avgMulti));
      const frac = avgMulti - lo;
      unitCount = lo >= 4 ? 4 : rng() < frac ? lo + 1 : lo;
    }
    const streetNum = 100 + Math.floor(rng() * 9800);
    const street = `${streetNum} ${pick(rng, STREET_NAMES)} ${pick(rng, STREET_SUFFIXES)}`;
    const zip = pick(rng, band.zips);
    const ownerLast = pick(rng, LAST_NAMES);
    const owner = rng() < 0.55 ? `${ownerLast} ${pick(rng, OWNER_SUFFIXES)}` : `${pick(rng, FIRST_NAMES)} ${ownerLast}`;
    const units = unitCount === 1 ? [] : Array.from({ length: unitCount }, (_, i) => String(101 + i));
    const contactPhone = phone(rng, band.areaCode);
    const property: Property = {
      id: `${SAMPLE_ID_PREFIX}prop-${propNo}`,
      nickname: unitCount === 1 ? street : `${pick(rng, STREET_NAMES)} ${unitCount === 2 ? "Duplex" : unitCount === 3 ? "Triplex" : "Fourplex"}`,
      addressLine1: street,
      addressLine2: "",
      city: band.city,
      state: "CA",
      zip,
      county: band.county,
      bedrooms: unitCount === 1 ? 2 + Math.floor(rng() * 3) : null,
      units,
      ownerName: owner,
      managementCompany: "",
      managerContact: "",
      payment: buildPayment(owner, `${street}, ${band.city}, CA ${zip}`, contactPhone),
      isLosAngelesCity: band.isLosAngelesCity ?? false,
      notes: "",
      externalSource: "sample",
      externalId: `sample-${propNo}`,
      createdAt: GEN_TS,
      updatedAt: GEN_TS,
    };
    properties.push(property);
    doors += unitCount;

    const unitLabels = unitCount === 1 ? [""] : units;
    for (const unit of unitLabels) {
      // Vacancy per options (default ~5%).
      if (rng() < vacancy) continue;
      tenantNo += 1;
      // Rent: city band, scaled a bit by size/unit type, ±12% noise, $25 steps.
      const sizeFactor = unitCount === 1 ? 1.15 : 0.92;
      const noise = 0.88 + rng() * 0.24;
      const rent = Math.round((band.baseRentCents * rentScale * sizeFactor * noise) / 2500) * 2500;
      const last = pick(rng, LAST_NAMES);
      const names = [`${pick(rng, FIRST_NAMES)} ${last}`];
      if (rng() < 0.4) names.push(`${pick(rng, FIRST_NAMES)} ${last}`);
      // Late payers per options (default ~12%); of those, roughly 62% are one
      // month behind, 29% two months, 8% three (capped by history length).
      const lateRoll = rng();
      let monthsBehind = 0;
      if (lateShare > 0 && lateRoll < lateShare) {
        const inner = lateRoll / lateShare;
        monthsBehind = Math.min(inner < 0.625 ? 1 : inner < 0.915 ? 2 : 3, months.length);
      }
      const leaseYear = 2021 + Math.floor(rng() * 5);
      const leaseMonth = 1 + Math.floor(rng() * 12);
      const tenant: Tenant = {
        id: `${SAMPLE_ID_PREFIX}tenant-${tenantNo}`,
        names,
        propertyId: property.id,
        unit,
        email: `${names[0].toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`,
        phone: phone(rng, band.areaCode),
        monthlyRentCents: rent,
        leaseStart: `${leaseYear}-${String(leaseMonth).padStart(2, "0")}-01`,
        moveOutDate: null,
        notes: "",
        archived: false,
        externalSource: "sample",
        externalId: `sample-${tenantNo}`,
        createdAt: GEN_TS,
        updatedAt: GEN_TS,
      };
      plans.push({ tenant, property, monthsBehind });
    }
  }
  return { properties, plans, months };
}

/** Build the ledger history for one tenant reflecting their payment behavior. */
function buildLedger(
  rng: () => number,
  plan: TenantPlan,
  index: number,
  months: string[],
): { ledger: Ledger; txns: LedgerTransaction[] } {
  const rent = plan.tenant.monthlyRentCents ?? 150000;
  const ledgerId = `${SAMPLE_ID_PREFIX}ledger-${index}`;
  const txns: LedgerTransaction[] = [];
  let row = 0;
  const push = (t: Omit<LedgerTransaction, "id" | "ledgerId" | "rowIndex" | "month" | "balanceCents" | "originalCategory" | "memo" | "confidence" | "includedInNotice" | "classReason" | "userOverrideClass" | "overrideReason" | "overriddenBy" | "flagged" | "flagReason">) => {
    row += 1;
    txns.push({
      id: `${ledgerId}-r${row}`,
      ledgerId,
      rowIndex: row,
      month: t.date.slice(0, 7),
      originalCategory: "",
      memo: "",
      balanceCents: null,
      confidence: 1,
      includedInNotice: t.systemClass === "rent",
      classReason: "Sample data",
      userOverrideClass: null,
      overrideReason: null,
      overriddenBy: null,
      flagged: false,
      flagReason: null,
      ...t,
    });
  };

  // Months that go unpaid: the last `monthsBehind` months of the history.
  const unpaidFrom = months.length - plan.monthsBehind;
  months.forEach((m, i) => {
    push({ date: `${m}-01`, description: "Monthly Rent", amountCents: rent, kind: "rent_charge", systemClass: "rent" });
    if (i < unpaidFrom) {
      // Paid month: on time (day 1–5) for most, occasionally late with a fee.
      const late = rng() < 0.12;
      const day = late ? 8 + Math.floor(rng() * 10) : 1 + Math.floor(rng() * 5);
      if (late) {
        push({ date: `${m}-06`, description: "Late Fee", amountCents: Math.round(rent * 0.05 / 100) * 100, kind: "non_rent_charge", systemClass: "late_fee" });
      }
      const method = pick(rng, ["Online Portal", "Check", "ACH", "Money Order"] as const);
      push({ date: `${m}-${String(day).padStart(2, "0")}`, description: `Rent Payment — ${method}`, amountCents: -rent, kind: "payment", systemClass: "payment" });
    } else {
      // Unpaid month: late fee, maybe a partial payment on the first one.
      push({ date: `${m}-06`, description: "Late Fee", amountCents: Math.round(rent * 0.05 / 100) * 100, kind: "non_rent_charge", systemClass: "late_fee" });
      if (i === unpaidFrom && rng() < 0.4) {
        const partial = Math.round(rent * (0.25 + rng() * 0.35) / 100) * 100;
        push({ date: `${m}-${String(10 + Math.floor(rng() * 12)).padStart(2, "0")}`, description: "Partial Rent Payment", amountCents: -partial, kind: "payment", systemClass: "payment" });
      }
    }
  });

  const ledger: Ledger = {
    id: ledgerId,
    tenantId: plan.tenant.id,
    name: `Sample ledger — ${months[0]} to ${months[months.length - 1]}`,
    sourceType: "manual",
    sourceFileName: null,
    vendor: "generic",
    mappingUsed: null,
    importedAt: GEN_TS,
    importedBy: null,
    transactionCount: txns.length,
    periodStart: txns[0]?.date ?? null,
    periodEnd: txns[txns.length - 1]?.date ?? null,
    notes: "Generated sample data",
  };
  return { ledger, txns };
}

function noticeMonth(m: string, rentCents: number, paidCents: number): NoticeMonth {
  const { start, end } = monthBounds(m);
  const rentOnly = Math.max(0, rentCents - paidCents);
  return {
    month: m,
    periodStart: start,
    periodEnd: end,
    rentChargedCents: rentCents,
    paymentsAppliedCents: paidCents,
    creditsAppliedCents: 0,
    rentOnlyBalanceCents: rentOnly,
    selectedAmountCents: rentOnly,
    overrideReason: null,
  };
}

const NOTICE_STATUS_MIX: NoticeStatus[] = [
  "draft", "draft", "draft",
  "needs_review", "needs_review",
  "reviewed", "reviewed",
  "finalized", "finalized",
  "served", "served", "served", "served",
  "mailed",
  "paid", "paid",
  "expired",
];

function buildSampleNotice(
  rng: () => number,
  plan: TenantPlan,
  ledgerId: string,
  months: NoticeMonth[],
  index: number,
  preparedBy: string,
): Notice {
  const status = NOTICE_STATUS_MIX[index % NOTICE_STATUS_MIX.length];
  const total = months.reduce((s, m) => s + m.selectedAmountCents, 0);
  const p = plan.property;
  const createdDay = 1 + Math.floor(rng() * 12);
  const createdAt = `2026-07-${String(createdDay).padStart(2, "0")}T16:00:00.000Z`;
  const servedDate = `2026-07-${String(createdDay + 1).padStart(2, "0")}`;
  const advanced = status === "served" || status === "mailed" || status === "paid" || status === "expired";
  const reviewed = advanced || status === "reviewed" || status === "finalized";
  const notice: Notice = {
    id: `${SAMPLE_ID_PREFIX}notice-${index + 1}`,
    noticeType: "pay_or_quit_3day",
    jurisdiction: "CA",
    status,
    tenantId: plan.tenant.id,
    propertyId: p.id,
    unit: plan.tenant.unit,
    tenantNames: [...plan.tenant.names],
    propertyAddress: [p.addressLine1, p.addressLine2, `${p.city}, ${p.state} ${p.zip}`].filter(Boolean).join(", "),
    ledgerId,
    months,
    totalAmountCents: total,
    prereqCompleted: {},
    ruleCardKey: null,
    electronicServiceConsent: false,
    payment: { ...p.payment },
    templateId: "tpl-ca-3day-pay",
    templateVersion: 1,
    includeLahdLetter: p.isLosAngelesCity,
    covenantDescription: "",
    entryDate: null,
    entryTimeWindow: "",
    entryReason: "",
    terminationDate: null,
    rentIncreaseNewAmountCents: null,
    rentIncreaseEffectiveDate: null,
    version: 1,
    revisedFromId: null,
    reviewerApprovedBy: reviewed ? preparedBy : null,
    reviewerApprovedAt: reviewed ? createdAt : null,
    finalizedBy: advanced || status === "finalized" ? preparedBy : null,
    finalizedAt: advanced || status === "finalized" ? createdAt : null,
    rentOnlyAttestedBy: null,
    rentOnlyAttestedAt: null,
    attorneyExportFlag: false,
    service: advanced
      ? {
          dateServed: servedDate,
          timeServed: `${9 + Math.floor(rng() * 8)}:${rng() < 0.5 ? "15" : "40"}`,
          method: pick(rng, ["personal", "substitute", "post_and_mail"] as const),
          servedBy: pick(rng, ["Jamie Chen", "Morgan Lee", "Field Agent"] as const),
          serverNotes: "",
          mailedDate: rng() < 0.5 ? servedDate : null,
        }
      : { dateServed: null, timeServed: null, method: null, servedBy: "", serverNotes: "", mailedDate: null },
    deadlineDate: advanced ? `2026-07-${String(Math.min(28, createdDay + 5)).padStart(2, "0")}` : null,
    internalNotes: "",
    preparedBy,
    createdAt,
    updatedAt: createdAt,
  };
  return notice;
}

export type SampleProgress = (step: string, done: number, total: number) => void;

/**
 * Insert the sample portfolio. Yields to the event loop between batches so
 * the UI can render progress. Never modifies non-sample rows.
 */
export async function loadSamplePortfolio(
  db: AppDatabase,
  preparedBy: string,
  options?: SampleDataOptions | null,
  onProgress?: SampleProgress,
): Promise<SamplePortfolioStats> {
  if (isSampleDataLoaded(db)) throw new Error("Sample data is already loaded.");
  const { properties, plans, months } = planSamplePortfolio(options);
  const rng = mulberry32(987654321);
  const yieldUi = () => new Promise((r) => setTimeout(r, 0));

  const totalSteps = properties.length + plans.length * 2 + 1;
  let done = 0;
  const report = (step: string) => onProgress?.(step, done, totalSteps);

  report("Creating properties…");
  db.transaction(() => {
    for (const p of properties) propertiesRepo.create(db, p);
  });
  done += properties.length;
  report("Creating tenants…");
  await yieldUi();

  db.transaction(() => {
    for (const plan of plans) tenantsRepo.create(db, plan.tenant);
  });
  done += plans.length;
  report("Generating rent ledgers…");
  await yieldUi();

  // Ledgers for everyone (ledgersRepo.create manages its own transaction).
  let txnCount = 0;
  const delinquent: { plan: TenantPlan; ledgerId: string }[] = [];
  const BATCH = 100;
  for (let i = 0; i < plans.length; i += BATCH) {
    for (let j = i; j < Math.min(i + BATCH, plans.length); j++) {
      const { ledger, txns } = buildLedger(rng, plans[j], j + 1, months);
      ledgersRepo.create(db, ledger, txns);
      txnCount += txns.length;
      if (plans[j].monthsBehind > 0) delinquent.push({ plan: plans[j], ledgerId: ledger.id });
      done += 1;
    }
    report("Generating rent ledgers…");
    await yieldUi();
  }

  report("Preparing notices…");
  // Notices for roughly two-thirds of delinquent tenants, assorted stages.
  const noticeTargets = delinquent.filter(() => rng() < 0.67);
  const notices: Notice[] = noticeTargets.map(({ plan, ledgerId }, i) => {
    const rent = plan.tenant.monthlyRentCents ?? 150000;
    const noticeMonths = months
      .slice(months.length - plan.monthsBehind)
      .map((m) => noticeMonth(m, rent, 0));
    return buildSampleNotice(rng, plan, ledgerId, noticeMonths, i, preparedBy);
  });
  db.transaction(() => {
    for (const n of notices) noticesRepo.create(db, n);
  });
  done = totalSteps - 1;
  report("Finishing up…");
  await yieldUi();

  appMetaRepo.set(db, SAMPLE_META_KEY, new Date().toISOString());
  await db.flush();
  done = totalSteps;
  report("Done");

  return {
    properties: properties.length,
    units: properties.reduce((s, p) => s + Math.max(1, p.units.length), 0),
    tenants: plans.length,
    ledgers: plans.length,
    transactions: txnCount,
    notices: notices.length,
  };
}

/**
 * Remove every sample-tagged record, including dependents that may have been
 * created from sample records after loading (documents, calculations, mail
 * tracking, field assignments tied to sample notices). Users, company,
 * settings, and license state are never touched.
 */
export async function removeSamplePortfolio(db: AppDatabase): Promise<void> {
  const like = `${SAMPLE_ID_PREFIX}%`;
  db.transaction(() => {
    db.run("DELETE FROM ledger_rows WHERE ledger_id LIKE ?", [like]);
    db.run("DELETE FROM calculations WHERE ledger_id LIKE ?", [like]);
    db.run("DELETE FROM ledgers WHERE id LIKE ?", [like]);
    db.run("DELETE FROM status_history WHERE notice_id LIKE ?", [like]);
    db.run("DELETE FROM validation_results WHERE notice_id LIKE ?", [like]);
    db.run("DELETE FROM documents WHERE notice_id LIKE ?", [like]);
    db.run("DELETE FROM mail_tracking WHERE notice_id LIKE ?", [like]);
    db.run(
      "DELETE FROM field_evidence WHERE assignment_id IN (SELECT id FROM field_assignments WHERE notice_id LIKE ?)",
      [like],
    );
    db.run("DELETE FROM field_assignments WHERE notice_id LIKE ?", [like]);
    db.run("DELETE FROM notices WHERE id LIKE ?", [like]);
    db.run(
      "DELETE FROM work_order_status_history WHERE work_order_id IN (SELECT id FROM work_orders WHERE tenant_id LIKE ? OR property_id LIKE ?)",
      [like, like],
    );
    db.run("DELETE FROM work_orders WHERE tenant_id LIKE ? OR property_id LIKE ?", [like, like]);
    db.run("DELETE FROM attachments WHERE entity_id LIKE ?", [like]);
    db.run("DELETE FROM tenants WHERE id LIKE ?", [like]);
    db.run("DELETE FROM properties WHERE id LIKE ?", [like]);
    db.run("DELETE FROM app_meta WHERE key = ?", [SAMPLE_META_KEY]);
  });
  await db.flush();
}
