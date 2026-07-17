// ---------------------------------------------------------------------------
// Buildium → local workspace sync.
//
// Runs entirely in the browser: fetches rentals, units, active leases,
// outstanding balances, and lease transactions through the api-server proxy,
// then writes into the local database via the AppServices layer.
//
//   property  ↔ Buildium rental  (externalId = rental Id)
//   tenant    ↔ Buildium lease   (externalId = lease Id)
//   ledger    — append-only: each sync imports a fresh "api"-sourced ledger
//               for every lease that has an outstanding balance, so existing
//               notices keep pointing at the ledger they were built from.
// ---------------------------------------------------------------------------

import type { BuildiumRecord } from "@workspace/api-client-react";
import { getServices } from "@/lib/api/services";
import type { Id, ManualTransactionInput } from "@/lib/types";
import {
  type BuildiumCredentials,
  fetchAllPages,
  listLeases,
  listLeaseTransactions,
  listOutstandingBalances,
  listRentals,
  listUnits,
} from "./client";

export const BUILDIUM_SOURCE = "buildium";

export type BuildiumSyncPhase =
  | "rentals"
  | "units"
  | "properties"
  | "leases"
  | "tenants"
  | "balances"
  | "ledgers"
  | "finalize";

export interface BuildiumSyncProgress {
  phase: BuildiumSyncPhase;
  message: string;
  current?: number;
  total?: number;
}

export interface ImportedLedgerRef {
  tenantId: Id;
  ledgerId: Id;
  tenantNames: string[];
  balanceCents: number;
}

export interface BuildiumSyncSummary {
  propertiesCreated: number;
  propertiesUpdated: number;
  tenantsCreated: number;
  tenantsUpdated: number;
  ledgersImported: number;
  /** One entry per imported ledger — lets the UI offer "create notice" shortcuts. */
  importedLedgers: ImportedLedgerRef[];
  warnings: string[];
}

// ------------------------- defensive record access --------------------------

