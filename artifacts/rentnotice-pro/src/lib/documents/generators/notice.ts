// ---------------------------------------------------------------------------
// Notice generator (DocumentKind "notice").
//
// Renders the notice itself. When a template is supplied its {{merge_field}}
// body drives the statutory narrative; otherwise a built-in CA statutory layout
// is used. For 3-Day Pay-Rent-or-Quit notices an itemized rent-only table and a
// date-of-service section are always rendered, and the landlord/agent signature
// block is guaranteed.
// ---------------------------------------------------------------------------

import { NOTICE_TYPE_LABELS, formatCents } from "../../types";
import { DocBuilder } from "../pdf-kit";
import {
  buildMergeFields,
  formatLongDate,
  officeHoursBlock,
  premisesAddress,
  renderTemplate,
  todayLong,
  formatPaymentMethods,
} from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";

export async function generateNotice(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice } = ctx;
  const title = NOTICE_TYPE_LABELS[notice.noticeType];
  const b = await newBuilder(ctx, title, options);

  b.documentTitle(title.toUpperCase());

  // ---- addressee & premises (always structured) ----
  b.paragraph(`TO: ${notice.tenantNames.join(", ")}, and all other tenants and occupants in possession:`, {
    font: b.fonts.bold,
    size: 11,
    gapAfter: 4,
  });
  b.paragraph(`Premises: ${premisesAddress(ctx)}`, { gapAfter: 10 });

  if (ctx.template) {
    renderFromTemplate(b, ctx);
  } else {
    renderBuiltIn(b, ctx);
  }

  // ---- itemized rent table (pay-or-quit only) ----
  if (notice.noticeType === "pay_or_quit_3day") {
    renderRentTable(b, ctx);
    renderPaymentInstructions(b, ctx);
  }

  // ---- signature block when the template did not carry one ----
  if (!ctx.template) {
    renderSignature(b, ctx);
  }

  // ---- date-of-service section (always) ----
  renderDateOfService(b);

  return finalize(b, fileName(ctx, "notice", options));
}

// -------------------------- template-driven body ---------------------------

function renderFromTemplate(b: DocBuilder, ctx: DocumentContext): void {
  const tpl = ctx.template!;
  const version = tpl.versions.find((v) => v.version === tpl.currentVersion) ?? tpl.versions[tpl.versions.length - 1];
  const body = version ? version.body : "";
  const rendered = renderTemplate(body, buildMergeFields(ctx));
  for (const block of rendered.split("\n")) {
    if (block.trim() === "") {
      b.moveDown(6);
      continue;
    }
    const isHeading = /^[A-Z0-9 ,.\-()]+$/.test(block.trim()) && block.trim().length < 70 && /[A-Z]/.test(block);
    b.paragraph(block, {
      font: isHeading ? b.fonts.bold : b.fonts.regular,
      size: isHeading ? 11 : 10.5,
      gapAfter: 4,
    });
  }
  if (!tpl.attorneyReviewed) {
    b.moveDown(6);
    b.note(
      "This template has not been marked attorney-reviewed. Review and approval by a qualified California attorney is required before production use.",
    );
  }
}

// -------------------------- built-in statutory body ------------------------

function renderBuiltIn(b: DocBuilder, ctx: DocumentContext): void {
  const { notice } = ctx;
  switch (notice.noticeType) {
    case "pay_or_quit_3day":
      b.paragraph(
        `PLEASE TAKE NOTICE that the rent on the above-described premises is now due, owing, and delinquent in the total sum of ${formatCents(notice.totalAmountCents)}, being rent only for the period(s) itemized below. No late fees, utility charges, deposits, or other non-rent charges are included in this amount.`,
        { gapAfter: 8 },
      );
      b.paragraph(
        "WITHIN THREE (3) DAYS after service on you of this notice, excluding Saturdays, Sundays, and judicial holidays, you are hereby required to pay the said rent in full OR to remove from and deliver up possession of the above-described premises.",
        { gapAfter: 8 },
      );
      b.paragraph(
        "The undersigned hereby elects to declare a forfeiture of your lease or rental agreement under which you occupy the above-described premises if you fail to pay the entire amount of rent demanded within the three (3) day period. If you fail to pay the amount due or to deliver up possession, legal proceedings will be instituted against you to recover possession of the premises, to declare the forfeiture of the lease or rental agreement, and to recover rents, damages, and costs of suit as allowed by law.",
        { gapAfter: 8 },
      );
      b.paragraph(
        "This notice is intended to be and is a three-day notice to pay rent or quit given pursuant to California Code of Civil Procedure section 1161(2). Nothing contained in this notice shall be construed as a waiver of any breach of covenant or of the landlord's right to pursue any and all remedies available at law or in equity.",
        { gapAfter: 6 },
      );
      break;
    case "perform_covenant_3day":
      b.paragraph(
        "PLEASE TAKE NOTICE that you are in violation of the following covenant(s) of your lease or rental agreement:",
        { gapAfter: 6 },
      );
      b.paragraph(notice.covenantDescription || "(covenant description not provided)", {
        indent: 12,
        gapAfter: 8,
      });
      b.paragraph(
        "WITHIN THREE (3) DAYS after service on you of this notice, you are required to perform the covenant(s) described above OR to remove from and deliver up possession of the premises. This notice is given pursuant to California Code of Civil Procedure section 1161(3).",
        { gapAfter: 6 },
      );
      break;
    case "termination_30day":
    case "termination_60day": {
      const days = notice.noticeType === "termination_30day" ? "THIRTY (30)" : "SIXTY (60)";
      b.paragraph(
        `PLEASE TAKE NOTICE that your tenancy of the above-described premises is terminated effective ${formatLongDate(notice.terminationDate) || "[termination_date]"}, which is not less than ${days} days after service of this notice upon you. You are required to vacate and deliver up possession of the premises on or before that date.`,
        { gapAfter: 8 },
      );
      b.paragraph(
        "This notice is given pursuant to applicable California law. If you fail to vacate, legal proceedings may be instituted to recover possession, damages, and costs.",
        { gapAfter: 6 },
      );
      break;
    }
    case "entry_24hr":
      b.paragraph(
        `PLEASE TAKE NOTICE that the owner or the owner's agent intends to enter the above-described premises on ${formatLongDate(notice.entryDate) || "[entry_date]"} during the following time window: ${notice.entryTimeWindow || "[entry_time_window]"}.`,
        { gapAfter: 8 },
      );
      b.paragraph(`Reason for entry: ${notice.entryReason || "[entry_reason]"}`, { gapAfter: 8 });
      b.paragraph(
        "This notice is given pursuant to California Civil Code section 1954. Entry will be during normal business hours unless otherwise agreed or permitted by law.",
        { gapAfter: 6 },
      );
      break;
    case "rent_increase":
      b.paragraph(
        `PLEASE TAKE NOTICE that, effective ${formatLongDate(notice.rentIncreaseEffectiveDate) || "[effective_date]"}, the monthly rent for the above-described premises will be increased to ${notice.rentIncreaseNewAmountCents != null ? formatCents(notice.rentIncreaseNewAmountCents) : "[new_amount]"}.`,
        { gapAfter: 8 },
      );
      b.paragraph(
        "All other terms of your tenancy remain in full force and effect. This notice is given pursuant to California Civil Code section 827 and any applicable local rent-stabilization ordinance.",
        { gapAfter: 6 },
      );
      break;
    default:
      b.paragraph(NOTICE_TYPE_LABELS[notice.noticeType], { gapAfter: 6 });
  }
}

