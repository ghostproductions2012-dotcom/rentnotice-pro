// ---------------------------------------------------------------------------
// Rent classification engine.
//
// Keyword-based, deterministic classifier that maps a raw ledger row to a
// RentClass (see ../types) plus a 0-100 confidence score, an explanation, and
// a "needs review" flag. Non-rent fee keywords always win over the generic
// "rent" keyword so late fees, pet rent, etc. are never silently counted as
// rent (spec §5, §17 "Never hide exclusions").
// ---------------------------------------------------------------------------

import type { RentClass, TxnKind } from "../types";

// --------------------------- tuning constants ------------------------------

/** Rows at or below this confidence must be manually reviewed. */
export const NEEDS_REVIEW_THRESHOLD = 60;

const CONF_SIGN_MONEY_IN = 95; // negative amount confirms a payment/credit
const CONF_CATEGORY_BOOST = 4; // matched keyword also present in category column
const CONF_MAX = 99;
const CONF_UNCLASSIFIED = 30;

// ------------------------------- keyword map -------------------------------

interface KeywordRule {
  cls: RentClass;
  confidence: number;
  /** Ordered longest/most-specific first for readable reasons. */
  words: string[];
}

/**
 * Priority-ordered rules. The FIRST rule with any matching keyword wins, so
 * more specific / non-rent classes are listed before the generic "rent" rule.
 * This is the documented tie-breaker: fee keywords beat rent keywords.
 */
const KEYWORD_RULES: KeywordRule[] = [
  { cls: "nsf_fee", confidence: 95, words: ["nsf", "non sufficient funds", "insufficient funds", "returned check", "returned payment", "bounced check", "bounced", "r c"] },
  { cls: "late_fee", confidence: 93, words: ["late fee", "late charge", "late rent fee", "late payment fee", "latefee", "late"] },
  { cls: "court_cost", confidence: 92, words: ["court cost", "court costs", "court fee", "filing fee", "writ", "sheriff", "process server"] },
  { cls: "legal_fee", confidence: 92, words: ["legal fee", "legal", "attorney", "eviction fee"] },
  { cls: "rubs", confidence: 92, words: ["rubs", "ratio utility", "utility billing"] },
  { cls: "utility", confidence: 90, words: ["utility", "utilities", "water", "sewer", "trash", "garbage", "electric", "electricity", "gas", "cam", "common area"] },
  { cls: "maintenance", confidence: 88, words: ["maintenance", "service call", "labor charge"] },
  { cls: "repair", confidence: 88, words: ["repair", "repairs"] },
  { cls: "damage", confidence: 88, words: ["damage", "damages"] },
  { cls: "deposit", confidence: 92, words: ["security deposit", "security dep", "sec dep", "deposit"] },
  { cls: "pet_fee", confidence: 91, words: ["pet fee", "pet rent", "pet deposit", "pet"] },
  { cls: "parking_fee", confidence: 90, words: ["parking", "garage", "carport"] },
  { cls: "storage_fee", confidence: 90, words: ["storage", "locker"] },
  { cls: "application_fee", confidence: 90, words: ["application fee", "application", "app fee", "screening", "background check", "credit check"] },
  { cls: "admin_fee", confidence: 88, words: ["administrative fee", "admin fee", "administrative", "admin", "processing fee", "convenience fee", "eft fee", "eft convenience fee", "ach fee", "e check fee", "echeck fee", "electronic payment fee"] },
  { cls: "hoa", confidence: 90, words: ["hoa", "homeowners association", "homeowner", "association due", "association dues"] },
  { cls: "insurance", confidence: 90, words: ["insurance", "renters ins", "liability ins"] },
  { cls: "payment", confidence: 88, words: ["payment", "rent payment", "pmt", "paid", "received", "e check", "ach", "eft", "auto pay", "autopay", "money order", "cashier"] },
  { cls: "credit", confidence: 86, words: ["credit", "concession", "discount", "waiver", "waived", "abatement", "rent credit"] },
  { cls: "rent", confidence: 88, words: ["base rent", "monthly rent", "apartment rent", "residential rent", "housing rent", "prorated rent", "pro rata rent", "rent charge", "rent"] },
];

const KIND_BY_CLASS: Record<RentClass, TxnKind> = {
  rent: "rent_charge",
  late_fee: "non_rent_charge",
  nsf_fee: "non_rent_charge",
  utility: "non_rent_charge",
  maintenance: "non_rent_charge",
  legal_fee: "non_rent_charge",
  deposit: "deposit",
  pet_fee: "non_rent_charge",
  parking_fee: "non_rent_charge",
  storage_fee: "non_rent_charge",
  application_fee: "non_rent_charge",
  admin_fee: "non_rent_charge",
  rubs: "non_rent_charge",
  hoa: "non_rent_charge",
  insurance: "non_rent_charge",
  repair: "non_rent_charge",
  damage: "non_rent_charge",
  court_cost: "non_rent_charge",
  other_non_rent: "non_rent_charge",
  payment: "payment",
  credit: "credit",
  unclassified: "unknown",
};

// ------------------------------- public API --------------------------------

export interface ClassificationInput {
  description: string;
  category?: string;
  memo?: string;
  transactionType?: string;
  /** Optional signed cents. Negative = money in (payment/credit) and is authoritative. */
  amountCents?: number | null;
}

