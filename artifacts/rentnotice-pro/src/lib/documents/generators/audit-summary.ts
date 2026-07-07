// ---------------------------------------------------------------------------
// Audit summary (DocumentKind "audit_summary").
//
// Chronological timeline of the audit-trail entries passed in via
// ctx.auditEntries: date/time, user, action, and plain-English summary, with
// previous/new value and reason where present.
// ---------------------------------------------------------------------------

import type { AuditEntry } from "../../types";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

function actionLabel(action: string): string {
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

export async function generateAuditSummary(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice, auditEntries } = ctx;
  const b = await newBuilder(ctx, "Audit Log Summary", options);

  b.documentTitle("AUDIT LOG SUMMARY");
  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", `${notice.propertyAddress}${notice.unit ? `, Unit ${notice.unit}` : ""}`, {
    labelWidth: 130,
  });
  b.labelValue("Entries:", String(auditEntries.length), { labelWidth: 130 });
  b.moveDown(4);

  b.paragraph(
    "The following is a chronological record of actions recorded for this notice and its underlying data. This log is generated from the application audit trail.",
    { gapAfter: 8 },
  );

  if (!auditEntries.length) {
    b.paragraph("No audit entries are available for this notice.", { gapAfter: 6 });
    return finalize(b, fileName(ctx, "audit_summary", options));
  }

  const sorted: AuditEntry[] = [...auditEntries].sort(
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
      actionLabel(e.action),
      buildSummary(e),
    ]),
    fontSize: 8.5,
  });

  b.moveDown(6);
  b.note(
    "Finalized notice records cannot be edited directly; any correction is made by creating a new revised version, which is itself recorded in this log.",
  );

  return finalize(b, fileName(ctx, "audit_summary", options));
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
