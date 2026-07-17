// ---------------------------------------------------------------------------
// Tenant-statement header extraction.
//
// Recognizes "Tenant Statement" PDFs (a format common across PM platforms) and
// pulls the header block — tenant name, premises street/unit/city/state/zip,
// lease number, and statement period — from the reconstructed text lines so
// the import wizard can auto-match or create the tenant/property.
// ---------------------------------------------------------------------------

import type { StatementInfo } from "../types";
import { parseDateToIso } from "./dates";

const STATEMENT_TITLE_RE = /\btenant\s+statement\b/i;
const LEASE_RE = /lease\s*#?\s*[:.]?\s*(\d[\d-]*)/i;
const PERIOD_RE = /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–—]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/;
const CITY_STATE_ZIP_RE = /^([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/;
const STREET_RE = /^\d+\s+\S+/; // starts with a street number
const UNIT_ONLY_RE = /^#\s*([\w-]{1,8})$/;
const TRAILING_UNIT_RE = /^(.*?)\s*(?:#|\bunit\s*)([\w-]{1,8})$/i;

/** Lines that are clearly company letterhead / boilerplate, never a tenant name. */
const NOT_A_NAME_RE =
  /prepared by|property management|statement|www\.|\.com\b|\.net\b|@|\(\d{3}\)|\d{3}[-.]\d{4}|^page\b|\binc\.?$|\bllc\b/i;

function looksLikeTenantName(line: string): boolean {
  const t = line.trim();
  if (!t || /\d/.test(t)) return false;
  if (NOT_A_NAME_RE.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 6) return false;
  return /^[A-Za-z][A-Za-z .,'&-]*$/.test(t);
}

/**
 * Extract statement header details from the reconstructed PDF text lines.
 * Returns null when the file does not look like a tenant statement.
 */
export function extractStatementInfo(lines: string[]): StatementInfo | null {
  const trimmed = lines.map((l) => l.trim());
  const titleIdx = trimmed.findIndex((l) => STATEMENT_TITLE_RE.test(l));
  if (titleIdx < 0) return null;

  // Limit the header scan to lines above the transaction table.
  const tableIdx = trimmed.findIndex(
    (l) => /\bdate\b/i.test(l) && /\bdescription\b/i.test(l) && /\b(amount|charge)\b/i.test(l),
  );
  const headerEnd = tableIdx > 0 ? tableIdx : Math.min(trimmed.length, 25);
  const header = trimmed.slice(0, headerEnd);

  const info: StatementInfo = {
    vendor: "tenant_statement",
    tenantName: null,
    street: null,
    unit: null,
    city: null,
    state: null,
    zip: null,
    leaseNumber: null,
    periodStart: null,
    periodEnd: null,
  };

  // ---- statement period ----
  for (const line of header) {
    const m = line.match(PERIOD_RE);
    if (m) {
      info.periodStart = parseDateToIso(m[1]);
      info.periodEnd = parseDateToIso(m[2]);
      break;
    }
  }

  // ---- lease number + street on the lease line ----
  let leaseIdx = -1;
  for (let i = 0; i < header.length; i++) {
    const m = header[i].match(LEASE_RE);
    if (m) {
      leaseIdx = i;
      info.leaseNumber = m[1];
      const rest = header[i].slice((m.index ?? 0) + m[0].length).trim();
      if (STREET_RE.test(rest)) info.street = rest;
      break;
    }
  }

  // ---- tenant name: nearest plausible name at or above the lease line ----
  const nameScanTop = leaseIdx >= 0 ? leaseIdx : header.length - 1;
  for (let i = nameScanTop; i >= 0; i--) {
    // The lease line itself may lead with the name ("Stan Francois Lease # …").
    const candidate = i === leaseIdx ? header[i].split(/lease\s*#/i)[0].trim() : header[i];
    if (looksLikeTenantName(candidate)) {
      info.tenantName = candidate;
      break;
    }
  }

  // ---- premises street / unit / city-state-zip below the lease line ----
  const from = leaseIdx >= 0 ? leaseIdx : titleIdx;
  for (let i = from; i < header.length; i++) {
    const line = i === leaseIdx ? "" : header[i];
    if (!line) {
      // fall through — the lease-line remainder was handled above
    } else if (UNIT_ONLY_RE.test(line)) {
      if (!info.unit) info.unit = line.match(UNIT_ONLY_RE)![1];
    } else {
      const csz = line.match(CITY_STATE_ZIP_RE);
      if (csz) {
        // Prefer the LAST city/state/zip in the block (company letterhead
        // appears first; the premises address appears after the lease line).
        info.city = csz[1].trim();
        info.state = csz[2];
        info.zip = csz[3];
      } else if (!info.street && STREET_RE.test(line) && !PERIOD_RE.test(line)) {
        const tu = line.match(TRAILING_UNIT_RE);
        if (tu && tu[2] && /#|unit/i.test(line)) {
          info.street = tu[1].trim();
          if (!info.unit) info.unit = tu[2];
        } else {
          info.street = line;
        }
      }
    }
  }

  // If the street itself still carries a trailing "#5", split it off. Some
  // statements append a listing index to the property label ("2021 Carnegie
  // Lane #5 - 1") — strip that suffix before splitting.
  if (info.street) {
    info.street = info.street.replace(/\s*-\s*\d+\s*$/, "").trim();
    const tu = info.street.match(TRAILING_UNIT_RE);
    if (tu && /#|unit/i.test(info.street) && tu[1].trim()) {
      info.street = tu[1].trim();
      if (!info.unit) info.unit = tu[2];
    }
  }

  return info;
}