export interface ClassificationResult {
  /** The RentClass bucket (matches LedgerTransaction.systemClass). */
  category: RentClass;
  /** The natural transaction kind (matches LedgerTransaction.kind). */
  kind: TxnKind;
  /** 0-100 confidence in the classification. */
  confidence: number;
  /** Whether the row should be included in a rent-only notice by default. */
  includedInNotice: boolean;
  /** True when confidence is below threshold or the row is unclassified. */
  needsReview: boolean;
  /** Plain-English explanation of the decision. */
  reason: string;
  /** The keyword that produced the match, if any. */
  matchedKeyword: string | null;
}

/** Normalize free text into space-delimited alphanumeric tokens for matching. */
function normalize(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function containsKeyword(normalizedText: string, keyword: string): boolean {
  const kw = keyword.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!kw) return false;
  return normalizedText.includes(` ${kw} `);
}

function clampConfidence(n: number): number {
  return Math.max(0, Math.min(CONF_MAX, Math.round(n)));
}

function firstMatch(normalizedText: string): { rule: KeywordRule; keyword: string } | null {
  for (const rule of KEYWORD_RULES) {
    for (const w of rule.words) {
      if (containsKeyword(normalizedText, w)) return { rule, keyword: w };
    }
  }
  return null;
}

/**
 * Classify a single ledger row into a RentClass + confidence. Pure and
 * deterministic — identical inputs always yield identical output.
 */
export function classifyRow(input: ClassificationInput): ClassificationResult {
  const combined = [input.description, input.category, input.memo, input.transactionType]
    .filter((x): x is string => !!x)
    .join(" ");
  const text = normalize(combined);
  const categoryText = input.category ? normalize(input.category) : " ";

  // A negative amount is authoritative: money flowed IN (payment/credit/etc.).
  const amount = input.amountCents;
  if (amount != null && amount < 0) {
    const moneyIn = classifyMoneyIn(text);
    return finalize(moneyIn.cls, moneyIn.kind, CONF_SIGN_MONEY_IN, moneyIn.keyword, categoryText, moneyIn.reason);
  }

  const match = firstMatch(text);
  if (!match) {
    return {
      category: "unclassified",
      kind: "unknown",
      confidence: CONF_UNCLASSIFIED,
      includedInNotice: false,
      needsReview: true,
      reason: "No classification keyword matched — manual review required.",
      matchedKeyword: null,
    };
  }

  const { rule, keyword } = match;
  const kind =
    rule.cls === "payment" || rule.cls === "credit"
      ? classifyMoneyIn(text).kind
      : KIND_BY_CLASS[rule.cls];
  const reason = `Matched keyword "${keyword}" → classified as ${rule.cls}.`;
  return finalize(rule.cls, kind, rule.confidence, keyword, categoryText, reason);
}

/** Convenience wrapper for callers that only have loose strings. */
export function classifyDescription(
  description: string,
  category = "",
  memo = "",
): ClassificationResult {
  return classifyRow({ description, category, memo });
}

/** Refine money-in rows into payment/credit/refund/reversal/void/adjustment. */
function classifyMoneyIn(normalizedText: string): {
  cls: RentClass;
  kind: TxnKind;
  keyword: string;
  reason: string;
} {
  const has = (w: string) => containsKeyword(normalizedText, w);
  if (has("refund")) return { cls: "credit", kind: "refund", keyword: "refund", reason: "Refund of funds to tenant." };
  if (has("reversal") || has("reverse") || has("chargeback"))
    return { cls: "credit", kind: "reversal", keyword: "reversal", reason: "Reversal of a prior charge/payment." };
  if (has("void")) return { cls: "credit", kind: "void", keyword: "void", reason: "Voided transaction." };
  if (has("adjustment") || has("adjust") || has("correction"))
    return { cls: "credit", kind: "adjustment", keyword: "adjustment", reason: "Ledger adjustment/correction." };
  if (has("credit") || has("concession") || has("discount") || has("waiver") || has("waived") || has("abatement"))
    return { cls: "credit", kind: "credit", keyword: "credit", reason: "Credit applied to the account." };
  return { cls: "payment", kind: "payment", keyword: "payment", reason: "Payment received (money in)." };
}

function finalize(
  cls: RentClass,
  kind: TxnKind,
  baseConfidence: number,
  keyword: string | null,
  categoryText: string,
  reason: string,
): ClassificationResult {
  let confidence = baseConfidence;
  if (keyword && containsKeyword(categoryText, keyword)) confidence += CONF_CATEGORY_BOOST;
  confidence = clampConfidence(confidence);
  return {
    category: cls,
    kind,
    confidence,
    includedInNotice: cls === "rent",
    needsReview: cls === "unclassified" || confidence < NEEDS_REVIEW_THRESHOLD,
    reason,
    matchedKeyword: keyword,
  };
}

/** Exposed for UI hints / tests: the keyword lists used by the classifier. */
export function classificationKeywords(): { cls: RentClass; words: string[] }[] {
  return KEYWORD_RULES.map((r) => ({ cls: r.cls, words: [...r.words] }));
}

/** Convert a 0-100 confidence into the 0..1 scale used by LedgerTransaction. */
export function confidenceToUnit(confidence0to100: number): number {
  return Math.max(0, Math.min(1, confidence0to100 / 100));
}