function str(record: BuildiumRecord | undefined, key: string): string {
  const v = record?.[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
}

function num(record: BuildiumRecord | undefined, key: string): number | null {
  const v = record?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function obj(record: BuildiumRecord | undefined, key: string): BuildiumRecord | undefined {
  const v = record?.[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as BuildiumRecord) : undefined;
}

function arr(record: BuildiumRecord | undefined, key: string): BuildiumRecord[] {
  const v = record?.[key];
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as BuildiumRecord[]) : [];
}

function isoDate(value: string): string | null {
  const m = value.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

// ------------------------------ field mapping -------------------------------

function tenantNames(lease: BuildiumRecord): string[] {
  const current = arr(lease, "CurrentTenants");
  const names = current
    .map((t) => `${str(t, "FirstName")} ${str(t, "LastName")}`.trim())
    .filter(Boolean);
  if (names.length) return names;
  // Fall back to the Tenants stubs (id-only on some plans) — nothing usable.
  return [];
}

function tenantContact(lease: BuildiumRecord): { email: string; phone: string } {
  const first = arr(lease, "CurrentTenants")[0];
  if (!first) return { email: "", phone: "" };
  const email = str(first, "Email");
  const phones = first["PhoneNumbers"];
  let phone = "";
  if (Array.isArray(phones)) {
    const p = phones.find((x) => x && typeof x === "object" && (x as BuildiumRecord)["Number"]);
    phone = p ? str(p as BuildiumRecord, "Number") : "";
  } else if (phones && typeof phones === "object") {
    const p = phones as BuildiumRecord;
    phone = str(p, "Cell") || str(p, "Home") || str(p, "Work");
  }
  return { email, phone };
}

/** Payments and credits reduce what is owed — normalize them to negative. */
function transactionAmountCents(txn: BuildiumRecord): number | null {
  const amount = num(txn, "TotalAmount");
  if (amount == null) return null;
  const cents = Math.round(Math.abs(amount) * 100);
  if (cents === 0) return null;
  const type = str(txn, "TransactionType").toLowerCase();
  const isCredit =
    (type.includes("payment") && !type.includes("reverse")) ||
    type === "credit" ||
    type === "applieddeposit" ||
    type.includes("apply deposit");
  return isCredit ? -cents : cents;
}

function toManualTransaction(txn: BuildiumRecord): ManualTransactionInput | null {
  const date = isoDate(str(txn, "Date"));
  const amountCents = transactionAmountCents(txn);
  if (!date || amountCents == null) return null;
  const journal = obj(txn, "Journal");
  const firstLine = journal ? arr(journal, "Lines")[0] : undefined;
  const glName = firstLine ? str(obj(firstLine, "GLAccount"), "Name") : "";
  const type = str(txn, "TransactionType");
  return {
    date,
    description: (journal ? str(journal, "Memo") : "") || glName || type || "Transaction",
    category: glName || type,
    amountCents,
    memo: str(txn, "CheckNumber") ? `Check ${str(txn, "CheckNumber")}` : "",
  };
}

// --------------------------------- sync -------------------------------------

export async function runBuildiumSync(
  creds: BuildiumCredentials,
  onProgress: (p: BuildiumSyncProgress) => void,
): Promise<BuildiumSyncSummary> {
  const services = getServices();
  const summary: BuildiumSyncSummary = {
    propertiesCreated: 0,
    propertiesUpdated: 0,
    tenantsCreated: 0,
    tenantsUpdated: 0,
    ledgersImported: 0,
    importedLedgers: [],
    warnings: [],
  };

  // 1. Rental properties + units --------------------------------------------
  onProgress({ phase: "rentals", message: "Fetching rental properties from Buildium…" });
  const rentals = await fetchAllPages((limit, offset) => listRentals(creds, { limit, offset }));

  onProgress({ phase: "units", message: "Fetching units…" });
  const units = await fetchAllPages((limit, offset) => listUnits(creds, { limit, offset }));
  const unitLabels = new Map<string, string[]>();
  for (const unit of units) {
    const propertyId = str(unit, "PropertyId");
    const label = str(unit, "UnitNumber");
    if (!propertyId || !label) continue;
    const list = unitLabels.get(propertyId) ?? [];
    list.push(label);
    unitLabels.set(propertyId, list);
  }

  const propertyIdByRental = new Map<string, Id>();
  let done = 0;
  for (const rental of rentals) {
    const rentalId = str(rental, "Id");
    if (!rentalId) continue;
    const address = obj(rental, "Address");
    const nickname = str(rental, "Name") || str(address, "AddressLine1") || `Buildium ${rentalId}`;
    const { property, created } = await services.upsertExternalProperty({
      externalSource: BUILDIUM_SOURCE,
      externalId: rentalId,
      nickname,
      addressLine1: str(address, "AddressLine1"),
      addressLine2: str(address, "AddressLine2"),
      city: str(address, "City"),
      state: str(address, "State"),
      zip: str(address, "PostalCode"),
      units: (unitLabels.get(rentalId) ?? []).sort(),
      ownerName: "",
    });
    propertyIdByRental.set(rentalId, property.id);
    if (created) summary.propertiesCreated += 1;
    else summary.propertiesUpdated += 1;
    done += 1;
    onProgress({
      phase: "properties",
      message: `Importing properties (${done} of ${rentals.length})…`,
      current: done,
      total: rentals.length,
    });
  }

  // 2. Active leases → tenants ----------------------------------------------
  onProgress({ phase: "leases", message: "Fetching active leases…" });
  const leases = await fetchAllPages((limit, offset) =>
    listLeases(creds, { limit, offset, leasestatuses: ["Active"] }),
  );

  const tenantByLease = new Map<string, { id: Id; names: string[] }>();
  done = 0;
  for (const lease of leases) {
    const leaseId = str(lease, "Id");
    done += 1;
    if (!leaseId) continue;
    const names = tenantNames(lease);
    if (!names.length) {
      summary.warnings.push(`Lease ${leaseId} skipped: Buildium returned no tenant names.`);
      continue;
    }
    const account = obj(lease, "AccountDetails");
    const rent = num(account, "Rent");
    const { email, phone } = tenantContact(lease);
    const { tenant, created } = await services.upsertExternalTenant({
      externalSource: BUILDIUM_SOURCE,
      externalId: leaseId,
      names,
      propertyId: propertyIdByRental.get(str(lease, "PropertyId")) ?? null,
      unit: str(lease, "UnitNumber"),
      email,
      phone,
      monthlyRentCents: rent != null ? Math.round(rent * 100) : null,
      leaseStart: isoDate(str(lease, "LeaseFromDate")),
    });
    tenantByLease.set(leaseId, { id: tenant.id, names: tenant.names });
    if (created) summary.tenantsCreated += 1;
    else summary.tenantsUpdated += 1;
    onProgress({
      phase: "tenants",
      message: `Importing tenants (${done} of ${leases.length})…`,
      current: done,
      total: leases.length,
    });
  }

  // 3. Outstanding balances → ledgers ----------------------------------------
  onProgress({ phase: "balances", message: "Checking outstanding balances…" });
  const balances = await fetchAllPages((limit, offset) =>
    listOutstandingBalances(creds, { limit, offset }),
  );
  const owing = balances.filter((b) => {
    const total = num(b, "TotalBalance");
    return total != null && total > 0 && tenantByLease.has(str(b, "LeaseId"));
  });

  const syncDate = new Date().toISOString().slice(0, 10);
  done = 0;
  for (const balance of owing) {
    const leaseId = str(balance, "LeaseId");
    const tenantRef = tenantByLease.get(leaseId);
    done += 1;
    if (!tenantRef) continue;
    onProgress({
      phase: "ledgers",
      message: `Importing ledgers (${done} of ${owing.length})…`,
      current: done,
      total: owing.length,
    });
    const txns = await fetchAllPages((limit, offset) =>
      listLeaseTransactions(creds, Number(leaseId), { limit, offset }),
    );
    const manualTransactions = txns
      .map(toManualTransaction)
      .filter((t): t is ManualTransactionInput => t !== null)
      .sort((a, b) => a.date.localeCompare(b.date));
    if (!manualTransactions.length) {
      summary.warnings.push(
        `Lease ${leaseId} has an outstanding balance but Buildium returned no usable transactions.`,
      );
      continue;
    }
    const ledger = await services.importLedger({
      tenantId: tenantRef.id,
      name: `Buildium sync ${syncDate}`,
      sourceType: "api",
      fileName: null,
      vendor: "buildium",
      mapping: null,
      rows: [],
      manualTransactions,
    });
    summary.ledgersImported += 1;
    summary.importedLedgers.push({
      tenantId: tenantRef.id,
      ledgerId: ledger.id,
      tenantNames: tenantRef.names,
      balanceCents: Math.round((num(balance, "TotalBalance") ?? 0) * 100),
    });
  }

  // 4. Record the sync time ---------------------------------------------------
  onProgress({ phase: "finalize", message: "Finishing up…" });
  await services.updateSettings({ buildiumLastSyncAt: new Date().toISOString() });

  return summary;
}
