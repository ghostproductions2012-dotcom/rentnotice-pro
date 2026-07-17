// ---------------------------------------------------------------------------
// Buildium integration card for the Settings page.
//
// Landlords who manage their portfolio in Buildium can connect their own
// Buildium API credentials here. The credentials live in the local settings
// table only — every Buildium call goes desktop → RentNotice proxy → Buildium
// with the credentials attached per-request, so they are never stored on
// RentNotice servers.
// ---------------------------------------------------------------------------

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useSettings, useUpdateSettings, useWorkspaceState, usePermissions } from "@/lib/api/hooks";
import { pingBuildium, BuildiumClientError } from "@/lib/buildium/client";
import { Link2, Unlink, RefreshCw } from "lucide-react";

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Never";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function BuildiumIntegrationCard() {
  const { data: settings } = useSettings();
  const { data: workspace } = useWorkspaceState();
  const updateSettings = useUpdateSettings();
  const { can } = usePermissions();
  const { toast } = useToast();

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState<"connect" | "test" | "disconnect" | null>(null);

  const activation = workspace?.mode === "activated" ? workspace.activation : null;
  const canManage = can("settings.manage");
  const connected = Boolean(settings?.buildiumClientId && settings?.buildiumClientSecret);

  const handleConnect = async () => {
    if (!activation || !settings) return;
    setBusy("connect");
    try {
      const result = await pingBuildium({
        licenseKey: activation.licenseKey,
        clientId,
        clientSecret,
      });
      await updateSettings.mutateAsync({
        buildiumClientId: clientId.trim(),
        buildiumClientSecret: clientSecret.trim(),
        buildiumConnectedAt: new Date().toISOString(),
      });
      setClientId("");
      setClientSecret("");
      toast({
        title: "Buildium connected",
        description:
          typeof result.propertyCount === "number"
            ? `Connection verified — Buildium reports ${result.propertyCount} rental ${result.propertyCount === 1 ? "property" : "properties"}.`
            : "Connection verified.",
      });
    } catch (err) {
      toast({
        title: "Could not connect to Buildium",
        description:
          err instanceof BuildiumClientError || err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleTest = async () => {
    if (!activation || !settings) return;
    setBusy("test");
    try {
      const result = await pingBuildium({
        licenseKey: activation.licenseKey,
        clientId: settings.buildiumClientId,
        clientSecret: settings.buildiumClientSecret,
      });
      toast({
        title: "Buildium connection OK",
        description:
          typeof result.propertyCount === "number"
            ? `Buildium reports ${result.propertyCount} rental ${result.propertyCount === 1 ? "property" : "properties"}.`
            : "Credentials are still valid.",
      });
    } catch (err) {
      toast({
        title: "Buildium connection failed",
        description:
          err instanceof BuildiumClientError || err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async () => {
    setBusy("disconnect");
    try {
      await updateSettings.mutateAsync({
        buildiumClientId: "",
        buildiumClientSecret: "",
        buildiumConnectedAt: null,
        buildiumLastSyncAt: null,
      });
      toast({
        title: "Buildium disconnected",
        description:
          "Credentials removed from this device. Properties and tenants already imported stay in your workspace.",
      });
    } catch (err) {
      toast({
        title: "Could not disconnect",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Integrations</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Buildium</div>
            <div className="text-sm text-muted-foreground max-w-xl">
              Import your rental properties, active leases, and outstanding balances from
              Buildium so notices are always based on current ledger data. Credentials are
              stored only on this device and sent with each request — never kept on
              RentNotice Pro servers.
            </div>
          </div>
          <div
            className={connected ? "text-sm font-semibold text-primary" : "text-sm font-semibold text-muted-foreground"}
            data-testid="text-buildium-status"
          >
            {connected ? "Connected" : "Not connected"}
          </div>
        </div>

        {!activation && (
          <p className="text-sm text-muted-foreground border-t pt-4" data-testid="text-buildium-requires-license">
            The Buildium integration requires an activated company license. Activate this
            workspace with your license key first.
          </p>
        )}

        {activation && !connected && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-xs text-muted-foreground max-w-xl">
              In Buildium, go to <span className="font-medium text-foreground">Settings → API Keys</span> and
              create a key for RentNotice Pro. Grant it <span className="font-medium text-foreground">read-only (view)
              access</span> to Rentals and Leases only — RentNotice Pro never writes to your Buildium
              account, so the key should not have any edit permissions.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
              <div className="space-y-1.5">
                <Label htmlFor="buildium-client-id">Client ID</Label>
                <Input
                  id="buildium-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  autoComplete="off"
                  disabled={!canManage || busy !== null}
                  data-testid="input-buildium-client-id"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="buildium-client-secret">Client Secret</Label>
                <Input
                  id="buildium-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  autoComplete="off"
                  disabled={!canManage || busy !== null}
                  data-testid="input-buildium-client-secret"
                />
              </div>
            </div>
            <Button
              onClick={handleConnect}
              disabled={!canManage || busy !== null || !clientId.trim() || !clientSecret.trim()}
              data-testid="button-buildium-connect"
            >
              <Link2 className="w-4 h-4 mr-2" />
              {busy === "connect" ? "Verifying…" : "Connect Buildium"}
            </Button>
          </div>
        )}

        {activation && connected && (
          <div className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Connected</div>
                <div data-testid="text-buildium-connected-at">
                  {formatDateTime(settings?.buildiumConnectedAt)}
                </div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Last Import</div>
                <div data-testid="text-buildium-last-sync">
                  {formatDateTime(settings?.buildiumLastSyncAt)}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={handleTest}
                disabled={busy !== null}
                data-testid="button-buildium-test"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                {busy === "test" ? "Testing…" : "Test connection"}
              </Button>
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={!canManage || busy !== null}
                data-testid="button-buildium-disconnect"
              >
                <Unlink className="w-4 h-4 mr-2" />
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Use the <span className="font-medium text-foreground">Properties</span> page to import
              from Buildium. Imported records are matched by their Buildium ids, so re-importing
              updates them instead of creating duplicates.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
