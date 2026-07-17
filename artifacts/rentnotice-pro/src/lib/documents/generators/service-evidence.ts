// ---------------------------------------------------------------------------
// Service evidence exhibit (DocumentKind "service_evidence").
//
// Court-ready exhibit pages for field-captured service evidence: each photo is
// embedded with a caption recording the capture timestamp, GPS coordinates
// (with accuracy), the server's name, and the service method. One section per
// field assignment that has evidence attached.
// ---------------------------------------------------------------------------

import type { FieldAssignment } from "../../types";
import { NOTICE_TYPE_LABELS, SERVICE_METHOD_LABELS } from "../../types";
import { premisesAddress } from "../merge";
import type { DocumentContext, GeneratedDocument, GenerateOptions } from "../context";
import { fileName, finalize, newBuilder } from "./common";
import { downscalePhotoDataUrl } from "../../images";

const METHOD_LABELS = SERVICE_METHOD_LABELS;

const STATUS_LABELS: Record<FieldAssignment["status"], string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** The assignments that actually carry photo evidence (exhibit-worthy). */
export function assignmentsWithEvidence(assignments: FieldAssignment[]): FieldAssignment[] {
  return assignments.filter((a) => a.evidence.length > 0);
}

function formatCaptured(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function formatGps(lat: number | null, lng: number | null, accuracy: number | null): string {
  if (lat == null || lng == null) return "Not available";
  const acc = accuracy != null ? ` (accuracy ±${Math.round(accuracy)} m)` : "";
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}${acc}`;
}

export async function generateServiceEvidence(
  ctx: DocumentContext,
  options?: GenerateOptions,
): Promise<GeneratedDocument> {
  const { notice } = ctx;
  const withEvidence = assignmentsWithEvidence(ctx.fieldAssignments);
  const b = await newBuilder(ctx, "Service Evidence Exhibit", options);

  b.documentTitle("SERVICE EVIDENCE EXHIBIT", {
    subtitle: "Field photographs with capture timestamps and GPS coordinates",
  });
  b.labelValue("Tenant(s):", notice.tenantNames.join(", "), { labelWidth: 130 });
  b.labelValue("Premises:", premisesAddress(ctx), { labelWidth: 130 });
  b.labelValue("Notice:", NOTICE_TYPE_LABELS[notice.noticeType], { labelWidth: 130 });
  b.moveDown(4);

  if (withEvidence.length === 0) {
    b.paragraph("No field service evidence has been recorded for this notice.");
    return finalize(b, fileName(ctx, "service_evidence", options));
  }

  let photoNo = 0;
  withEvidence.forEach((a, idx) => {
    b.heading(`Field Assignment ${withEvidence.length > 1 ? `${idx + 1} ` : ""}— ${a.assigneeName || "Unnamed server"}`);
    b.labelValue("Server:", a.assigneeName || "—", { labelWidth: 130 });
    b.labelValue("Status:", STATUS_LABELS[a.status], { labelWidth: 130 });
    b.labelValue(
      "Service method:",
      a.serviceMethod ? METHOD_LABELS[a.serviceMethod] : "Not recorded",
      { labelWidth: 130 },
    );
    b.labelValue(
      "Completed:",
      a.completedAt ? formatCaptured(a.completedAt) : "Not completed",
      { labelWidth: 130 },
    );
    b.moveDown(6);
  });

  b.heading("Photographic Evidence");
  const embedPromises: Array<() => Promise<void>> = [];
  for (const a of withEvidence) {
    for (const e of a.evidence) {
      photoNo += 1;
      const n = photoNo;
      embedPromises.push(async () => {
        b.moveDown(4);
        b.paragraph(`Photo ${n}`, { font: b.fonts.bold, size: 10.5, gapAfter: 3 });
        let embedError: string | null = null;
        try {
          // Safety net for photos ingested before downscaling existed (or via
          // older sync paths): recompress oversized images before embedding so
          // the packet stays small and base64 decoding stays cheap.
          const photo = await downscalePhotoDataUrl(e.photoDataUrl);
          await b.image(photo, { maxWidth: 380, maxHeight: 300 });
        } catch (err) {
          embedError = err instanceof Error ? err.message : "Unknown error";
        }
        if (embedError) {
          b.paragraph(
            `[Photo ${n} could not be embedded in this PDF (${embedError}). The original image remains attached to the field assignment record.]`,
            { font: b.fonts.italic, size: 9.5 },
          );
        }
        b.labelValue("Captured:", formatCaptured(e.capturedAt), { size: 9.5, labelWidth: 110 });
        b.labelValue("GPS coordinates:", formatGps(e.latitude, e.longitude, e.accuracyMeters), {
          size: 9.5,
          labelWidth: 110,
        });
        b.labelValue("Server:", a.assigneeName || "—", { size: 9.5, labelWidth: 110 });
        b.labelValue(
          "Service method:",
          a.serviceMethod ? METHOD_LABELS[a.serviceMethod] : "Not recorded",
          { size: 9.5, labelWidth: 110 },
        );
        if (e.note.trim()) {
          b.labelValue("Server note:", e.note.trim(), { size: 9.5, labelWidth: 110 });
        }
        b.moveDown(8);
      });
    }
  }
  for (const embed of embedPromises) await embed();

  b.moveDown(4);
  b.note(
    "Photographs were captured on-site by the field server using the RentNotice Field mobile app. Capture timestamps and GPS coordinates are recorded automatically by the device at the moment of capture and are provided as supporting evidence of service.",
  );

  return finalize(b, fileName(ctx, "service_evidence", options));
}
