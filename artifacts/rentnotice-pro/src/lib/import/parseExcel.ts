import * as XLSX from "xlsx";
import type { RawTable } from "./types";
import { matrixToRawTable } from "./tableUtils";

/** Parse the first worksheet of an Excel workbook into a RawTable. */
export async function parseExcelFile(file: File | Blob): Promise<RawTable> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { headers: [], rows: [] };

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
    raw: false,
  });

  const asStrings = matrix.map((row) =>
    Array.isArray(row) ? row.map((c) => (c === null || c === undefined ? "" : String(c))) : [],
  );
  return matrixToRawTable(asStrings);
}
