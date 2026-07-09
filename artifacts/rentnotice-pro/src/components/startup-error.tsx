// Full-screen error surface for startup failures (database open/migration
// errors, or any boot query failure). Shows the real error message, offers a
// retry, and — behind an explicit confirmation — a destructive local-data
// reset so a corrupted database can never brick the app silently.
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getServices } from "@/lib/api/services";

export function errorDetails(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n\n${err.stack}` : err.message;
  return String(err);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function StartupErrorScreen({ error }: { error: unknown }) {
  const [busy, setBusy] = useState<"retry" | "reset" | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const retry = async () => {
    setBusy("retry");
    setActionError(null);
    try {
      await getServices().retryDatabaseInit();
      window.location.reload();
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
    }
  };

  const reset = async () => {
    setBusy("reset");
    setActionError(null);
    try {
      await getServices().resetLocalData();
      window.location.reload();
    } catch (err) {
      setActionError(errorMessage(err));
      setBusy(null);
    }
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-lg shadow-xl border-destructive/20">
        <CardHeader className="text-center space-y-2">
          <div className="w-14 h-14 bg-destructive/10 text-destructive rounded-2xl flex items-center justify-center mx-auto mb-2">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <CardTitle className="text-2xl font-serif" data-testid="text-startup-error-title">
            RentNotice Pro couldn&apos;t load your workspace
          </CardTitle>
          <CardDescription>
            The local database failed to open. Your data has not been changed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="rounded-md border bg-muted/40 p-3 text-xs font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto"
            data-testid="text-startup-error-message"
          >
            {errorDetails(error)}
          </div>
          {actionError && (
            <p className="text-sm text-destructive" role="alert" data-testid="text-startup-action-error">
              {actionError}
            </p>
          )}
          {confirmingReset && (
            <div
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-3"
              data-testid="panel-reset-confirm"
            >
              <p className="font-medium text-destructive">
                Reset local data? This permanently deletes everything stored in this app on this
                computer — notices, properties, tenants, imported ledgers, and documents. If you
                have a backup file, you can restore it afterwards.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={reset}
                  disabled={busy !== null}
                  data-testid="button-reset-confirm"
                >
                  {busy === "reset" ? "Resetting…" : "Yes, erase local data"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmingReset(false)}
                  disabled={busy !== null}
                  data-testid="button-reset-cancel"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-3">
          <Button onClick={retry} disabled={busy !== null} data-testid="button-startup-retry">
            {busy === "retry" ? "Retrying…" : "Retry"}
          </Button>
          {!confirmingReset && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmingReset(true)}
              disabled={busy !== null}
              data-testid="button-startup-reset"
            >
              Reset local data…
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
