import type { OcrProgress, RawTable } from "./types";
import { matrixToRawTable } from "./tableUtils";

/**
 * Run OCR on an image File/Blob and return the raw recognized text.
 * tesseract.js is imported lazily so the (large) module only loads on demand.
 */
export async function ocrFileToText(
  file: File | Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<string> {
  const Tesseract = await import("tesseract.js");
  const result = await Tesseract.recognize(file, "eng", {
    logger: (message: { status: string; progress: number }) => {
      if (onProgress) {
        onProgress({
          status: message.status,
          progress: typeof message.progress === "number" ? message.progress : 0,
        });
      }
    },
  });
  return result.data.text ?? "";
}

/** Convert OCR text into a RawTable by splitting each line on runs of whitespace. */
export function ocrTextToRawTable(text: string): RawTable {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "");
  const matrix = lines.map((line) => line.split(/\s{2,}|\t/).map((cell) => cell.trim()));
  return matrixToRawTable(matrix);
}

export async function ocrToRawTable(
  file: File | Blob,
  onProgress?: (progress: OcrProgress) => void,
): Promise<{ table: RawTable; text: string; lines: string[] }> {
  const text = await ocrFileToText(file, onProgress);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const table = ocrTextToRawTable(text);
  return { table, text, lines };
}
