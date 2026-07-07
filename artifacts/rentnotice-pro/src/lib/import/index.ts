// ---------------------------------------------------------------------------
// Public API barrel for the ledger import engine.
//
//   parseFile(file)          -> ParseResult (CSV / Excel / PDF / OCR dispatch)
//   toParsedLedgerFile(...)  -> ParsedLedgerFile (vendor detection + mapping)
//   suggestMapping(table)    -> MappingSuggestion
//   normalizeRecords/Rows    -> NormalizedTransaction[]
// ---------------------------------------------------------------------------

import type { LedgerSourceType, ParsedLedgerFile } from "../types";
import type { OcrProgress, ParseResult, RawTable } from "./types";
import { parseCsvFile } from "./parseCsv";
import { parseExcelFile } from "./parseExcel";
import { parsePdfFile } from "./parsePdf";
import { ocrTextToRawTable, ocrFileToText } from "./ocr";
import { suggestMapping } from "./mapping";
import { detectVendor } from "./presets";
import { tableToRecords } from "./normalize";

export * from "./types";
export { parseMoneyToCents, looksLikeMoney } from "./money";
export { parseDateToIso, parseMonthToIso } from "./dates";
export { dedupeHeaders, buildTable, matrixToRawTable } from "./tableUtils";
export { parseCsvText, parseCsvFile } from "./parseCsv";
export { parseExcelFile } from "./parseExcel";
export { parsePdfFile } from "./parsePdf";
export { ocrFileToText, ocrTextToRawTable, ocrToRawTable } from "./ocr";
export { suggestMapping } from "./mapping";
export { BUILTIN_PRESETS, detectVendor, getPreset } from "./presets";
export { normalizeRecords, normalizeRows, tableToRecords } from "./normalize";

const MAX_OCR_PAGES = 8;

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : "";
}

/** Render PDF pages to PNG blobs so scanned PDFs can go through image OCR. */
async function pdfPagesToImageBlobs(file: File | Blob, maxPages: number): Promise<Blob[]> {
  const pdfjsLib = await import("pdfjs-dist");
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const doc = await loadingTask.promise;
  const blobs: Blob[] = [];
  try {
    const pages = Math.min(doc.numPages, maxPages);
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext("2d");
      if (!canvasContext) throw new Error("Canvas 2D context unavailable for OCR rendering.");
      await page.render({ canvasContext, viewport, canvas }).promise;
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas render failed"))), "image/png"),
      );
      blobs.push(blob);
    }
  } finally {
    await loadingTask.destroy();
  }
  return blobs;
}

async function ocrPdf(
  file: File | Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<{ table: RawTable; lines: string[] }> {
  const images = await pdfPagesToImageBlobs(file, MAX_OCR_PAGES);
  const allText: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const text = await ocrFileToText(images[i], (p) =>
      onProgress?.({ ...p, page: i + 1, pageCount: images.length }),
    );
    allText.push(text);
  }
  const combined = allText.join("\n");
  const lines = combined
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  return { table: ocrTextToRawTable(combined), lines };
}

/**
 * Parse any supported ledger file (CSV, Excel, PDF, or image) into a RawTable.
 * Scanned PDFs (no extractable text) and images fall back to OCR.
 */
export async function parseFile(
  file: File,
  onOcrProgress?: (progress: OcrProgress) => void,
): Promise<ParseResult> {
  const ext = extensionOf(file.name);
  const warnings: string[] = [];

  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const table = await parseCsvFile(file);
    return { table, sourceType: "csv", warnings, ocrUsed: false, lines: [] };
  }

  if (ext === "xlsx" || ext === "xls") {
    const table = await parseExcelFile(file);
    return { table, sourceType: "excel", warnings, ocrUsed: false, lines: [] };
  }

  if (ext === "pdf") {
    const parsed = await parsePdfFile(file);
    if (parsed.table.rows.length > 0) {
      return {
        table: parsed.table,
        sourceType: "pdf",
        warnings: [...warnings, ...parsed.warnings],
        ocrUsed: false,
        lines: parsed.lines,
      };
    }
    warnings.push("No extractable text found in PDF; used OCR (verify results carefully).");
    const ocr = await ocrPdf(file, onOcrProgress);
    return { table: ocr.table, sourceType: "pdf_ocr", warnings, ocrUsed: true, lines: ocr.lines };
  }

  if (["png", "jpg", "jpeg", "webp", "bmp", "gif", "tiff"].includes(ext)) {
    warnings.push("Image file imported via OCR; verify recognized values carefully.");
    const text = await ocrFileToText(file, onOcrProgress);
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    return {
      table: ocrTextToRawTable(text),
      sourceType: "pdf_ocr",
      warnings,
      ocrUsed: true,
      lines,
    };
  }

  throw new Error(
    `Unsupported file type ".${ext}". Supported: CSV, TSV, XLSX, XLS, PDF, PNG, JPG.`,
  );
}

/**
 * Build the ParsedLedgerFile contract object from a ParseResult: detects the
 * PM vendor, picks the vendor preset mapping when confident, otherwise falls
 * back to heuristic column mapping.
 */
export function toParsedLedgerFile(fileName: string, parsed: ParseResult): ParsedLedgerFile {
  const detection = detectVendor(parsed.table.headers);
  const suggestion = suggestMapping(parsed.table);
  const mapping =
    detection.preset && detection.confidence >= 0.8 ? detection.preset.mapping : suggestion.mapping;
  const warnings = [...parsed.warnings, ...suggestion.warnings];
  return {
    sourceType: parsed.sourceType as LedgerSourceType,
    fileName,
    headers: parsed.table.headers,
    rows: tableToRecords(parsed.table),
    detectedVendor: detection.vendor,
    suggestedMapping: mapping,
    warnings,
    ocrUsed: parsed.ocrUsed,
  };
}
