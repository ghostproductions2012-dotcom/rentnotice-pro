// ---------------------------------------------------------------------------
// Slack / Google Chat integration card for the Settings page.
//
// Webhook URLs are stored on the api-server (scoped by license key) and only
// masked previews come back to the desktop. Admins pick which communication
// events fan out to the connected webhooks and whether team chat messages are
// mirrored there too.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetIntegrationSettings,
  getGetIntegrationSettingsQueryKey,
  useUpdateIntegrationSettings,
  useTestIntegration,
  login,
  getMe,
  ApiError,
  type SessionUser,
  type UpdateIntegrationSettingsRequest,
  type UpdateIntegrationSettingsRequestEventsItem,
  type TestIntegrationRequestTarget,
} from "@workspace/api-client-react";
import { registerCommsLicenseKey, useCommsIdentity } from "@/lib/comms/identity";
import { useRecordCommsAudit } from "@/lib/api/hooks";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Loader2, LogIn, Send, ShieldCheck, Unlink, Webhook } from "lucide-react";

registerCommsLicenseKey();

const EVENT_OPTIONS: {
  value: UpdateIntegrationSettingsRequestEventsItem;
  label: string;
  description: string;
}[] = [
  {
    value: "work_order_assigned",
    label: "Work order assigned",
    description: "A work order is assigned to a technician",
  },
  {
    value: "work_order_completed",
    label: "Work order completed",
    description: "A technician marks a work order complete",
  },
  {
    value: "notice_served",
    label: "Notice served",
    description: "A field agent records service of a legal notice",
  },
  {
    value: "tenant_email_sent",
    label: "Tenant email sent",
    description: "A tenant email or announcement is sent",
  },
];

