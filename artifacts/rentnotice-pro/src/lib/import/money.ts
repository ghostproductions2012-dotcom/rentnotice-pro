function normalizeDecimal(input: string): string {
  const s = input;
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma === -1 && lastDot === -1) return s;

  let decimalSep: "," | ".";
  if (lastComma === -1) decimalSep = ".";
  else if (lastDot === -1) decimalSep = ",";
  else decimalSep = lastComma > lastDot ? "," : ".";

  if (decimalSep === ",") {
    const commaCount = (s.match(/,/g) || []).length;
    const digitsAfter = s.length - lastComma - 1;
    if (lastDot === -1 && (commaCount > 1 || digitsAfter === 3)) {
      return s.replace(/,/g, "");
    }
    const withoutDots = s.replace(/\./g, "");
    const li = withoutDots.lastIndexOf(",");
    return `${withoutDots.slice(0, li).replace(/,/g, "")}.${withoutDots.slice(li + 1)}`;
  }

  let out = s.replace(/,/g, "");
  const dotCount = (out.match(/\./g) || []).length;
  if (dotCount > 1) {
    const li = out.lastIndexOf(".");
    out = `${out.slice(0, li).replace(/\./g, "")}.${out.slice(li + 1)}`;
  }
  return out;
}

export function parseMoneyToCents(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.round(raw * 100);
  }

  let s = String(raw).trim();
  if (!s) return null;
  if (!/\d/.test(s)) return null;

  let negative = false;

  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  if (/(^|[^a-z])cr([^a-z]|$)/i.test(s)) negative = true;
  s = s.replace(/(^|[^a-z])(cr|dr)([^a-z]|$)/gi, "$1 $3");

  if (/-\s*$/.test(s)) {
    negative = true;
    s = s.replace(/-\s*$/, "");
  }
  s = s.trim();
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }

  s = s.replace(/[^0-9.,]/g, "");
  if (!s || !/\d/.test(s)) return null;

  s = normalizeDecimal(s);
  const n = Number(s);
  if (Number.isNaN(n)) return null;

  const cents = Math.round(n * 100);
  return negative ? -cents : cents;
}

export function looksLikeMoney(value: string): boolean {
  const t = value.trim();
  if (!t || !/\d/.test(t)) return false;
  if (t.length > 24) return false;
  const cleaned = t
    .replace(/\b(cr|dr)\b/gi, "")
    .replace(/[\s$€£¥₹,()+\-.]/g, "");
  return cleaned.length > 0 && /^\d+$/.test(cleaned);
}
