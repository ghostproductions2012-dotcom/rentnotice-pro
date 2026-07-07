import type { ColumnMapping } from "../types";
import type { AmountMode, ColumnAnalysis, LedgerField, MappingSuggestion, RawTable } from "./types";
import { EMPTY_MAPPING, MAPPING_FIELDS } from "./types";
import { looksLikeMoney, parseMoneyToCents } from "./money";
import { parseDateToIso, parseMonthToIso } from "./dates";

// Header keyword hints per logical field. Multi-word hints are matched as
// substrings; single words are matched as whole tokens (with a weaker
// substring fallback).
const HEADER_HINTS: Record<LedgerField, string[]> = {
  date: ["date", "posted", "post date", "transaction date", "trans date", "txn date", "entry date"],
  description: [
    "description",
    "desc",
    "detail",
    "details",
    "narrative",
    "particulars",
    "transaction",
    "item",
    "line item",
  ],
  chargeAmount: ["charge", "charges", "debit", "debits", "bill", "billed", "amount due", "invoice", "charge amount"],
  paymentAmount: ["payment", "payments", "paid", "receipt", "received", "payment amount", "amount paid"],
  creditAmount: ["credit", "credits", "adjustment", "adjustments", "concession", "credit amount"],
  amount: ["amount", "amt", "transaction amount", "net", "net amount", "value", "total"],
  balance: [
    "balance",
    "running balance",
    "bal",
    "outstanding",
    "ending balance",
    "unpaid balance",
    "balance due",
    "running total",
  ],
  transactionType: ["type", "transaction type", "txn type", "trans type", "kind", "dr/cr", "debit/credit", "entry type"],
  category: [
    "category",
    "account",
    "gl",
    "gl account",
    "account name",
    "chart",
    "code",
    "chg code",
    "charge code",
    "class",
    "gl code",
  ],
  memo: ["memo", "reference", "ref", "reference number", "note", "notes", "comment", "comments", "remark", "remarks"],
  month: ["month", "period", "billing period", "rent period"],
  tenantIdentifier: [
    "tenant",
    "resident",
    "resident id",
    "tenant id",
    "unit",
    "unit id",
    "lease",
    "lease id",
    "customer",
    "payer",
    "account id",
    "occupant",
  ],
};

const MONEY_FIELDS: LedgerField[] = ["chargeAmount", "paymentAmount", "creditAmount", "amount", "balance"];
const TEXT_FIELDS: LedgerField[] = ["description", "memo", "category", "transactionType", "tenantIdentifier"];

interface ColumnStat {
  index: number;
  header: string;
  sampleCount: number;
  dateFrac: number;
  moneyFrac: number;
  monthFrac: number;
  negFrac: number;
  textFrac: number;
}

