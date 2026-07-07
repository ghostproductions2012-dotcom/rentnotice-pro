import type { ColumnMapping, MappingPreset, PmVendor } from "../types";
import type { VendorDetection } from "./types";
import { EMPTY_MAPPING } from "./types";

const PRESET_EPOCH = "1970-01-01T00:00:00.000Z";

function mk(partial: Partial<ColumnMapping>): ColumnMapping {
  return { ...EMPTY_MAPPING, ...partial };
}

// Built-in mapping presets for common property-management ledger exports.
// Header names reflect the columns these platforms actually export.
export const BUILTIN_PRESETS: MappingPreset[] = [
  {
    id: "preset-appfolio",
    name: "AppFolio — Tenant Ledger",
    vendor: "appfolio",
    mapping: mk({
      date: "Date",
      transactionType: "Type",
      description: "Description",
      chargeAmount: "Charge",
      paymentAmount: "Payment",
      balance: "Balance",
      memo: "Reference",
    }),
    createdAt: PRESET_EPOCH,
  },
  {
    id: "preset-buildium",
    name: "Buildium — Rental Ledger",
    vendor: "buildium",
    mapping: mk({
      date: "Date",
      transactionType: "Transaction Type",
      description: "Memo",
      category: "Account",
      amount: "Amount",
      balance: "Balance",
      memo: "Reference Number",
    }),
    createdAt: PRESET_EPOCH,
  },
  {
    id: "preset-yardi",
    name: "Yardi Voyager — Resident Ledger",
    vendor: "yardi",
    mapping: mk({
      date: "Post Date",
      transactionType: "Trans Type",
      category: "Charge Code",
      description: "Description",
      chargeAmount: "Charges",
      paymentAmount: "Payments",
      balance: "Balance",
      memo: "Notes",
    }),
    createdAt: PRESET_EPOCH,
  },
  {
    id: "preset-propertyware",
    name: "Propertyware — Tenant Ledger",
    vendor: "propertyware",
    mapping: mk({
      date: "Date",
      transactionType: "Type",
      description: "Description",
      category: "Account",
      chargeAmount: "Charges",
      paymentAmount: "Payments",
      balance: "Unpaid Balance",
      memo: "Reference",
    }),
    createdAt: PRESET_EPOCH,
  },
  {
    id: "preset-rent-manager",
    name: "Rent Manager — Tenant History",
    vendor: "rent_manager",
    mapping: mk({
      date: "Date",
      transactionType: "Transaction Type",
      description: "Description",
      chargeAmount: "Charge Amount",
      paymentAmount: "Payment Amount",
      balance: "Balance",
      memo: "Comment",
      category: "Account",
    }),
    createdAt: PRESET_EPOCH,
  },
  {
    // First Light Property Management, Inc. "Tenant Statement" export. A single
    // signed Amount column (charges positive, payments negative), a free-text
    // Description ("Rent", "EFT fee", "by <tenant>", "Security deposit", …) and
    // a running Balance. Matches the ledgers used by the first customer.
    id: "preset-first-light",
    name: "First Light PM — Tenant Statement",
    vendor: "first_light",
    mapping: mk({
      date: "Date",
      description: "Description",
      amount: "Amount",
      balance: "Balance",
    }),
    createdAt: PRESET_EPOCH,
  },
];

function normalizeHeaderName(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const VENDOR_SIGNATURES: { vendor: PmVendor; headers: string[] }[] = BUILTIN_PRESETS.map((preset) => ({
  vendor: preset.vendor,
  headers: Object.values(preset.mapping).filter((v): v is string => !!v),
}));

/** Detect the most likely PM vendor from a set of source column headers. */
export function detectVendor(headers: string[]): VendorDetection {
  const present = new Set(headers.map(normalizeHeaderName));
  let best: { vendor: PmVendor; confidence: number } = { vendor: "generic", confidence: 0 };

  for (const signature of VENDOR_SIGNATURES) {
    const sigHeaders = signature.headers.map(normalizeHeaderName);
    if (sigHeaders.length === 0) continue;
    const matched = sigHeaders.filter((h) => present.has(h)).length;
    const confidence = Math.round((matched / sigHeaders.length) * 100);
    if (matched >= 2 && confidence > best.confidence) {
      best = { vendor: signature.vendor, confidence };
    }
  }

  const preset = best.vendor === "generic" ? null : (BUILTIN_PRESETS.find((p) => p.vendor === best.vendor) ?? null);
  return { vendor: best.vendor, confidence: best.confidence, preset };
}

export function getPreset(vendor: PmVendor): MappingPreset | null {
  return BUILTIN_PRESETS.find((p) => p.vendor === vendor) ?? null;
}
