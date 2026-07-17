// ---------------------------------------------------------------------------
// Buildium import dialog — runs the full browser-side sync with a live
// progress readout, then shows a summary of what was created / refreshed.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSettings, useWorkspaceState } from "@/lib/api/hooks";
import { BuildiumClientError } from "@/lib/buildium/client";
import {
  type BuildiumSyncProgress,
  type BuildiumSyncSummary,
  runBuildiumSync,
} from "@/lib/buildium/sync";
import { formatCents } from "@/lib/types";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2 } from "lucide-react";

interface BuildiumImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Stage = "idle" | "running" | "done" | "error";

export function BuildiumImportDialog({ open, onOpenChange }: BuildiumImportDialogProps) {
  const { data: settings } = useSettings();
  const { data: workspace } = useWorkspaceState();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();

  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState<BuildiumSyncProgress | null>(null);
  const [summary, setSummary] = useState<BuildiumSyncSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activation = workspace?.mode === "activated" ? workspace.activation : null;

  const handleClose = (next: boolean) => {
    if (stage === "running") return; // no closing mid-import
    if (!next) {
      setStage("idle");
      setProgress(null);
      setSummary(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const handleStart = async () => {
    if (!activation || !settings?.buildiumClientId || !settings?.buildiumClientSecret) return;
    setStage("running");
    setError(null);
    setSummary(null);
    try {
      const result = await runBuildiumSync(
        {
          licenseKey: activation.licenseKey,
          clientId: settings.buildiumClientId,
          clientSecret: settings.buildiumClientSecret,
        },
        setProgress,
      );
      setSummary(result);
      setStage("done");
    } catch (err) {
      setError(
        err instanceof BuildiumClientError || err instanceof Error ? err.message : String(err),
      );
      setStage("error");
    } finally {
      // The sync touches properties, tenants, ledgers, settings, dashboard,
      // and the audit trail — refetch everything rather than cherry-pick.
      await queryClient.invalidateQueries();
    }
  };

  const pct =
    progress?.total && progress.total > 0 && progress.current != null
      ? Math.round((progress.current / progress.total) * 100)
      : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Import from Buildium</DialogTitle>
          <DialogDescription>
            Pulls your rental properties, active leases, and outstanding balances from
            Buildium. Re-importing refreshes existing properties and tenants; each
            outstanding balance is imported as a new dated statement.
          </DialogDescription>
        </DialogHeader>

        {stage === "idle" && (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>The import will:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Add or refresh properties and their unit lists</li>
              <li>Add or refresh tenants on active leases</li>
              <li>
                Import a ledger for every lease with an outstanding balance, classified and
                ready for notice calculation
              </li>
            </ul>
            <p>
              Nothing is ever written back to Buildium, and manually entered notes and
              payment instructions are left untouched.
            </p>
          </div>
        )}

        {stage === "running" && (
          <div className="space-y-3 py-2" data-testid="buildium-import-progress">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span data-testid="text-buildium-import-step">
                {progress?.message ?? "Starting import…"}
              </span>
            </div>
            {pct != null && <Progress value={pct} />}
          </div>
        )}

        {stage === "done" && summary && (
          <div className="space-y-3 py-2" data-testid="buildium-import-summary">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
              Import complete
            </div>
            <ul className="text-sm text-muted-foreground space-y-1 pl-6">
              <li data-testid="text-import-properties">
                Properties: {summary.propertiesCreated} added, {summary.propertiesUpdated} refreshed
              </li>
              <li data-testid="text-import-tenants">
                Tenants: {summary.tenantsCreated} added, {summary.tenantsUpdated} refreshed
              </li>
              <li data-testid="text-import-ledgers">
                Ledgers imported: {summary.ledgersImported}
              </li>
            </ul>
            {summary.importedLedgers.length > 0 && (
              <div className="text-sm space-y-2 border-t pt-3">
                <div className="font-medium">Outstanding balances ready for notices</div>
                <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {summary.importedLedgers.map((ref) => (
                    <li key={ref.ledgerId} className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground truncate">
                        {ref.tenantNames.join(", ")} —{" "}
                        <span className="font-medium text-foreground">
                          {formatCents(ref.balanceCents)}
                        </span>
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => {
                          onOpenChange(false);
                          navigate(
                            `/notices/new?tenantId=${encodeURIComponent(ref.tenantId)}&ledgerId=${encodeURIComponent(ref.ledgerId)}`,
                          );
                        }}
                        data-testid={`button-create-notice-${ref.ledgerId}`}
                      >
                        <FileText className="w-3.5 h-3.5 mr-1.5" />
                        Create notice
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {summary.warnings.length > 0 && (
              <div className="text-sm space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
                  Warnings
                </div>
                <ul className="text-muted-foreground list-disc pl-6 space-y-1 max-h-32 overflow-y-auto">
                  {summary.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {stage === "error" && (
          <div className="flex items-start gap-2 text-sm py-2" data-testid="buildium-import-error">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <div className="font-medium">Import failed</div>
              <p className="text-muted-foreground">{error}</p>
              <p className="text-muted-foreground mt-1">
                Anything imported before the failure has been saved — you can safely run the
                import again.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {stage === "idle" && (
            <Button onClick={handleStart} data-testid="button-buildium-import-start">
              <Download className="w-4 h-4 mr-2" />
              Start import
            </Button>
          )}
          {stage === "error" && (
            <Button onClick={handleStart} data-testid="button-buildium-import-retry">
              Try again
            </Button>
          )}
          {(stage === "done" || stage === "error") && (
            <Button variant="outline" onClick={() => handleClose(false)} data-testid="button-buildium-import-close">
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
