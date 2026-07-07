import type { BindParams, SqlValue } from "sql.js";

export type Row = Record<string, SqlValue>;

export interface SqlRunner {
  run(sql: string, params?: BindParams): void;
  all<T = Row>(sql: string, params?: BindParams): T[];
  get<T = Row>(sql: string, params?: BindParams): T | null;
}

let counter = 0;

export function uid(prefix = "id"): string {
  counter = (counter + 1) % 0xffff;
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${counter.toString(36)}${rand}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function toBool(value: SqlValue | boolean | undefined): boolean {
  return value === 1 || value === true || value === "1";
}

export function fromBool(value: boolean | null | undefined): number {
  return value ? 1 : 0;
}

export function asStr(value: SqlValue | undefined): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

export function strOrNull(value: SqlValue | undefined | null): string | null {
  if (value == null) return null;
  return typeof value === "string" ? value : String(value);
}

export function asNum(value: SqlValue | undefined): number {
  if (typeof value === "number") return value;
  if (value == null || value === "") return 0;
  return Number(value);
}

export function numOrNull(value: SqlValue | undefined | null): number | null {
  if (value == null || value === "") return null;
  return typeof value === "number" ? value : Number(value);
}

export function parseJson<T>(value: SqlValue | undefined, fallback: T): T {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function upsertRow(runner: SqlRunner, table: string, row: Row): void {
  const cols = Object.keys(row);
  if (cols.length === 0) return;
  const placeholders = cols.map(() => "?").join(", ");
  const columnList = cols.map((c) => `"${c}"`).join(", ");
  const values = cols.map((c) => row[c]);
  runner.run(
    `INSERT OR REPLACE INTO "${table}" (${columnList}) VALUES (${placeholders})`,
    values,
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const match = /^data:([^;,]*)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    return {
      bytes: new TextEncoder().encode(dataUrl),
      mime: "application/octet-stream",
    };
  }
  const mime = match[1] || "application/octet-stream";
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? "";
  if (isBase64) {
    return { bytes: base64ToBytes(payload), mime };
  }
  return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mime };
}

export function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

export function asBytes(value: SqlValue | undefined | null): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (typeof value === "string") return base64ToBytes(value);
  return null;
}
