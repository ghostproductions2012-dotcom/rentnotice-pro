// ---------------------------------------------------------------------------
// Public API barrel for the document-generation engine.
//
// - generateDocument(kind, context, options?) -> GeneratedDocument
// - assemblePacket(kind, docs) -> GeneratedDocument (merged PDF)
// - merge helpers (renderTemplate, buildMergeFields, formatting)
// - DocumentContext / GeneratedDocument types
//
// Everything else in this directory is internal.
// ---------------------------------------------------------------------------

import type { DocumentKind } from "../types";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "./context";
import { generateNotice } from "./generators/notice";
import { generateProofOfService } from "./generators/proof-of-service";
import { generateServiceEvidence } from "./generators/service-evidence";
import { generatePostingChecklist } from "./generators/posting-checklist";
import { generateCalcReview } from "./generators/calc-review";
import { generateExcludedSummary } from "./generators/excluded-summary";
import { generateAuditSummary } from "./generators/audit-summary";
import { generateLedgerBackup } from "./generators/ledger-backup";
import { generateLahdLetter } from "./generators/lahd-letter";
import { generateStatePrereq } from "./generators/state-prereq";

// ----------------------------- context types -------------------------------

export type { DocumentContext, GeneratedDocument, GenerateOptions } from "./context";
export { isNoticeFinalized, shouldWatermark } from "./context";

// ----------------------------- merge helpers -------------------------------

export {
  renderTemplate,
  extractMergeFields,
  buildMergeFields,
  formatLongDate,
  formatMonthLabel,
  todayLong,
  premisesAddress,
  formatPaymentMethods,
  officeHoursBlock,
  rentBreakdownText,
} from "./merge";

// ------------------------------- pdf-kit -----------------------------------

export { DocBuilder, bytesToBlob, sanitize, formatTimestamp } from "./pdf-kit";

// ------------------------------- packet ------------------------------------

export { assemblePacket, packetContents } from "./packet";
export type { KindedDocument } from "./packet";

// ------------------------- individual generators ---------------------------

export {
  generateNotice,
  generateProofOfService,
  generateServiceEvidence,
  generatePostingChecklist,
  generateCalcReview,
  generateExcludedSummary,
  generateAuditSummary,
  generateLedgerBackup,
  generateLahdLetter,
  generateStatePrereq,
};

// --------------------------- dispatch by kind ------------------------------

type Generator = (ctx: DocumentContext, options?: GenerateOptions) => Promise<GeneratedDocument>;

const GENERATORS: Record<DocumentKind, Generator> = {
  notice: generateNotice,
  proof_of_service: generateProofOfService,
  service_evidence: generateServiceEvidence,
  posting_checklist: generatePostingChecklist,
  calc_review: generateCalcReview,
  excluded_summary: generateExcludedSummary,
  audit_summary: generateAuditSummary,
  ledger_backup: generateLedgerBackup,
  lahd_letter: generateLahdLetter,
  state_prereq: generateStatePrereq,
};

/**
 * Generate a single document for the given DocumentKind. Returns the uniform
 * { bytes, blob, filename, pageCount } shape used by the DocumentService.
 */
export function generateDocument(
  kind: DocumentKind,
  context: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const gen = GENERATORS[kind];
  if (!gen) throw new Error(`No generator registered for document kind "${kind}"`);
  return gen(context, options);
}

/** The full set of DocumentKinds this engine can generate. */
export const DOCUMENT_KINDS = Object.keys(GENERATORS) as DocumentKind[];
