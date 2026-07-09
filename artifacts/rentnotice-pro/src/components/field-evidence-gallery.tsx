import { useState } from "react";
import { MapPin } from "lucide-react";
import type { FieldEvidence } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

function formatGps(e: FieldEvidence): string | null {
  if (e.latitude == null || e.longitude == null) return null;
  const accuracy = e.accuracyMeters != null ? ` (±${Math.round(e.accuracyMeters)} m)` : "";
  return `${e.latitude.toFixed(5)}, ${e.longitude.toFixed(5)}${accuracy}`;
}

export function FieldEvidenceGallery({
  evidence,
  className,
}: {
  evidence: FieldEvidence[];
  className?: string;
}) {
  const [selected, setSelected] = useState<FieldEvidence | null>(null);

  return (
    <>
      <div className={cn("grid grid-cols-1 sm:grid-cols-2 gap-4", className)}>
        {evidence.map((e) => (
          <div
            key={e.id}
            className="border rounded-lg overflow-hidden bg-muted/30"
            data-testid={`field-evidence-${e.id}`}
          >
            <button
              type="button"
              className="block w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSelected(e)}
              aria-label="View evidence photo full-size"
              data-testid={`button-evidence-photo-${e.id}`}
            >
              <img
                src={e.photoDataUrl}
                alt="Service evidence"
                className="w-full h-44 object-cover"
              />
            </button>
            <div className="p-3 text-xs space-y-1">
              <div className="font-medium">{new Date(e.capturedAt).toLocaleString()}</div>
              {formatGps(e) ? (
                <div className="text-muted-foreground flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {formatGps(e)}
                </div>
              ) : (
                <div className="text-muted-foreground">GPS not available</div>
              )}
              {e.note && <div className="text-muted-foreground">{e.note}</div>}
            </div>
          </div>
        ))}
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-4xl" data-testid="dialog-evidence-photo">
          <DialogHeader>
            <DialogTitle>Evidence Photo</DialogTitle>
            <DialogDescription>
              {selected ? `Captured ${new Date(selected.capturedAt).toLocaleString()}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3">
              <img
                src={selected.photoDataUrl}
                alt="Service evidence full size"
                className="w-full max-h-[70vh] object-contain rounded-md bg-muted"
                data-testid="img-evidence-full"
              />
              <div className="text-sm space-y-1">
                <div className="font-medium" data-testid="text-evidence-captured-at">
                  Captured {new Date(selected.capturedAt).toLocaleString()}
                </div>
                {formatGps(selected) ? (
                  <div
                    className="text-muted-foreground flex items-center gap-1"
                    data-testid="text-evidence-gps"
                  >
                    <MapPin className="w-4 h-4" />
                    {formatGps(selected)}
                  </div>
                ) : (
                  <div className="text-muted-foreground" data-testid="text-evidence-gps">
                    GPS not available
                  </div>
                )}
                {selected.note && (
                  <div className="text-muted-foreground" data-testid="text-evidence-note">
                    {selected.note}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
