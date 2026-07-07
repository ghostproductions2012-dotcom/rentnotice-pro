import type {
  ColumnMapping,
  LedgerSourceType,
  MappingPreset,
  PmVendor,
} from "../types";

export interface RawTable {
  headers: string[];
  rows: string[][];
}

export type LedgerField = keyof ColumnMapping;

export interface ColumnAnalysis {
  header: string;
  index: number;
  field: LedgerField | null;
  confidence: number;
}

export type AmountMode = "single" | "split" | "unknown";

export interface MappingSuggestion {
  mapping: ColumnMapping;
  columns: ColumnAnalysis[];
  columnConfidence: Record<string, number>;
  amountMode: AmountMode;
  warnings: string[];
}

export interface NormalizedTransaction {
  rowIndex: number;
  date: string;
  month: string;
  description: string;
  originalCategory: string;
  memo: string;
  transactionType: string;
  tenantIdentifier: string;
  amountCents: number;
  balanceCents: number | null;
  warnings: string[];
}

export interface NormalizeResult {
  rows: NormalizedTransaction[];
  warnings: string[];
  periodStart: string | null;
  periodEnd: string | null;
}

export interface ParseResult {
  table: RawTable;
  sourceType: LedgerSourceType;
  warnings: string[];
  ocrUsed: boolean;
  lines: string[];
}

export interface VendorDetection {
  vendor: PmVendor;
  confidence: number;
  preset: MappingPreset | null;
}

export interface OcrProgress {
  status: string;
  progress: number;
  page?: number;
  pageCount?: number;
}

export const EMPTY_MAPPING: ColumnMapping = {
  date: null,
  description: null,
  chargeAmount: null,
  paymentAmount: null,
  creditAmount: null,
  amount: null,
  balance: null,
  transactionType: null,
  category: null,
  memo: null,
  month: null,
  tenantIdentifier: null,
};

export const MAPPING_FIELDS: LedgerField[] = [
  "date",
  "description",
  "chargeAmount",
  "paymentAmount",
  "creditAmount",
  "amount",
  "balance",
  "transactionType",
  "category",
  "memo",
  "month",
  "tenantIdentifier",
];
