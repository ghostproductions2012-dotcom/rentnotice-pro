// ---------------------------------------------------------------------------
// Proof of Service declaration (DocumentKind "proof_of_service").
//
// Declaration of service covering personal / substituted-and-mail /
// post-and-mail methods, service-person details, and a penalty-of-perjury
// block. Pre-fills from ctx.serviceInfo when available; otherwise leaves ruled
// fill-in fields for completion at the time of service.
// ---------------------------------------------------------------------------

import { NOTICE_TYPE_LABELS, SERVICE_METHOD_LABELS } from "../../types";
import { PROOF_FIELD_LABELS, getRulePack } from "../../engine/rulepacks";
import { formatLongDate, premisesAddress } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

const METHOD_LABEL = SERVICE_METHOD_LABELS;

export async function generateProofOfService(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice, serviceInfo } = ctx;
  const b = await newBuilder(ctx, "Proof of Service", options);

  b.documentTitle("PROOF OF SERVICE", {
    subtitle: `Re: ${NOTICE_TYPE_LABELS[notice.noticeType]}`,
  });

  // ---- matter identification ----
  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", premisesAddress(ctx), { labelWidth: 130 });
  b.moveDown(6);

  b.paragraph(
    "I, the undersigned, declare that I am over the age of eighteen (18) years and not a party to this matter. I served the notice described above upon the tenant(s) named above in the manner checked below:",
    { gapAfter: 8 },
  );

  // ---- method selection ----
  b.heading("Manner of Service");
  const method = serviceInfo.method;
  b.checkbox(
    "PERSONAL SERVICE. I personally delivered a copy of the notice to the tenant(s).",
    { checked: method === "personal" },
  );
  b.checkbox(
    "SUBSTITUTED SERVICE. I delivered a copy of the notice to a person of suitable age and discretion at the tenant's residence or usual place of business AND thereafter mailed a copy, by first-class mail, postage prepaid, to the tenant(s) at the premises.",
    { checked: method === "substitute" },
  );
  b.checkbox(
    "POSTING AND MAILING. I posted a copy of the notice in a conspicuous place on the premises, the tenant's place of residence not being found and no person of suitable age or discretion being present, AND thereafter mailed a copy, by first-class mail, postage prepaid, to the tenant(s) at the premises.",
    { checked: method === "post_and_mail" },
  );
  b.checkbox(
    "OTHER attorney-approved method (described below).",
    { checked: method === "other" },
  );

  // ---- service details ----
  b.heading("Service Details");
  if (serviceInfo.dateServed || serviceInfo.timeServed) {
    b.labelValue("Date served:", formatLongDate(serviceInfo.dateServed) || "—", { labelWidth: 150 });
    b.labelValue("Time served:", serviceInfo.timeServed || "—", { labelWidth: 150 });
  } else {
    b.fillLinePair("Date served:", "Time served:");
  }
  if (method) {
    b.labelValue("Method selected:", METHOD_LABEL[method], { labelWidth: 150 });
  }
  if (serviceInfo.mailedDate) {
    b.labelValue("Date mailed:", formatLongDate(serviceInfo.mailedDate), { labelWidth: 150 });
  } else {
    b.fillLine("Date mailed (if applicable):");
  }
  if (serviceInfo.servedBy) {
    b.labelValue("Served by:", serviceInfo.servedBy, { labelWidth: 150 });
  } else {
    b.fillLine("Person serving (print name):");
  }
  if (serviceInfo.serverNotes) {
    b.labelValue("Notes:", serviceInfo.serverNotes, { labelWidth: 150 });
  } else {
    b.fillLine("Notes / description of other method:");
  }

  // ---- state-required proof elements (rule-pack driven, non-CA) ----
  const pack = getRulePack(notice.jurisdiction);
  const isCA = (notice.jurisdiction || "CA").toUpperCase() === "CA";
  if (!isCA && pack) {
    b.heading(`Proof Elements Required (${pack.stateName})`);
    b.paragraph(
      `${pack.stateName} proof of service should document the following. Confirm each item is completed:`,
      { gapAfter: 6 },
    );
    for (const field of pack.service.proofRequired) {
      b.checkbox(PROOF_FIELD_LABELS[field], { checked: false });
    }
  }

  // ---- penalty of perjury ----
  const stateName = isCA ? "California" : pack?.stateName ?? "the state where the premises are located";
  b.heading("Declaration Under Penalty of Perjury");
  b.paragraph(
    `I declare under penalty of perjury under the laws of the State of ${stateName} that the foregoing is true and correct.`,
    { gapAfter: 14 },
  );
  b.fillLinePair("Executed on (date):", "At (city, state):");
  b.moveDown(10);
  b.signatureBlock(["Signature of person serving", "Print name"], { gapBefore: 22, width: 280 });

  b.moveDown(6);
  if (isCA) {
    b.note(
      "The manner of service must comply with California law. This form does not constitute legal advice; consult a qualified California attorney regarding the appropriate method of service.",
    );
  } else {
    b.note(
      `The manner of service must comply with ${stateName} law${pack && !pack.service.verified ? " — the pre-suit service rules for this state have not been verified in this app" : ""}. This form does not constitute legal advice; consult a qualified ${stateName} attorney regarding the appropriate method of service.`,
    );
  }

  return finalize(b, fileName(ctx, "proof_of_service", options));
}
