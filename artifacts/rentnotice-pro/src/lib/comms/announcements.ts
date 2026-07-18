// ---------------------------------------------------------------------------
// Tenant-message announcement templates. These are ordinary courtesy
// communications (maintenance heads-up, rent reminder, general notice) —
// deliberately distinct from the statutory notice templates, which live in
// the template system and carry legal review requirements.
// ---------------------------------------------------------------------------

import { formatCents, type Property, type Tenant } from "../types";
import { todayLong } from "../documents/merge";

/** Merge fields available in tenant messages (a small, non-legal set). */
export const TENANT_MERGE_FIELDS: readonly string[] = [
  "tenant_name",
  "property_address",
  "unit",
  "monthly_rent",
  "company_name",
  "today",
];

export const TENANT_MERGE_FIELD_DESCRIPTIONS: Readonly<Record<string, string>> = {
  tenant_name: "Tenant name(s) on the lease",
  property_address: "Street address of the property",
  unit: "Unit as a \" #A\" suffix — empty when the tenant has no unit",
  monthly_rent: "Scheduled monthly rent, formatted as currency",
  company_name: "Your company name",
  today: "Today's date, written out",
};

const MERGE_TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/**
 * Render a tenant message. Unlike the notice-template renderer, empty values
 * (e.g. no unit) render as an empty string — only genuinely unknown fields
 * get the bracketed placeholder.
 */
export function renderTenantMessage(
  body: string,
  fields: Record<string, string>,
): string {
  return body.replace(MERGE_TOKEN, (_match, key: string) => {
    const value = fields[key];
    return value === undefined ? `[${key}]` : value;
  });
}

export function propertyFullAddress(property: Property | null | undefined): string {
  if (!property) return "";
  const line2 = property.addressLine2 ? `, ${property.addressLine2}` : "";
  return `${property.addressLine1}${line2}, ${property.city}, ${property.state} ${property.zip}`;
}

/** Field map for rendering a tenant message for one recipient. */
export function buildTenantMergeFields(
  tenant: Tenant,
  property: Property | null | undefined,
  companyName: string,
): Record<string, string> {
  return {
    tenant_name: tenant.names.join(", "),
    property_address: propertyFullAddress(property),
    unit: tenant.unit ? ` #${tenant.unit}` : "",
    monthly_rent:
      tenant.monthlyRentCents != null ? formatCents(tenant.monthlyRentCents) : "",
    company_name: companyName,
    today: todayLong(),
  };
}

export interface AnnouncementTemplate {
  id: string;
  label: string;
  subject: string;
  body: string;
}

export const ANNOUNCEMENT_TEMPLATES: readonly AnnouncementTemplate[] = [
  {
    id: "maintenance_visit",
    label: "Maintenance visit heads-up",
    subject: "Upcoming maintenance visit at {{property_address}}",
    body:
      "Hi {{tenant_name}},\n\n" +
      "This is a courtesy heads-up that our maintenance team will be visiting " +
      "{{property_address}}{{unit}} soon to perform routine work. We will do our " +
      "best to keep any disruption to a minimum.\n\n" +
      "If the timing is a problem or you have questions, just reply to this " +
      "email and we will work something out.\n\n" +
      "Thank you,\n{{company_name}}",
  },
  {
    id: "rent_reminder",
    label: "Friendly rent reminder",
    subject: "Friendly reminder from {{company_name}}",
    body:
      "Hi {{tenant_name}},\n\n" +
      "Just a friendly reminder about your monthly rent of {{monthly_rent}} for " +
      "{{property_address}}{{unit}}. If you have already sent your payment, " +
      "please disregard this note.\n\n" +
      "If anything has changed or you would like to talk through payment " +
      "options, reply to this email and we will be happy to help.\n\n" +
      "Thank you,\n{{company_name}}",
  },
  {
    id: "general_notice",
    label: "General announcement",
    subject: "A note from {{company_name}}",
    body:
      "Hi {{tenant_name}},\n\n" +
      "We wanted to share a quick update regarding {{property_address}}:\n\n" +
      "[Write your announcement here]\n\n" +
      "If you have any questions, reply to this email.\n\n" +
      "Thank you,\n{{company_name}}",
  },
];
