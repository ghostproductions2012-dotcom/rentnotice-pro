import { useState } from "react";
import {
  useSettings,
  useCompanyProfile,
  useWorkspaceState,
  useSyncLicense,
  useUpdateSettings,
  usePermissions,
} from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { ActivationWizard } from "@/components/first-run";
import { KeyRound } from "lucide-react";

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString();
}

const LICENSE_STATUS_LABELS: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  cancelled: "Cancelled",
};

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: company } = useCompanyProfile();
  const { data: workspace } = useWorkspaceState();
  const syncLicense = useSyncLicense();
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const updateSettings = useUpdateSettings();
  const { can } = usePermissions();
  const { toast } = useToast();
  const [activating, setActivating] = useState(false);

  const activation = workspace?.mode === "activated" ? workspace.activation : null;
  const canManageSettings = can("settings.manage");

  if (activating) {
    return (
      <ActivationWizard
        onCancel={() => setActivating(false)}
        replacesExistingData={workspace?.mode === "demo"}
      />
    );
  }

  const handleSync = () => {
    setSyncMessage(null);
    syncLicense.mutate(undefined, {
      onSuccess: (state) => {
        setSyncMessage(
          state.activation && state.activation.directorySyncedAt
            ? "Synced with the licensing service."
            : "Sync finished.",
        );
      },
      onError: (err) =>
        setSyncMessage(err instanceof Error ? err.message : "Sync failed. Please try again."),
    });
  };

  const handleSyncToggle = (checked: boolean) => {
    updateSettings.mutate(
      { syncEnabled: checked },
      {
        onSuccess: () =>
          toast({
            title: checked ? "Mobile field sync enabled" : "Mobile field sync disabled",
            description: checked
              ? "You can now push assignments to the RentNotice Field app from the Field Service page."
              : "Assignments will no longer sync with mobile devices.",
          }),
        onError: (e: unknown) =>
          toast({
            title: "Could not update sync setting",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure company profile, security, and preferences.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {!activation && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Company License</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                This workspace is not activated with a company license. Enter the license key
                your company received when subscribing (RNP-XXXX-XXXX-XXXX-XXXX) to unlock and
                sync your team on this device.
              </p>
              {workspace?.mode === "demo" && (
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Activating replaces all demo data on this device with your company workspace.
                </p>
              )}
              <Button onClick={() => setActivating(true)} data-testid="button-activate-license">
                <KeyRound className="w-4 h-4 mr-2" />
                Activate with a license key
              </Button>
            </CardContent>
          </Card>
        )}
        {activation && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Company License</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Licensed To</div>
                  <div data-testid="text-license-company">{activation.companyName}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Plan</div>
                  <div data-testid="text-license-plan">{activation.plan ?? "—"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Status</div>
                  <div
                    className={
                      activation.licenseStatus === "active"
                        ? "font-semibold text-primary"
                        : "font-semibold text-destructive"
                    }
                    data-testid="text-license-status"
                  >
                    {LICENSE_STATUS_LABELS[activation.licenseStatus] ?? activation.licenseStatus}
                  </div>
                  {activation.statusReason && (
                    <div
                      className="text-sm text-muted-foreground mt-0.5"
                      data-testid="text-license-status-reason"
                    >
                      {activation.statusReason}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">License Key</div>
                  <div className="font-mono text-sm" data-testid="text-license-key">
                    {activation.licenseKey}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Last Verified Online</div>
                  <div data-testid="text-license-verified">{formatDateTime(activation.lastVerifiedAt)}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Team Directory Synced</div>
                  <div data-testid="text-license-directory-synced">
                    {formatDateTime(activation.directorySyncedAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 pt-2 border-t">
                <Button
                  variant="outline"
                  onClick={handleSync}
                  disabled={syncLicense.isPending}
                  data-testid="button-sync-license"
                >
                  {syncLicense.isPending ? "Syncing…" : "Sync now"}
                </Button>
                {syncMessage && (
                  <span className="text-sm text-muted-foreground" data-testid="text-sync-result">
                    {syncMessage}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                This device re-verifies the license each time the app starts. If it stays offline
                longer than the {activation.graceDays}-day grace period, the workspace becomes
                view-only until it can sync again. Tenant and notice data never leaves this device.
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Company Profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm font-medium text-muted-foreground">Organization Name</div>
              <div>{company?.name || "Not configured"}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-muted-foreground">Address</div>
              <div>{company?.address}</div>
            </div>
            <Button variant="outline" className="mt-2">Edit Profile</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Security & Compliance</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <div className="font-medium">Require Attorney Review</div>
                <div className="text-sm text-muted-foreground">Prevent using non-reviewed templates</div>
              </div>
              <div className="font-semibold text-primary">{settings?.requireAttorneyReviewedTemplate ? "Enabled" : "Disabled"}</div>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Session Auto-lock</div>
                <div className="text-sm text-muted-foreground">Idle time before PIN required</div>
              </div>
              <div className="font-semibold">{settings?.autoLockMinutes} minutes</div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Mobile Field Sync</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-medium">Sync with RentNotice Field</div>
                <div className="text-sm text-muted-foreground max-w-xl">
                  Opt in to share field assignments with the mobile companion app for process
                  servers. Your desktop records stay local — only assignments you explicitly push,
                  and the evidence agents capture, pass through the sync relay.
                </div>
              </div>
              <Switch
                checked={settings?.syncEnabled === true}
                onCheckedChange={handleSyncToggle}
                disabled={!canManageSettings || updateSettings.isPending}
                data-testid="switch-field-sync"
              />
            </div>
            {settings?.syncEnabled && (
              <div className="text-sm text-muted-foreground border-t pt-4">
                Sync is on. Use the <span className="font-medium text-foreground">Field Service</span> page
                to push assignments to mobile agents and pull back service evidence.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
