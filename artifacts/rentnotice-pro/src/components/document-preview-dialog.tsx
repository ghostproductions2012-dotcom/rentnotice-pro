import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { saveDocument } from "@/lib/download";

export interface PreviewDocument {
  title: string;
  fileName: string;
  blobUrl: string;
}

/**
 * In-app PDF preview. The desktop (Tauri) webview cannot open new tabs, so
 * documents are shown in an embedded viewer with an explicit download action.
 */
export function DocumentPreviewDialog({
  doc,
  onClose,
}: {
  doc: PreviewDocument | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const doDownload = async () => {
    if (!doc || saving) return;
    setSaving(true);
    try {
      const result = await saveDocument(doc.fileName, doc.blobUrl);
      if (result === "saved") {
        toast({ title: "PDF saved" });
      }
    } catch (err) {
      toast({
        title: "Could not save the PDF",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={doc !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[min(92vw,56rem)] h-[min(88vh,60rem)] flex flex-col gap-3 p-4 sm:p-5">
        <DialogHeader className="pr-8">
          <DialogTitle className="truncate" data-testid="text-preview-title">
            {doc?.title}
          </DialogTitle>
          <DialogDescription className="truncate">
            {doc?.fileName}
          </DialogDescription>
        </DialogHeader>
        {doc && (
          <iframe
            src={doc.blobUrl}
            title={doc.title}
            className="flex-1 w-full min-h-0 rounded-md border bg-muted"
            data-testid="iframe-document-preview"
          />
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} data-testid="button-close-preview">
            Close
          </Button>
          {doc && (
            <Button onClick={doDownload} disabled={saving} data-testid="button-download-document">
              {saving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-2" />
              )}
              Download PDF
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
