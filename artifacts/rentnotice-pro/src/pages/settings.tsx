import { useState } from "react";
import {
  useSettings,
  useCompanyProfile,
  useWorkspaceState,
  useSyncLicense,
  useUpdateSettings,
  usePermissions,
  useSession,
  useChangeMyPassword,
  useHolidays,
  useAddHoliday,
  useDeleteHoliday,
} from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ActivationWizard } from "@/components/first-run";
import { BuildiumIntegrationCard } from "@/components/buildium-integration-card";
import { CommsIntegrationsCard } from "@/components/comms-integrations-card";
import { KeyRound, CalendarPlus, Trash2, Smartphone, Ban, Copy, Check } from "lucide-react";
import type { User } from "@/lib/types";
import { ALL_RULE_PACKS } from "@/lib/engine/rulepacks";
import { STATE_HOLIDAY_STATES, stateHolidaySource } from "@/lib/engine/stateHolidays";

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

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  staff: "Staff",
  readonly: "Read-only",
};

type FieldDevice = {
  id: string;
  deviceName: string;
  tokenSuffix: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

// Returned only by POST /api/field/devices — the plaintext code is shown
// once at issuance and cannot be retrieved again.
type IssuedFieldDevice = FieldDevice & { token: string };

// Field devices authenticate against the sync relay with per-device access
// codes. Issuing and revoking codes requires the desktop license key.
function FieldDevicesSection({
  licenseKey,
  canManage,
}: {
  licenseKey: string;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [deviceName, setDeviceName] = useState("");
  const [issuedToken, setIssuedToken] = useState<IssuedFieldDevice | null>(null);
  const [copied, setCopied] = useState(false);

  const headers = { "x-license-key": licenseKey };

  const { data: devices, isLoading, isError } = useQuery<FieldDevice[]>({
    queryKey: ["field-devices"],
    queryFn: async () => {
      const res = await fetch("/api/field/devices", { headers });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      return (await res.json()) as FieldDevice[];
    },
  });

  const issueDevice = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch("/api/field/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ deviceName: name }),
      });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      return (await res.json()) as IssuedFieldDevice;
    },
    onSuccess: (device) => {
      setIssuedToken(device);
      setCopied(false);
      setDeviceName("");
      qc.invalidateQueries({ queryKey: ["field-devices"] });
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not issue access code",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  });

  const revokeDevice = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/field/devices/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      return (await res.json()) as FieldDevice;
    },
    onSuccess: (device) => {
      qc.invalidateQueries({ queryKey: ["field-devices"] });
      toast({
        title: "Access revoked",
        description: `${device.deviceName || "The device"} can no longer sync.`,
      });
    },
    onError: (e: unknown) =>
      toast({
        title: "Could not revoke access",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      }),
  });

  const activeDevices = (devices ?? []).filter((d) => !d.revokedAt);

  return (
    <div className="border-t pt-4 space-y-4" data-testid="section-field-devices">
      <div>
        <div className="font-medium flex items-center gap-2">
          <Smartphone className="w-4 h-4" />
          Field device access codes
        </div>
        <div className="text-sm text-muted-foreground max-w-xl">
          The sync relay only accepts requests from devices with an access code. Issue a code for
          each phone running RentNotice Field and enter it in the app's sync settings. Revoke a
          code to immediately cut that device off.
        </div>
      </div>

      {canManage && (
        <form
          className="flex items-center gap-2 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            if (deviceName.trim()) issueDevice.mutate(deviceName.trim());
          }}
        >
          <Input
            placeholder="Device name (e.g. Marcus's iPhone)"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            data-testid="input-device-name"
          />
          <Button
            type="submit"
            disabled={!deviceName.trim() || issueDevice.isPending}
            data-testid="button-issue-device"
          >
            {issueDevice.isPending ? "Issuing…" : "Issue code"}
          </Button>
        </form>
      )}

      {issuedToken && (
        <div
          className="rounded-md border bg-muted/50 p-3 space-y-1"
          data-testid="panel-issued-token"
        >
          <div className="text-sm font-medium">
            Access code for {issuedToken.deviceName || "new device"}
          </div>
          <div className="flex items-center gap-2">
            <div className="font-mono text-lg tracking-wide" data-testid="text-issued-token">
              {issuedToken.token}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard
                  .writeText(issuedToken.token)
                  .then(() => setCopied(true))
                  .catch(() =>
                    toast({
                      title: "Could not copy",
                      description: "Copy the code manually instead.",
                      variant: "destructive",
                    }),
                  );
              }}
              data-testid="button-copy-token"
            >
              {copied ? (
                <Check className="w-4 h-4 mr-1" />
              ) : (
                <Copy className="w-4 h-4 mr-1" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Enter this code in the RentNotice Field app under Sync settings. For security, this
            code is shown only once — it cannot be viewed again after you leave this page.
          </div>
        </div>
      )}

      {isLoading && <div className="text-sm text-muted-foreground">Loading devices…</div>}
      {isError && (
        <div className="text-sm text-destructive">
          Could not load field devices. Check that the sync relay is reachable.
        </div>
      )}
      {devices && activeDevices.length === 0 && (
        <div className="text-sm text-muted-foreground" data-testid="text-no-devices">
          No field devices have access yet. Mobile apps cannot sync until you issue a code.
        </div>
      )}
      {activeDevices.length > 0 && (
        <div className="space-y-2">
          {activeDevices.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between gap-4 rounded-md border p-3"
              data-testid={`row-device-${d.id}`}
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{d.deviceName || "Unnamed device"}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  Code ending in ••••{d.tokenSuffix || "????"}
                </div>
                <div className="text-xs text-muted-foreground">
                  Added {formatDateTime(d.createdAt)} · Last sync {formatDateTime(d.lastUsedAt)}
                </div>
              </div>
              {canManage && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => revokeDevice.mutate(d.id)}
                  disabled={revokeDevice.isPending}
                  data-testid={`button-revoke-${d.id}`}
                >
                  <Ban className="w-4 h-4 mr-1" />
                  Revoke
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MyAccountCard({ user }: { user: User }) {
  const changePassword = useChangeMyPassword();
  const { toast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Accounts without a stored secret sign in without a password, so there is
  // no "current password" to confirm.
  const requiresCurrent = user.pin !== null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (newPassword.length < 8) {
      setFormError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setFormError("New password and confirmation do not match.");
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          toast({
            title: "Password changed",
            description: "Use your new password the next time you sign in.",
          });
        },
        onError: (err: unknown) => {
          setFormError(err instanceof Error ? err.message : "Could not change password.");
        },
      },
    );
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>My Account</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground">Name</div>
            <div data-testid="text-account-name">{user.name}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Username</div>
            <div data-testid="text-account-username">{user.username}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Email</div>
            <div data-testid="text-account-email">{user.email ?? "—"}</div>
          </div>
          <div>
            <div className="text-sm font-medium text-muted-foreground">Role</div>
            <div data-testid="text-account-role">{ROLE_LABELS[user.role] ?? user.role}</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="border-t pt-4 space-y-4">
          <div>
            <div className="font-medium">Change Password</div>
            <div className="text-sm text-muted-foreground">
              Your password is used to sign in on this device
              {user.cloudUserId ? " and on the customer website" : ""}. Minimum 8 characters.
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl">
            {requiresCurrent && (
              <div className="space-y-2">
                <Label htmlFor="current-password">Current password</Label>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  data-testid="input-current-password"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                data-testid="input-new-password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                data-testid="input-confirm-password"
              />
            </div>
          </div>
          {formError && (
            <p className="text-sm text-destructive" data-testid="text-change-password-error">
              {formError}
            </p>
          )}
          <Button
            type="submit"
            disabled={changePassword.isPending}
            data-testid="button-change-password"
          >
            <KeyRound className="h-4 w-4 mr-2" />
            {changePassword.isPending ? "Changing…" : "Change Password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function HolidaysCard({ canManage }: { canManage: boolean }) {
  const { data: holidays } = useHolidays();
  const addHoliday = useAddHoliday();
  const deleteHoliday = useDeleteHoliday();
  const { toast } = useToast();
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [jurisdiction, setJurisdiction] = useState("US");

  const custom = (holidays ?? []).filter((h) => !h.builtIn).sort((a, b) => (a.date < b.date ? -1 : 1));

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !name.trim()) return;
    addHoliday.mutate(
      { date, name: name.trim(), jurisdiction, courtHoliday: true },
      {
        onSuccess: () => {
          setDate("");
          setName("");
          toast({
            title: "Holiday added",
            description: "Deadline calculations will now treat this date as a court closure.",
          });
        },
        onError: (err: unknown) =>
          toast({
            title: "Could not add holiday",
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <CardTitle>Court & State Holidays</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            Deadline calculations use bundled holiday calendars for California and the states
            below. Other states fall back to the federal holiday set with a warning. Add custom
            closures for other states, office-specific closure days, or newly announced court
            holidays — pick "All states" for nationwide closures.
          </p>
          <ul className="list-disc pl-5">
            {STATE_HOLIDAY_STATES.map((s) => (
              <li key={s}>{stateHolidaySource(s)}</li>
            ))}
          </ul>
        </div>
        {canManage && (
          <form onSubmit={handleAdd} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
            <div className="space-y-2">
              <Label htmlFor="holiday-date">Date</Label>
              <Input
                id="holiday-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                data-testid="input-holiday-date"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="holiday-name">Name</Label>
              <Input
                id="holiday-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. County court closure"
                required
                data-testid="input-holiday-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Applies to</Label>
              <Select value={jurisdiction} onValueChange={setJurisdiction}>
                <SelectTrigger data-testid="select-holiday-jurisdiction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">All states</SelectItem>
                  {ALL_RULE_PACKS.map((p) => (
                    <SelectItem key={p.state} value={p.state}>
                      {p.stateName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={addHoliday.isPending} data-testid="button-add-holiday">
              <CalendarPlus className="h-4 w-4 mr-2" />
              {addHoliday.isPending ? "Adding…" : "Add Holiday"}
            </Button>
          </form>
        )}
        {custom.length > 0 ? (
          <div className="border rounded-md divide-y">
            {custom.map((h) => (
              <div
                key={h.id}
                className="flex items-center justify-between px-3 py-2 text-sm"
                data-testid={`row-holiday-${h.id}`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono">{h.date}</span>
                  <span>{h.name}</span>
                  <span className="text-muted-foreground text-xs uppercase">
                    {h.jurisdiction === "US" || !h.jurisdiction ? "All states" : h.jurisdiction}
                  </span>
                </div>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      deleteHoliday.mutate(h.id, {
                        onError: (err: unknown) =>
                          toast({
                            title: "Could not remove holiday",
                            description: err instanceof Error ? err.message : String(err),
                            variant: "destructive",
                          }),
                      })
                    }
                    data-testid={`button-delete-holiday-${h.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No custom holidays added.</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { data: settings } = useSettings();
  const { data: company } = useCompanyProfile();
  const { data: workspace } = useWorkspaceState();
  const { data: session } = useSession();
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
        {session?.user && !session.locked && <MyAccountCard user={session.user} />}

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
                <div className="text-sm text-muted-foreground">Idle time before password required</div>
              </div>
              <div className="font-semibold">{settings?.autoLockMinutes} minutes</div>
            </div>
          </CardContent>
        </Card>

        <BuildiumIntegrationCard />

        <CommsIntegrationsCard />

        <HolidaysCard canManage={canManageSettings} />

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
            {settings?.syncEnabled && activation && (
              <FieldDevicesSection
                licenseKey={activation.licenseKey}
                canManage={canManageSettings}
              />
            )}
            {settings?.syncEnabled && !activation && (
              <div className="text-sm text-muted-foreground border-t pt-4">
                Field sync now requires an activated license. Activate this workspace to push
                assignments and issue device access codes.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
