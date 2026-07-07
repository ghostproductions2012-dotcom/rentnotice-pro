// Shared helpers for turning a raw 2D string matrix into a RawTable,
// including header-row detection and header de-duplication.

import type { RawTable } from "./types";
import { looksLikeMoney } from "./money";
import { parseDateToIso } from "./dates";

function cellLooksLikeData(value: string): boolean {
  const t = value.trim();
  if (!t) return false;
  if (looksLikeMoney(t)) return true;
  if (parseDateToIso(t) !== null) return true;
  if (/^-?\d+(?:[.,]\d+)?%?$/.test(t)) return true;
  return false;
}

// Higher score = more likely to be a header row (text-heavy, few data-like cells).
function headerRowScore(row: string[]): number {
  const nonEmpty = row.filter((c) => c.trim() !== "");
  if (nonEmpty.length === 0) return -Infinity;
  const dataLike = nonEmpty.filter(cellLooksLikeData).length;
  const textLike = nonEmpty.length - dataLike;
  return textLike * 2 - dataLike + Math.min(nonEmpty.length, 8) * 0.5;
}

export function dedupeHeaders(rawHeaders: string[]): string[] {
  const headers: string[] = [];
  const seen = new Map<string, number>();
  rawHeaders.forEach((h, i) => {
    let name = (h ?? "").trim();
    if (!name) name = `Column ${i + 1}`;
    const count = seen.get(name);
    if (count) {
      seen.set(name, count + 1);
      name = `${name} (${count + 1})`;
    } else {
      seen.set(name, 1);
    }
    headers.push(name);
  });
  return headers;
}

/** Build a RawTable from an explicit header row + data rows (pads / trims / dedupes). */
export function buildTable(rawHeaders: string[], rows: string[][]): RawTable {
  const width = Math.max(
    rawHeaders.length,
    rows.reduce((max, r) => Math.max(max, r.length), 0),
    1,
  );
  const paddedHeaderNames = Array.from({ length: width }, (_, i) => rawHeaders[i] ?? "");
  const headers = dedupeHeaders(paddedHeaderNames);
  const outRows = rows
    .map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));
  return { headers, rows: outRows };
}

/**
 * Convert a raw matrix to a RawTable by detecting the most likely header row
 * within the first several rows, then treating everything below it as data.
 */
export function matrixToRawTable(matrix: string[][]): RawTable {
  const rows = matrix
    .map((r) => r.map((c) => (c === null || c === undefined ? "" : String(c)).replace(/\s+/g, " ").trim()))
    .filter((r) => r.some((c) => c !== ""));
  if (rows.length === 0) return { headers: [], rows: [] };

  const limit = Math.min(rows.length, 15);
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < limit; i++) {
    const score = headerRowScore(rows[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const headerRow = rows[bestIdx];
  const dataRows = rows.slice(bestIdx + 1);
  return buildTable(headerRow, dataRows);
}
