// ---------------------------------------------------------------------------
// DocumentContext — the single input shape for every document generator.
// Composed entirely of the shared domain types from ../types. The coordinator
// (impl.ts / integration pass) constructs this and hands it to generators.
// ---------------------------------------------------------------------------

import type {
  AuditEntry,
  CalculationResult,
  CompanyProfile,
  Notice,
  NoticeTemplate,
  Property,
  ServiceRecord,
  Tenant,
} from "../types";

/**
 * Everything a generator may need to render a document. Fields that are not
 * always available (calculation, template, property, tenant) are nullable so a
 * generator can degrade gracefully (e.g. a notice with no ledger linked).
 */
export interface DocumentContext {
  /** The notice being documented (drives watermark, addresses, amounts). */
  notice: Notice;
  /** Snapshot of the tenant record, if resolvable. */
  tenant: Tenant | null;
  /** Snapshot of the property record, if resolvable. */
  property: Property | null;
  /** Rent-only calculation result for the linked ledger, if any. */
  calculation: CalculationResult | null;
  /** Company profile used for header / signature / payment defaults. */
  companyProfile: CompanyProfile;
  /** Active notice template (body text + merge fields), if any. */
  template: NoticeTemplate | null;
  /** Audit-trail entries relevant to this notice (for the audit summary doc). */
  auditEntries: AuditEntry[];
  /** Service record (proof-of-service / date-of-service fields). */
  serviceInfo: ServiceRecord;
}

/** Uniform return shape for every generator (matches DocumentService semantics). */
export interface GeneratedDocument {
  bytes: Uint8Array;
  blob: Blob;
  filename: string;
  pageCount: number;
}

/** Optional per-generation overrides (rarely needed; coordinator may omit). */
export interface GenerateOptions {
  /**
   * Force the DRAFT watermark on/off. When undefined the generator decides
   * based on whether the notice is finalized.
   */
  watermark?: boolean;
  /** Override the generated-at timestamp shown in the footer (ISO string). */
  generatedAt?: string;
}

/**
 * A notice is considered "finalized" (no DRAFT watermark) once it has been
 * finalized or has progressed past finalization in the workflow.
 */
export function isNoticeFinalized(notice: Notice): boolean {
  if (notice.finalizedAt) return true;
  return (
    notice.status === "finalized" ||
    notice.status === "served" ||
    notice.status === "mailed" ||
    notice.status === "expired" ||
    notice.status === "paid" ||
    notice.status === "sent_to_attorney"
  );
}

/** Resolve whether a DRAFT watermark should be drawn for this context. */
export function shouldWatermark(ctx: DocumentContext, options?: GenerateOptions): boolean {
  if (options && typeof options.watermark === "boolean") return options.watermark;
  return !isNoticeFinalized(ctx.notice);
}
