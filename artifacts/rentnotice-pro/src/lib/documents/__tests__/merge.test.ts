import { describe, expect, it } from "vitest";
import { buildMergeFields, renderTemplate } from "../merge";
import { PAY_OR_QUIT_BODY } from "../../templates-data/ca";
import type { DocumentContext } from "../context";
import type { CompanyProfile, Notice, PaymentProfile, ServiceRecord } from "../../types";

const T = "2026-07-09T00:00:00.000Z";

const payment: PaymentProfile = {
  payToName: "Golden State PM",
  payToPerson: "",
  paymentAddress: "100 Office Way, Los Angeles, CA 90012",
  phone: "(213) 555-0100",
  acceptedMethods: ["check"],
  paymentDays: "Monday–Friday",
  officeHours: "9:00 AM – 5:00 PM",
  electronicInstructions: "",
};

const service: ServiceRecord = {
  dateServed: null,
  timeServed: null,
  method: null,
  servedBy: "",
  serverNotes: "",
  mailedDate: null,
};

const companyProfile: CompanyProfile = {
  id: "company-1",
  name: "Golden State PM",
  address: "100 Office Way, Los Angeles, CA 90012",
  phone: "(213) 555-0100",
  email: "office@example.com",
  logoDataUrl: null,
  notes: "",
  createdAt: T,
  updatedAt: T,
};

const notice: Notice = {
  id: "notice-1",
  noticeType: "pay_or_quit",
  jurisdiction: "CA",
  status: "draft",
  tenantId: "tenant-1",
  propertyId: "prop-1",
  unit: "5",
  tenantNames: ["Stan Francois"],
  propertyAddress: "2021 Carnegie Lane #5, Redondo Beach, CA 90278",
  ledgerId: null,
  months: [
    {
      month: "2026-07",
      label: "July 2026",
      rentDueCents: 539500,
      selectedAmountCents: 539500,
    },
  ],
  totalAmountCents: 539500,
  payment,
  templateId: "tpl-ca-3day-pay",
  templateVersion: 1,
  includeLahdLetter: false,
  covenantDescription: "",
  entryDate: null,
  entryTimeWindow: "",
  entryReason: "",
  terminationDate: null,
  rentIncreaseNewAmountCents: null,
  rentIncreaseEffectiveDate: null,
  version: 1,
  revisedFromId: null,
  reviewerApprovedBy: null,
  reviewerApprovedAt: null,
  finalizedBy: null,
  finalizedAt: null,
  rentOnlyAttestedBy: null,
  rentOnlyAttestedAt: null,
  attorneyExportFlag: false,
  service,
  deadlineDate: null,
  internalNotes: "",
  preparedBy: null,
  createdAt: T,
  updatedAt: T,
};

function ctxWith(overrides: Partial<DocumentContext>): DocumentContext {
  return {
    notice,
    tenant: null,
    property: null,
    calculation: null,
    companyProfile,
    template: null,
    auditEntries: [],
    serviceInfo: service,
    fieldAssignments: [],
    ...overrides,
  };
}

describe("pay-or-quit template rendering (placeholder leakage)", () => {
  it("never leaks raw [token] placeholders, even with a minimal property-less draft", () => {
    const rendered = renderTemplate(PAY_OR_QUIT_BODY, buildMergeFields(ctxWith({})));
    const leaked = rendered.match(/\[[a-z_]+\]/g);
    expect(leaked).toBeNull();
  });

  it("renders blank fill-in lines for unknown county/bedrooms and unserved dates", () => {
    const rendered = renderTemplate(PAY_OR_QUIT_BODY, buildMergeFields(ctxWith({})));
    expect(rendered).toContain("County of ____");
    expect(rendered).toContain("Number of Bedrooms: ____");
    expect(rendered).toContain("Day Notice Served on: ____");
    expect(rendered).toContain("Day Notice Expires on: ____");
    // pay-to-person falls back to the payee name, not a blank
    expect(rendered).toContain(
      "Person to whom rent is to be paid (name of individual): Golden State PM",
    );
  });

  it("uses real values when property details and service dates exist", () => {
    const rendered = renderTemplate(
      PAY_OR_QUIT_BODY,
      buildMergeFields(
        ctxWith({
          notice: {
            ...notice,
            deadlineDate: "2026-07-14",
            service: { ...service, dateServed: "2026-07-10" },
            payment: { ...payment, payToPerson: "Alex Rivera" },
          },
          property: {
            id: "prop-1",
            nickname: "Carnegie Lane",
            addressLine1: "2021 Carnegie Lane",
            addressLine2: "",
            city: "Redondo Beach",
            state: "CA",
            zip: "90278",
            county: "Los Angeles",
            bedrooms: 2,
            units: ["5"],
            ownerName: "Owner LLC",
            managementCompany: "Golden State PM",
            managerContact: "",
            payment,
            isLosAngelesCity: false,
            notes: "",
            createdAt: T,
            updatedAt: T,
          },
        }),
      ),
    );
    expect(rendered).toContain("County of Los Angeles");
    expect(rendered).toContain("Number of Bedrooms: 2");
    expect(rendered).not.toContain("Day Notice Served on: ____");
    expect(rendered).not.toContain("Day Notice Expires on: ____");
    expect(rendered).toContain(
      "Person to whom rent is to be paid (name of individual): Alex Rivera",
    );
    expect(rendered).toContain("Total Rent Owing: $5,395.00");
  });
});
