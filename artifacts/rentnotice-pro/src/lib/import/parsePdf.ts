import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { RawTable } from "./types";
import { buildTable } from "./tableUtils";
import { parseDateToIso } from "./dates";
import { looksLikeMoney } from "./money";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface PdfItem {
  str: string;
  x: number;
  y: number;
}

const HEADER_KEYWORDS = [
  "date",
  "description",
  "charge",
  "payment",
  "credit",
  "amount",
  "balance",
  "type",
  "memo",
  "reference",
  "ref",
  "account",
  "category",
  "transaction",
  "debit",
  "month",
  "tenant",
  "resident",
  "unit",
  "posted",
  "chg",
  "code",
  "comment",
  "notes",
];

// Group text items into visual lines using their y coordinate.
function reconstructLines(items: PdfItem[]): PdfItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfItem[][] = [];
  const yTolerance = 3;
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last[last.length - 1].y - item.y) <= yTolerance) {
      last.push(item);
    } else {
      lines.push([item]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

function headerKeywordCount(line: PdfItem[]): number {
  const text = line.map((i) => i.str.toLowerCase()).join(" ");
  return HEADER_KEYWORDS.filter((k) => new RegExp(`\\b${k}`, "i").test(text)).length;
}

function nearestColumn(x: number, centers: number[]): number {
  let best = 0;
  let bestDist = Infinity;
  centers.forEach((c, i) => {
    const dist = Math.abs(c - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}

function clusterCenters(xs: number[], tolerance = 14): number[] {
  const sorted = [...xs].sort((a, b) => a - b);
  const centers: number[] = [];
  let group: number[] = [];
  for (const x of sorted) {
    if (group.length && x - group[group.length - 1] > tolerance) {
      centers.push(group.reduce((a, b) => a + b, 0) / group.length);
      group = [];
    }
    group.push(x);
  }
  if (group.length) centers.push(group.reduce((a, b) => a + b, 0) / group.length);
  return centers;
}

function lineHasDate(line: PdfItem[]): boolean {
  return line.some((i) => parseDateToIso(i.str) !== null);
}

function lineHasMoney(line: PdfItem[]): boolean {
  return line.some((i) => looksLikeMoney(i.str));
}

function rowFromLine(line: PdfItem[], centers: number[]): string[] {
  const cells = Array.from({ length: centers.length }, () => "");
  for (const item of line) {
    const col = nearestColumn(item.x, centers);
    cells[col] = cells[col] ? `${cells[col]} ${item.str}`.trim() : item.str.trim();
  }
  return cells;
}

/**
 * Parse a text-based PDF ledger into a RawTable by extracting positioned text,
 * reconstructing lines, and inferring columns from a detected header row (or,
 * failing that, clustering the x positions of date+amount lines).
 */
export async function parsePdfFile(
  file: File | Blob,
): Promise<{ table: RawTable; lines: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const doc = await loadingTask.promise;

  const allLines: PdfItem[][] = [];
  const textLines: string[] = [];

  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const items: PdfItem[] = [];
      for (const raw of content.items as Array<{ str?: string; transform?: number[] }>) {
        const str = typeof raw.str === "string" ? raw.str : "";
        if (!str.trim()) continue;
        const transform = raw.transform ?? [];
        items.push({ str, x: Number(transform[4] ?? 0), y: Number(transform[5] ?? 0) });
      }
      const lines = reconstructLines(items);
      for (const line of lines) {
        allLines.push(line);
        textLines.push(
          line
            .map((i) => i.str)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim(),
        );
      }
    }
  } finally {
    await loadingTask.destroy();
  }

  // Locate the header line: the one matching the most header keywords.
  let headerIdx = -1;
  let headerScore = 1;
  allLines.forEach((line, idx) => {
    const count = headerKeywordCount(line);
    if (count >= 2 && count > headerScore) {
      headerScore = count;
      headerIdx = idx;
    }
  });

  let table: RawTable;
  if (headerIdx >= 0) {
    const headerLine = allLines[headerIdx];
    const centers = headerLine.map((i) => i.x);
    const headers = headerLine.map((i) => i.str.trim());
    const rows: string[][] = [];
    for (let i = headerIdx + 1; i < allLines.length; i++) {
      const line = allLines[i];
      if (!lineHasDate(line) && !lineHasMoney(line)) continue;
      const cells = rowFromLine(line, centers);
      if (cells.some((c) => c !== "")) rows.push(cells);
    }
    table = buildTable(headers, rows);
    if (table.rows.length === 0) {
      warnings.push("A header row was detected but no transaction rows could be parsed.");
    }
  } else {
    const dataLines = allLines.filter((l) => lineHasDate(l) && lineHasMoney(l));
    if (dataLines.length === 0) {
      warnings.push("No tabular data was detected in this PDF. It may be scanned — try OCR import.");
      table = { headers: [], rows: [] };
    } else {
      const centers = clusterCenters(dataLines.flatMap((l) => l.map((i) => i.x)));
      const rows = dataLines.map((line) => rowFromLine(line, centers));
      const headers = centers.map((_, i) => `Column ${i + 1}`);
      table = buildTable(headers, rows);
      warnings.push("No header row was detected in the PDF — columns were inferred. Please review the mapping.");
    }
  }

  return { table, lines: textLines, warnings };
}