function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[_\-/.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headerFieldScore(header: string, field: LedgerField): number {
  const h = normalizeHeader(header);
  if (!h) return 0;
  const tokens = h.split(" ");
  let best = 0;
  for (const kwRaw of HEADER_HINTS[field]) {
    const kw = kwRaw.toLowerCase();
    if (h === kw) {
      best = Math.max(best, 100);
      continue;
    }
    if (kw.includes(" ")) {
      if (h.includes(kw)) best = Math.max(best, 90);
    } else if (tokens.includes(kw)) {
      best = Math.max(best, 88);
    } else if (h.includes(kw)) {
      best = Math.max(best, 74);
    }
  }
  return best;
}

function computeStat(header: string, index: number, rows: string[][]): ColumnStat {
  const samples: string[] = [];
  for (const row of rows) {
    const value = (row[index] ?? "").trim();
    if (value !== "") samples.push(value);
    if (samples.length >= 40) break;
  }
  const denom = samples.length || 1;
  let dates = 0;
  let money = 0;
  let months = 0;
  let negatives = 0;
  let text = 0;
  for (const value of samples) {
    const isDate = parseDateToIso(value) !== null;
    const isMoney = looksLikeMoney(value);
    const isMonth = !isDate && parseMonthToIso(value) !== null;
    if (isDate) dates++;
    if (isMoney) {
      money++;
      const cents = parseMoneyToCents(value);
      if (cents !== null && cents < 0) negatives++;
    }
    if (isMonth) months++;
    if (!isDate && !isMoney && !isMonth && /[a-z]/i.test(value)) text++;
  }
  return {
    index,
    header,
    sampleCount: samples.length,
    dateFrac: dates / denom,
    moneyFrac: money / denom,
    monthFrac: months / denom,
    negFrac: money ? negatives / money : 0,
    textFrac: text / denom,
  };
}

function contentFieldScore(field: LedgerField, st: ColumnStat): number {
  if (st.sampleCount === 0) return 0;
  switch (field) {
    case "date":
      return st.dateFrac >= 0.6 ? 60 + 30 * st.dateFrac : 0;
    case "month":
      return st.monthFrac >= 0.6 ? 55 + 25 * st.monthFrac : 0;
    case "amount": {
      if (st.moneyFrac < 0.6) return 0;
      const signed = st.negFrac >= 0.15 && st.negFrac <= 0.9;
      return (signed ? 70 : 48) + 20 * st.moneyFrac;
    }
    case "chargeAmount":
      if (st.moneyFrac < 0.6) return 0;
      return (st.negFrac < 0.1 ? 52 : 40) + 20 * st.moneyFrac;
    case "paymentAmount":
      if (st.moneyFrac < 0.6) return 0;
      return (st.negFrac < 0.1 ? 46 : 38) + 18 * st.moneyFrac;
    case "creditAmount":
      if (st.moneyFrac < 0.6) return 0;
      return 34 + 15 * st.moneyFrac;
    case "balance":
      if (st.moneyFrac < 0.6) return 0;
      return 42 + 18 * st.moneyFrac;
    case "description":
    case "memo":
    case "category":
    case "tenantIdentifier":
      return st.textFrac >= 0.5 && st.moneyFrac < 0.3 && st.dateFrac < 0.3 ? 25 + 15 * st.textFrac : 0;
    case "transactionType":
      return st.textFrac >= 0.4 && st.moneyFrac < 0.2 ? 20 + 10 * st.textFrac : 0;
    default:
      return 0;
  }
}

function pairScore(field: LedgerField, st: ColumnStat): number {
  const hs = headerFieldScore(st.header, field);
  const cs = contentFieldScore(field, st);
  const isMoney = MONEY_FIELDS.includes(field);

  if (hs > 0) {
    // Header claims a typed field but the data contradicts it: heavily damp.
    if (isMoney && st.sampleCount > 0 && st.moneyFrac < 0.3) return hs * 0.45;
    if (field === "date" && st.sampleCount > 0 && st.dateFrac < 0.3) return hs * 0.45;
    if (field === "month" && st.sampleCount > 0 && st.monthFrac < 0.3 && st.dateFrac < 0.3) return hs * 0.5;
    if (cs > 0) return Math.min(100, Math.max(hs, cs) + 8);
    return hs;
  }

  // No header hint: rely on content, but text fields are too ambiguous without one.
  if (cs > 0) {
    if (TEXT_FIELDS.includes(field)) return cs * 0.4;
    return cs * 0.75;
  }
  return 0;
}

function decideAmountMode(mapping: ColumnMapping): AmountMode {
  const hasCharge = !!mapping.chargeAmount;
  const hasPayment = !!mapping.paymentAmount || !!mapping.creditAmount;
  const hasAmount = !!mapping.amount;
  if (hasCharge && hasPayment) return "split";
  if (hasAmount) return "single";
  if (hasCharge || hasPayment) return "split";
  return "unknown";
}

/**
 * Suggest a column mapping for a RawTable using header keyword heuristics
 * combined with sample-row content analysis. Produces per-column confidence
 * (0-100) and detects single-signed vs split charge/payment layouts.
 */
export function suggestMapping(table: RawTable): MappingSuggestion {
  const stats = table.headers.map((header, index) => computeStat(header, index, table.rows));

  // Score every (column, field) pair, then greedily assign so each column and
  // each field is used at most once (highest scoring pairs win first).
  const pairs: { col: number; field: LedgerField; score: number }[] = [];
  for (const st of stats) {
    for (const field of MAPPING_FIELDS) {
      const score = pairScore(field, st);
      if (score > 0) pairs.push({ col: st.index, field, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  const usedCols = new Set<number>();
  const usedFields = new Set<LedgerField>();
  const colField: (LedgerField | null)[] = table.headers.map(() => null);
  const colConf: number[] = table.headers.map(() => 0);

  for (const pair of pairs) {
    if (usedCols.has(pair.col) || usedFields.has(pair.field)) continue;
    mapping[pair.field] = table.headers[pair.col];
    usedCols.add(pair.col);
    usedFields.add(pair.field);
    colField[pair.col] = pair.field;
    colConf[pair.col] = Math.round(Math.min(100, pair.score));
  }

  const amountMode = decideAmountMode(mapping);

  const warnings: string[] = [];
  if (!mapping.date && !mapping.month) {
    warnings.push("No date column was detected — a date is required for calculations.");
  }
  if (amountMode === "unknown") {
    warnings.push("Could not detect a charge/payment or amount column.");
  }
  if (!mapping.description) {
    warnings.push("No description column was detected.");
  }
  if (mapping.amount && (mapping.chargeAmount || mapping.paymentAmount || mapping.creditAmount)) {
    warnings.push("Both a single amount column and split charge/payment columns were detected; split columns will be used.");
  }

  const columns: ColumnAnalysis[] = stats.map((st) => ({
    header: st.header,
    index: st.index,
    field: colField[st.index],
    confidence: colConf[st.index],
  }));

  const columnConfidence: Record<string, number> = {};
  for (const st of stats) {
    columnConfidence[st.header] = colConf[st.index];
  }

  return { mapping, columns, columnConfidence, amountMode, warnings };
}
