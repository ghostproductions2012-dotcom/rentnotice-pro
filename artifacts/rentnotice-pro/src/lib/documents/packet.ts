// ---------------------------------------------------------------------------
// Packet assembler — merges several generated PDFs into one combined PDF using
// pdf-lib copyPages. Supports the four PacketKind values; the internal packet
// includes the full internal review set, while the attorney packet is a
// review-ready subset. Callers pass the already-generated documents (keyed by
// DocumentKind) and get back a single GeneratedDocument.
// ---------------------------------------------------------------------------

import { PDFDocument } from "pdf-lib";
import type { DocumentKind, PacketKind } from "../types";
import { bytesToBlob } from "./pdf-kit";
import type { GeneratedDocument } from "./context";

/** A generated document tagged with the DocumentKind it represents. */
export interface KindedDocument {
  kind: DocumentKind;
  doc: GeneratedDocument;
}

/**
 * Ordering + inclusion rules per packet kind. "notice" and
 * "proof_of_service" are always first; internal review docs are added for
 * internal/final packets; the attorney packet adds the full review set for
 * counsel. Only documents actually present in `docs` are included, in this
 * order.
 */
const PACKET_ORDER: Record<PacketKind, DocumentKind[]> = {
  // A single draft export — just the notice (watermarked upstream).
  draft: ["notice", "proof_of_service", "service_evidence", "lahd_letter"],
  // Final serve-ready set given to the field/office.
  final: ["notice", "proof_of_service", "service_evidence", "posting_checklist", "lahd_letter"],
  // Internal file: everything that supports and documents the demand.
  internal_packet: [
    "notice",
    "proof_of_service",
    "service_evidence",
    "posting_checklist",
    "calc_review",
    "excluded_summary",
    "audit_summary",
    "ledger_backup",
    "lahd_letter",
  ],
  // Attorney handoff: the notice plus the full supporting record.
  attorney_packet: [
    "notice",
    "proof_of_service",
    "service_evidence",
    "posting_checklist",
    "calc_review",
    "excluded_summary",
    "ledger_backup",
    "audit_summary",
    "lahd_letter",
  ],
};

/** The ordered list of DocumentKinds that belong in a given packet. */
export function packetContents(kind: PacketKind): DocumentKind[] {
  return [...PACKET_ORDER[kind]];
}

/**
 * Merge `docs` into a single PDF according to the packet kind's ordering.
 * Documents whose kind is not part of the packet, or that are not supplied,
 * are skipped. Returns one combined GeneratedDocument.
 */
export async function assemblePacket(
  kind: PacketKind,
  docs: KindedDocument[],
  opts?: { filename?: string },
): Promise<GeneratedDocument> {
  const order = PACKET_ORDER[kind];
  const byKind = new Map<DocumentKind, GeneratedDocument[]>();
  for (const { kind: k, doc } of docs) {
    const list = byKind.get(k) ?? [];
    list.push(doc);
    byKind.set(k, list);
  }

  // Ordered set of documents to merge (respecting packet order + duplicates).
  const ordered: GeneratedDocument[] = [];
  for (const k of order) {
    const list = byKind.get(k);
    if (list) ordered.push(...list);
  }
  // Include any supplied docs whose kind is not in the ordering, at the end.
  for (const { kind: k, doc } of docs) {
    if (!order.includes(k)) ordered.push(doc);
  }

  const merged = await PDFDocument.create();
  for (const gd of ordered) {
    const src = await PDFDocument.load(toArrayBuffer(gd.bytes));
    const pages = await merged.copyPages(src, src.getPageIndices());
    for (const p of pages) merged.addPage(p);
  }

  const bytes = await merged.save();
  const filename = opts?.filename ?? defaultPacketFilename(kind);
  return {
    bytes,
    blob: bytesToBlob(bytes),
    filename,
    pageCount: merged.getPageCount(),
  };
}

function defaultPacketFilename(kind: PacketKind): string {
  return `${kind}.pdf`;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}