export function CommsIntegrationsCard() {
  const identity = useCommsIdentity();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const enabled = identity.ready && identity.isAdmin;
  const settingsQuery = useGetIntegrationSettings({
    query: { queryKey: getGetIntegrationSettingsQueryKey(), enabled },
  });
  const settings = settingsQuery.data;

  // Changing integration settings requires a server-verified administrator:
  // the API only accepts writes from a signed-in portal session with the
  // admin role (a license key alone identifies the company, not the person).
  const [portalUser, setPortalUser] = useState<SessionUser | null>(null);
  const [portalChecked, setPortalChecked] = useState(false);
  useEffect(() => {
    if (!enabled || !identity.activated) return;
    let cancelled = false;
    getMe()
      .then((me) => {
        if (!cancelled) setPortalUser(me);
      })
      .catch(() => {
        if (!cancelled) setPortalUser(null);
      })
      .finally(() => {
        if (!cancelled) setPortalChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, identity.activated]);
  const portalAdmin =
    !!portalUser && (portalUser.role === "admin" || portalUser.isMasterAdmin);

  // When the server rejects a write because the session expired, surface the
  // sign-in form again instead of a dead-end error toast.
  const handleAuthError = (err: unknown): boolean => {
    if (err instanceof ApiError && err.status === 403) {
      const code = (err.data as { code?: string } | null)?.code;
      if (code === "admin_session_required") {
        setPortalUser(null);
        toast({
          title: "Administrator sign-in required",
          description: "Your portal session has expired. Please sign in again.",
          variant: "destructive",
        });
        return true;
      }
    }
    return false;
  };

  const updateSettings = useUpdateIntegrationSettings();
  const testIntegration = useTestIntegration();
  const recordAudit = useRecordCommsAudit();

  const [slackUrl, setSlackUrl] = useState("");
  const [googleUrl, setGoogleUrl] = useState("");
  const [events, setEvents] = useState<UpdateIntegrationSettingsRequestEventsItem[]>([]);
  const [mirror, setMirror] = useState(false);
  const [testing, setTesting] = useState<TestIntegrationRequestTarget | null>(null);

  // Sync toggles from the server whenever fresh settings arrive.
  useEffect(() => {
    if (!settings) return;
    setEvents(settings.events);
    setMirror(settings.mirrorTeamChat);
  }, [settings]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getGetIntegrationSettingsQueryKey() });

  const save = (data: UpdateIntegrationSettingsRequest, successTitle: string) => {
    updateSettings.mutate(
      { data },
      {
        onSuccess: () => {
          setSlackUrl("");
          setGoogleUrl("");
          toast({ title: successTitle });
          refresh();
          recordAudit.mutate({
            action: "settings_changed",
            entityId: null,
            summary: `Chat integrations: ${successTitle.toLowerCase()}`,
          });
        },
        onError: (err) => {
          if (handleAuthError(err)) return;
          toast({
            title: "Could not save integration settings",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
      },
    );
  };

  const handleSave = () => {
    const data: UpdateIntegrationSettingsRequest = {
      events,
      mirrorTeamChat: mirror,
    };
    if (slackUrl.trim()) data.slackWebhookUrl = slackUrl.trim();
    if (googleUrl.trim()) data.googleChatWebhookUrl = googleUrl.trim();
    save(data, "Integration settings saved");
  };

  const handleDisconnect = (target: TestIntegrationRequestTarget) => {
    save(
      target === "slack" ? { slackWebhookUrl: "" } : { googleChatWebhookUrl: "" },
      target === "slack" ? "Slack disconnected" : "Google Chat disconnected",
    );
  };

  const handleTest = (target: TestIntegrationRequestTarget) => {
    setTesting(target);
    testIntegration.mutate(
      { data: { target } },
      {
        onSuccess: (result) =>
          toast({
            title: result.ok ? "Test message sent" : "Test failed",
            description: result.message,
            variant: result.ok ? "default" : "destructive",
          }),
        onError: (err) => {
          if (handleAuthError(err)) return;
          toast({
            title: "Test failed",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          });
        },
        onSettled: () => setTesting(null),
      },
    );
  };

  const toggleEvent = (value: UpdateIntegrationSettingsRequestEventsItem, checked: boolean) => {
    setEvents((prev) =>
      checked ? [...new Set([...prev, value])] : prev.filter((e) => e !== value),
    );
  };

  return (
    <Card className="md:col-span-2" data-testid="card-comms-integrations">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Webhook className="w-5 h-5" />
          Slack & Google Chat Notifications
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!identity.activated ? (
          <p className="text-sm text-muted-foreground">
            Activate your workspace with a company license to connect Slack or Google Chat.
          </p>
        ) : !identity.isAdmin ? (
          <p className="text-sm text-muted-foreground">
            Only administrators can manage chat integrations.
          </p>
        ) : !portalChecked ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Checking administrator session…
          </div>
        ) : !portalAdmin ? (
          <PortalSignIn
            onSignedIn={(user) => {
              setPortalUser(user);
              refresh();
            }}
          />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5" />
              Verified as {portalUser?.email}
            </div>
            <p className="text-sm text-muted-foreground">
              Push company activity into your team's Slack or Google Chat space using
              incoming webhooks. Webhook URLs are stored securely on the RentNotice
              cloud — only a masked preview is shown here.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <WebhookField
                label="Slack webhook URL"
                testId="slack"
                configured={settings?.slackConfigured ?? false}
                masked={settings?.slackWebhookUrlMasked ?? ""}
                placeholder="https://hooks.slack.com/services/…"
                value={slackUrl}
                onChange={setSlackUrl}
                onTest={() => handleTest("slack")}
                onDisconnect={() => handleDisconnect("slack")}
                testing={testing === "slack"}
                busy={updateSettings.isPending}
              />
              <WebhookField
                label="Google Chat webhook URL"
                testId="google-chat"
                configured={settings?.googleChatConfigured ?? false}
                masked={settings?.googleChatWebhookUrlMasked ?? ""}
                placeholder="https://chat.googleapis.com/v1/spaces/…"
                value={googleUrl}
                onChange={setGoogleUrl}
                onTest={() => handleTest("google_chat")}
                onDisconnect={() => handleDisconnect("google_chat")}
                testing={testing === "google_chat"}
                busy={updateSettings.isPending}
              />
            </div>

            <div className="space-y-3">
              <Label>Send a notification when…</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {EVENT_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex items-start gap-3 rounded-md border p-3 cursor-pointer"
                    data-testid={`checkbox-event-${opt.value}`}
                  >
                    <Checkbox
                      checked={events.includes(opt.value)}
                      onCheckedChange={(checked) => toggleEvent(opt.value, checked === true)}
                    />
                    <span className="space-y-0.5">
                      <span className="block text-sm font-medium leading-none">
                        {opt.label}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <div className="text-sm font-medium">Mirror team chat</div>
                <div className="text-xs text-muted-foreground">
                  Also post team chat messages to the connected webhooks
                </div>
              </div>
              <Switch
                checked={mirror}
                onCheckedChange={setMirror}
                data-testid="switch-mirror-team-chat"
              />
            </div>

            <div className="flex justify-end">
              <Button
                onClick={handleSave}
                disabled={updateSettings.isPending}
                data-testid="button-save-integrations"
              >
                {updateSettings.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                )}
                Save Notification Settings
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PortalSignIn(props: { onSignedIn: (user: SessionUser) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSignIn = async () => {
    if (!email.trim() || !password) return;
    setBusy(true);
    try {
      const user = await login({ email: email.trim(), password });
      if (user.role !== "admin" && !user.isMasterAdmin) {
        toast({
          title: "Administrator account required",
          description:
            "That account is not an administrator, so it cannot manage integrations.",
          variant: "destructive",
        });
        return;
      }
      setPassword("");
      props.onSignedIn(user);
      toast({ title: `Signed in as ${user.email}` });
    } catch (err) {
      toast({
        title: "Sign-in failed",
        description:
          err instanceof ApiError && err.status === 401
            ? "Invalid email or password."
            : err instanceof Error
              ? err.message
              : undefined,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="panel-integrations-signin">
      <p className="text-sm text-muted-foreground">
        Managing Slack and Google Chat integrations requires verifying your
        administrator account with the RentNotice cloud. Sign in with your
        customer portal credentials to continue.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="input-portal-email">Portal email</Label>
          <Input
            id="input-portal-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="input-portal-email"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="input-portal-password">Password</Label>
          <Input
            id="input-portal-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSignIn();
            }}
            data-testid="input-portal-password"
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() => void handleSignIn()}
          disabled={busy || !email.trim() || !password}
          data-testid="button-portal-signin"
        >
          {busy ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <LogIn className="w-4 h-4 mr-2" />
          )}
          Verify Administrator
        </Button>
      </div>
    </div>
  );
}

function WebhookField(props: {
  label: string;
  testId: string;
  configured: boolean;
  masked: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onTest: () => void;
  onDisconnect: () => void;
  testing: boolean;
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`input-webhook-${props.testId}`}>{props.label}</Label>
        {props.configured && (
          <Badge variant="secondary" data-testid={`badge-connected-${props.testId}`}>
            Connected
          </Badge>
        )}
      </div>
      <Input
        id={`input-webhook-${props.testId}`}
        type="url"
        placeholder={props.configured ? props.masked : props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        data-testid={`input-webhook-${props.testId}`}
      />
      {props.configured && (
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={props.onTest}
            disabled={props.testing}
            data-testid={`button-test-${props.testId}`}
          >
            {props.testing ? (
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5 mr-1.5" />
            )}
            Send Test
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onDisconnect}
            disabled={props.busy}
            data-testid={`button-disconnect-${props.testId}`}
          >
            <Unlink className="w-3.5 h-3.5 mr-1.5" />
            Disconnect
          </Button>
        </div>
      )}
    </div>
  );
}
