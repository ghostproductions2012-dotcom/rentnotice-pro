// Flexible date parsing helpers for ledger imports.
// Everything is normalized to ISO strings: dates -> "YYYY-MM-DD", months -> "YYYY-MM".

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function expandYear(y: number): number {
  if (y >= 100) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

function buildIso(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;
  const lastDay = new Date(y, m, 0).getDate();
  if (d > lastDay) return null;
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Parse a wide range of date representations into an ISO "YYYY-MM-DD" string.
 * Supports ISO, US M/D/Y, D/M/Y (when unambiguous), month-name forms, YYYYMMDD,
 * and Excel serial numbers. Returns null when nothing parseable is found.
 */
export function parseDateToIso(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;

  if (typeof raw === "number") {
    // Excel serial date (days since 1899-12-30).
    if (Number.isFinite(raw) && raw >= 1 && raw < 600000) {
      const ms = Math.round((raw - 25569) * 86400 * 1000);
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
      }
    }
    return null;
  }

  let s = String(raw).trim();
  if (!s) return null;

  // Strip trailing time components.
  s = s.replace(/[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?(?:\s*[+-]\d{2}:?\d{2}|\s*z)?$/i, "").trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  // YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return buildIso(+m[1], +m[2], +m[3]);

  // MM/DD/YYYY (US default) or DD/MM/YYYY when day-first is unambiguous.
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = expandYear(+m[3]);
    if (a > 12 && b <= 12) return buildIso(y, b, a); // day-first
    return buildIso(y, a, b); // month-first (US)
  }

  // "Jan 5, 2026" / "January 5 2026" / "Jan 5th 2026"
  m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/);
  if (m) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    if (mo) return buildIso(expandYear(+m[3]), mo, +m[2]);
  }

  // "5 Jan 2026" / "5-Jan-2026" / "5 January, 2026"
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[-\s]([A-Za-z]{3,9})\.?[-,\s]+(\d{2,4})$/);
  if (m) {
    const mo = MONTH_NAMES[m[2].toLowerCase()];
    if (mo) return buildIso(expandYear(+m[3]), mo, +m[1]);
  }

  // YYYYMMDD
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return buildIso(+m[1], +m[2], +m[3]);

  // Fallback: native Date, but only trust it if a 4-digit year is present.
  if (/\d{4}/.test(s)) {
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  }

  return null;
}

/**
 * Parse a month representation into "YYYY-MM". Accepts "2026-06", "06/2026",
 * "June 2026", "Jun-26", or any full date (uses its year/month).
 */
export function parseMonthToIso(raw: string | number | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let m: RegExpMatchArray | null;

  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) {
    const mo = +m[2];
    if (mo >= 1 && mo <= 12) return `${m[1]}-${pad2(mo)}`;
  }

  m = s.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) {
    const mo = +m[1];
    if (mo >= 1 && mo <= 12) return `${m[2]}-${pad2(mo)}`;
  }

  m = s.match(/^([A-Za-z]{3,9})\.?[-\s,]+(\d{2,4})$/);
  if (m) {
    const mo = MONTH_NAMES[m[1].toLowerCase()];
    if (mo) return `${String(expandYear(+m[2])).padStart(4, "0")}-${pad2(mo)}`;
  }

  m = s.match(/^(\d{2,4})[-\s]([A-Za-z]{3,9})$/);
  if (m) {
    const mo = MONTH_NAMES[m[2].toLowerCase()];
    if (mo) return `${String(expandYear(+m[1])).padStart(4, "0")}-${pad2(mo)}`;
  }

  const iso = parseDateToIso(s);
  if (iso) return iso.slice(0, 7);

  return null;
}
