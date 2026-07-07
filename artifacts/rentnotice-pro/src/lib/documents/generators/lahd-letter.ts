// ---------------------------------------------------------------------------
// LAHD / local-jurisdiction info placeholder page (DocumentKind "lahd_letter").
//
// For City of Los Angeles properties, tenants may be entitled to a "Right to
// Legal Counsel" notice from the Los Angeles Housing Department. The official
// letter changes over time, so this document is an explicit placeholder that
// must be replaced with the current official letter before use.
// ---------------------------------------------------------------------------

import { premisesAddress } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

export async function generateLahdLetter(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice, property } = ctx;
  const isLaCity = property?.isLosAngelesCity ?? false;
  const b = await newBuilder(ctx, "LAHD Right to Counsel (Placeholder)", options);

  b.documentTitle("NOTICE OF TENANT'S RIGHT TO LEGAL COUNSEL", {
    subtitle: "Los Angeles Housing Department (LAHD) — Local Jurisdiction Attachment",
  });

  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", premisesAddress(ctx), { labelWidth: 130 });
  b.labelValue("County:", property?.county || "—", { labelWidth: 130 });
  b.labelValue(
    "City of Los Angeles:",
    isLaCity ? "Yes — local attachment may be required" : "No — verify local requirements",
    { labelWidth: 130 },
  );
  b.moveDown(6);

  b.heading("Placeholder — Replace Before Use");
  b.paragraph(
    "This page is a PLACEHOLDER for the official Los Angeles Housing Department (LAHD) \"Right to Legal Counsel\" notice, or the equivalent local-jurisdiction attachment required for the property's location.",
    { gapAfter: 6 },
  );
  b.paragraph(
    "The official LAHD letter and other local addenda are published and periodically revised by the applicable local agency. This tool does not reproduce the official text. Before serving a notice, obtain the current official letter from the applicable agency and attach it here in place of this placeholder.",
    { gapAfter: 6 },
  );

  b.heading("Why This May Be Required");
  b.bullet(
    "The City of Los Angeles and certain other jurisdictions require landlords to include specific tenant-rights information (such as a right-to-counsel notice) with eviction-related notices.",
  );
  b.bullet(
    "Local rent-stabilization ordinances (e.g., LARSO) and just-cause rules may impose additional notice content and procedural requirements.",
  );
  b.bullet(
    "Requirements differ by city and county and change over time; always confirm the current local rules.",
  );

  b.heading("Action Required");
  b.checkbox("Confirm whether a local-jurisdiction attachment is required for this property.");
  b.checkbox("Obtain the current official LAHD (or local) letter from the applicable agency.");
  b.checkbox("Replace this placeholder page with the official letter before service.");
  b.checkbox("Have local requirements reviewed by a qualified California attorney.");

  b.moveDown(8);
  b.note(
    "This placeholder does not constitute legal advice and is not the official LAHD letter. Local landlord-tenant requirements must be verified and approved by a qualified California attorney before use.",
  );

  return finalize(b, fileName(ctx, "lahd_letter", options));
}
