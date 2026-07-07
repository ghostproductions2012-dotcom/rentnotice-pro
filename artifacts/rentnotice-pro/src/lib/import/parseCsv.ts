import * as Papa from "papaparse";
import type { RawTable } from "./types";
import { matrixToRawTable } from "./tableUtils";

/** Parse CSV/TSV text into a RawTable (header-row detected heuristically). */
export function parseCsvText(text: string): RawTable {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  const data = (result.data as unknown[]).map((row) =>
    Array.isArray(row) ? row.map((c) => (c === null || c === undefined ? "" : String(c))) : [String(row ?? "")],
  );
  return matrixToRawTable(data);
}

export async function parseCsvFile(file: File | Blob): Promise<RawTable> {
  const text = await file.text();
  return parseCsvText(text);
}
