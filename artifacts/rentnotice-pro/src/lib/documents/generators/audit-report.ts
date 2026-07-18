// ---------------------------------------------------------------------------
// Audit log report — a standalone, filter-aware PDF of audit entries produced
// straight from the Audit Log page (not tied to a notice, unlike
// audit-summary.ts). The header records company info, the filters that were
// active when the report was generated, and the generation timestamp, so the
// printed report is self-describing.
// ---------------------------------------------------------------------------

import { DocBuilder, bytesToBlob } from "../pdf-kit";
import type { AuditEntry, CompanyProfile } from "../../types";

export function auditActionLabel(action: string): string {
  return action.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function buildSummary(e: AuditEntry): string {
  let s = e.summary || "";
  if (e.previousValue || e.newValue) {
    const from = e.previousValue ? `from "${e.previousValue}"` : "";
    const to = e.newValue ? `to "${e.newValue}"` : "";
    const change = [from, to].filter(Boolean).join(" ");
    if (change) s += `${s ? " (" : "("}${change})`;
  }
  if (e.reason) s += ` — Reason: ${e.reason}`;
  return s || "—";
}

export interface AuditReportInput {
  companyProfile: CompanyProfile | null;
  /** Entries exactly as currently shown (already filtered). */
  entries: AuditEntry[];
  /** Human-readable descriptions of the active filters (empty = no filters). */
  appliedFilters: string[];
}

export interface AuditReportResult {
  blob: Blob;
  fileName: string;
}

export async function generateAuditReport(input: AuditReportInput): Promise<AuditReportResult> {
  const generatedAt = new Date();
  const b = await DocBuilder.create({
    title: "Audit Log Report",
    companyName: input.companyProfile?.name || "RentNotice Pro",
    companySubtitle: input.companyProfile?.address || undefined,
    watermark: null,
    generatedAt: generatedAt.toISOString(),
  });

  b.documentTitle("AUDIT LOG REPORT");
  if (input.companyProfile?.name) {
    b.labelValue("Company:", input.companyProfile.name, { labelWidth: 130 });
  }
  b.labelValue("Generated:", formatWhen(generatedAt.toISOString()), { labelWidth: 130 });
  b.labelValue(
    "Filters applied:",
    input.appliedFilters.length > 0 ? input.appliedFilters.join("; ") : "None (full history)",
    { labelWidth: 130 },
  );
  b.labelValue("Entries:", String(input.entries.length), { labelWidth: 130 });
  b.moveDown(4);

  b.paragraph(
    "The following is a chronological record of the audit-trail entries matching the filters above, generated from the application audit trail.",
    { gapAfter: 8 },
  );

  if (input.entries.length) {
    const sorted: AuditEntry[] = [...input.entries].sort(
      (a, c) => new Date(a.timestamp).getTime() - new Date(c.timestamp).getTime(),
    );
    b.table({
      columns: [
        { header: "Date / Time", width: 20 },
        { header: "User", width: 16 },
        { header: "Action", width: 20 },
        { header: "Summary", width: 44 },
      ],
      rows: sorted.map((e) => [
        formatWhen(e.timestamp),
        e.userName || "—",
        auditActionLabel(e.action),
        buildSummary(e),
      ]),
      fontSize: 8.5,
    });
    b.moveDown(6);
    b.note(
      "This report reflects only the entries matching the filters listed above at the time of generation. The underlying audit trail is immutable.",
    );
  } else {
    b.paragraph("No audit entries match the selected filters.", { gapAfter: 6 });
  }

  const { bytes } = await b.finish();
  const stamp = generatedAt.toISOString().slice(0, 10);
  return {
    blob: bytesToBlob(bytes),
    fileName: `audit_report_${stamp}.pdf`,
  };
}