// ----------------------------- rent table ----------------------------------

function renderRentTable(b: DocBuilder, ctx: DocumentContext): void {
  const { notice } = ctx;
  b.heading("Itemized Rent Due (Rent Only)");
  b.table({
    columns: [
      { header: "Rent Period", width: 34 },
      { header: "Rent Charged", width: 17, align: "right" },
      { header: "Payments Applied", width: 17, align: "right" },
      { header: "Credits Applied", width: 16, align: "right" },
      { header: "Rent Due", width: 16, align: "right" },
    ],
    rows: notice.months.map((m) => [
      `${formatLongDate(m.periodStart)} - ${formatLongDate(m.periodEnd)}`,
      formatCents(m.rentChargedCents),
      formatCents(m.paymentsAppliedCents),
      formatCents(m.creditsAppliedCents),
      { text: formatCents(m.selectedAmountCents), bold: true, align: "right" },
    ]),
  });
  b.paragraph(`TOTAL RENT-ONLY AMOUNT DUE: ${formatCents(notice.totalAmountCents)}`, {
    font: b.fonts.bold,
    size: 11,
    align: "right",
    gapAfter: 6,
  });
  b.note(
    "This amount reflects unpaid rent only. Late fees, NSF fees, utilities, deposits, and other non-rent charges have been excluded and are not demanded by this notice.",
  );
}

// -------------------------- payment instructions ---------------------------

function renderPaymentInstructions(b: DocBuilder, ctx: DocumentContext): void {
  const { notice } = ctx;
  const p = notice.payment;
  b.heading("How and Where to Pay");
  b.labelValue("Pay to:", p.payToName || ctx.companyProfile.name, { labelWidth: 130 });
  b.labelValue("Address:", p.paymentAddress || ctx.companyProfile.address, { labelWidth: 130 });
  b.labelValue("Telephone:", p.phone || ctx.companyProfile.phone, { labelWidth: 130 });
  b.labelValue("Accepted methods:", formatPaymentMethods(p.acceptedMethods) || "As arranged with the office", {
    labelWidth: 130,
  });
  if (p.inPersonAllowed) {
    b.labelValue("Office hours:", p.officeHours || "—", { labelWidth: 130 });
    b.labelValue("Payment days:", p.paymentDays || "—", { labelWidth: 130 });
  }
  if (p.electronicInstructions) {
    b.labelValue("Electronic:", p.electronicInstructions, { labelWidth: 130 });
  }
  b.moveDown(2);
  b.paragraph(officeHoursBlock(p), { gapAfter: 4 });
}

// ------------------------------ signature ----------------------------------

function renderSignature(b: DocBuilder, ctx: DocumentContext): void {
  const property = ctx.property;
  const ownerName = property?.ownerName || ctx.companyProfile.name;
  const mgmt = property?.managementCompany || ctx.companyProfile.name;
  b.heading("Landlord / Authorized Agent");
  b.paragraph(`Date prepared: ${todayLong()}`, { gapAfter: 4 });
  b.signatureBlock([ownerName, "Owner / Authorized Agent", mgmt], { gapBefore: 24 });
}

// --------------------------- date of service -------------------------------

function renderDateOfService(b: DocBuilder): void {
  b.heading("Date of Service (to be completed at time of service)");
  b.fillLinePair("Date served:", "Time served:");
  b.fillLine("Served by (name):");
  b.paragraph("Method of service:", { font: b.fonts.bold, size: 10.5, gapAfter: 4 });
  b.checkbox("Personal service on the tenant(s) named above.");
  b.checkbox("Substituted service on a person of suitable age and discretion, AND a copy mailed to the tenant(s).");
  b.checkbox("Posting in a conspicuous place on the premises AND a copy mailed to the tenant(s).");
  b.checkbox("Other attorney-approved method (describe in the Proof of Service).");
}
