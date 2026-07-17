// ---------------------------------------------------------------------------
// State pre-filing prerequisite attachment (DocumentKind "state_prereq").
//
// Generated only for jurisdictions whose rule pack declares nonpayment
// prerequisites (MD notice of intent, ME information sheet, HI mediation
// branch). Official state forms change over time, so these pages are explicit
// placeholders/checklists that must be completed with the current official
// form before filing.
// ---------------------------------------------------------------------------

import { premisesAddress } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";
import { getRulePack, HI_MEDIATION_EFFECTIVE_DATE } from "../../engine/rulepacks";
import type { Prerequisite } from "../../engine/rulepacks";

export async function generateStatePrereq(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice } = ctx;
  const pack = getRulePack(notice.jurisdiction);
  const prereqs: Prerequisite[] = pack?.nonpayment.prerequisites ?? [];
  const b = await newBuilder(ctx, "State Pre-Filing Prerequisites", options);

  b.documentTitle("STATE PRE-FILING PREREQUISITES", {
    subtitle: `${pack?.stateName ?? notice.jurisdiction} — required before an eviction filing`,
  });

  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", premisesAddress(ctx), { labelWidth: 130 });
  b.labelValue("Jurisdiction:", pack?.stateName ?? notice.jurisdiction, { labelWidth: 130 });
  b.moveDown(6);

  if (prereqs.includes("notice_of_intent")) {
    b.heading("Maryland — Notice of Intent to File a Complaint (form DC-CV-115)");
    b.paragraph(
      "Maryland requires the landlord to send the tenant a written Notice of Intent to File a Complaint for Summary Ejectment (court form DC-CV-115) and give the tenant 10 days to pay before filing. This page is a PLACEHOLDER — obtain the current official DC-CV-115 from the Maryland Courts website and complete it.",
      { gapAfter: 6 },
    );
    b.checkbox("Current official DC-CV-115 form obtained from mdcourts.gov.");
    b.checkbox("Notice of Intent sent to the tenant (keep proof of mailing/delivery).");
    b.checkbox("10-day pay window elapsed without full payment before filing.");
    b.checkbox("Completed form and proof retained in the tenant file.");
    b.moveDown(8);
  }

  if (prereqs.includes("information_sheet")) {
    b.heading("Maine — Eviction Information Sheet & Mediation Request (form CV-256)");
    b.paragraph(
      "Maine requires that an eviction information sheet and mediation request form (court form CV-256) accompany the notice. This page is a PLACEHOLDER — obtain the current official CV-256 from the Maine Judicial Branch and attach it to the notice served on the tenant.",
      { gapAfter: 6 },
    );
    b.checkbox("Current official CV-256 obtained from courts.maine.gov.");
    b.checkbox("CV-256 attached to every copy of the notice served on the tenant.");
    b.checkbox("Copy of the attached form retained in the tenant file.");
    b.moveDown(8);
  }

  if (prereqs.includes("mediation_if_requested")) {
    b.heading("Hawaii — Pre-Filing Mediation Branch");
    b.paragraph(
      `For eviction cases filed on or after ${HI_MEDIATION_EFFECTIVE_DATE}, Hawaii requires the landlord to inform the tenant about mediation and, if the tenant requests mediation with a community mediation center, to participate before filing. Confirm the current statutory requirements and local mediation center procedures.`,
      { gapAfter: 6 },
    );
    b.checkbox("Tenant informed of the right to request mediation.");
    b.checkbox("If mediation was requested: mediation scheduled/completed before filing.");
    b.checkbox("Mediation center correspondence retained in the tenant file.");
    b.moveDown(8);
  }

  if (prereqs.length === 0) {
    b.paragraph(
      "No state pre-filing prerequisites are recorded for this jurisdiction in the current rule pack.",
      { gapAfter: 6 },
    );
  }

  b.moveDown(4);
  b.note(
    "These pages are checklists/placeholders, not official state forms and not legal advice. Obtain the current official forms and have the filing reviewed by a licensed attorney in the property's state.",
  );

  return finalize(b, fileName(ctx, "state_prereq", options));
}
