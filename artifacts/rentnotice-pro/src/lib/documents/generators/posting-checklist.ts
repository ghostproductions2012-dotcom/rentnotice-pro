// ---------------------------------------------------------------------------
// Service instructions checklist (DocumentKind "posting_checklist").
//
// A field-ready checklist walking the server through preparation, service, and
// mailing steps, plus a place to record what was done. Informational only.
// ---------------------------------------------------------------------------

import { NOTICE_TYPE_LABELS } from "../../types";
import { premisesAddress } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

export async function generatePostingChecklist(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice } = ctx;
  const b = await newBuilder(ctx, "Service Instructions Checklist", options);

  b.documentTitle("SERVICE & MAILING INSTRUCTIONS CHECKLIST");
  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", premisesAddress(ctx), { labelWidth: 130 });
  b.labelValue("Notice:", NOTICE_TYPE_LABELS[notice.noticeType], { labelWidth: 130 });
  b.moveDown(4);

  b.heading("1. Before You Go");
  b.checkbox("Confirm the tenant name(s) and premises address match the notice exactly.");
  b.checkbox("Confirm the notice has been finalized (not a draft) before serving.");
  b.checkbox("Print at least two (2) copies of the notice: one to serve, one for your file.");
  b.checkbox("Bring a pen, this checklist, and the Proof of Service form.");
  b.checkbox("If posting-and-mailing may be required, bring envelopes and postage.");

  b.heading("2. Attempt Personal Service");
  b.checkbox("Go to the premises and attempt to personally hand a copy to a named tenant.");
  b.checkbox("If a tenant is present, deliver the notice directly and record the date and time.");
  b.checkbox("If no tenant is available, proceed to substituted service or posting-and-mailing.");

  b.heading("3. Substituted Service (if personal service is not possible)");
  b.checkbox("Leave a copy with a person of suitable age and discretion at the residence or usual place of business.");
  b.checkbox("Inform that person of the general nature of the notice.");
  b.checkbox("Mail a second copy by first-class mail to the tenant(s) at the premises the same day.");

  b.heading("4. Posting and Mailing (last resort)");
  b.checkbox("Post a copy in a conspicuous place on the premises (e.g., the front door).");
  b.checkbox("Mail a second copy by first-class mail to the tenant(s) at the premises the same day.");
  b.checkbox("Photograph the posted notice for the file (optional but recommended).");

  b.heading("5. After Service");
  b.checkbox("Complete and sign the Proof of Service accurately.");
  b.checkbox("Record the date served, time served, and method used.");
  b.checkbox("Return the completed Proof of Service and file copy to the office.");
  b.checkbox("Retain the mailing receipt, if any, with the notice file.");

  b.heading("Record of Service");
  b.fillLinePair("Date served:", "Time served:");
  b.fillLine("Method used:");
  b.fillLine("Served by (print name):");
  b.fillLine("Mailing date (if applicable):");

  b.moveDown(6);
  b.note(
    "This checklist is an internal aid only and does not constitute legal advice. The correct manner of service depends on the circumstances; consult a qualified California attorney with any questions.",
  );

  return finalize(b, fileName(ctx, "service_checklist", options));
}
