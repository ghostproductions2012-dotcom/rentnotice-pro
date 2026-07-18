import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession, useLogin, useLockApp, usePermissions, useWorkspaceState, useSyncLicense, useSampleDataState } from "@/lib/api/hooks";
import { FirstRunScreen, ActivationWizard } from "@/components/first-run";
import { StartupErrorScreen } from "@/components/startup-error";
import { computeRouterBase } from "@/lib/router-base";
import { LICENSE_BLOCK_MESSAGES } from "@/lib/types";
import { evaluateGraceWarning } from "@/lib/licensing/gate";
import { BookOpen, Building, Users, FileText, Calendar as CalendarIcon, Settings as SettingsIcon, LogOut, Lock, LayoutDashboard, Database, Scale, ShieldAlert, BarChart, History, MapPin, MessageSquare, Wrench, X, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { LEGAL_DISCLAIMER } from "@/lib/types";

// Pages
import Dashboard from "@/pages/dashboard";
import PropertiesList from "@/pages/properties/index";
import PropertyView from "@/pages/properties/view";
import TenantsList from "@/pages/tenants/index";
import TenantView from "@/pages/tenants/view";
import ImportWizard from "@/pages/import";
import NoticesList from "@/pages/notices/index";
import NoticeNew from "@/pages/notices/new";
import NoticeView from "@/pages/notices/view";
import CalendarPage from "@/pages/calendar";
import TemplatesList from "@/pages/templates/index";
import TemplateView from "@/pages/templates/view";
import ReportsPage from "@/pages/reports";
import AuditPage from "@/pages/audit";
import SettingsPage from "@/pages/settings";
import StateRulesPage from "@/pages/state-rules";
import FieldAssignmentsPage from "@/pages/field";
import MaintenancePage from "@/pages/maintenance";
import CommunicationsPage from "@/pages/communications";
import { useEffect, useRef, useState } from "react";

// All queries hit the local embedded database, so network-style retries only
// delay error surfacing. One retry covers transient hiccups; a failed database
// open sticks (see getDb) so the startup error screen appears quickly.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1 } },
});

function NotFound() {
  return (
    <div className="flex h-[calc(100vh-100px)] w-full items-center justify-center p-8">
      <div className="text-center space-y-4">
        <ShieldAlert className="w-12 h-12 mx-auto text-muted-foreground" />
        <h1 className="text-2xl font-serif font-bold text-foreground">Page Not Found</h1>
        <p className="text-muted-foreground">The requested record or view could not be located.</p>
      </div>
    </div>
  );
}

function LockScreen() {
  const { data: session } = useSession();
  const { data: workspace } = useWorkspaceState();
  const login = useLogin();
  const lockedUser = session?.locked ? session.user : null;
  const [identifier, setIdentifier] = useState(lockedUser?.username ?? "");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showActivate, setShowActivate] = useState(false);

  if (showActivate) {
    return <ActivationWizard onCancel={() => setShowActivate(false)} replacesExistingData />;
  }

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { identifier: identifier.trim(), secret },
      {
        onError: (err) =>
          setError(err instanceof Error ? err.message : "Sign-in failed. Please try again."),
      },
    );
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background" />
      <Card className="w-full max-w-md shadow-xl border-primary/10 relative z-10">
        <CardHeader className="text-center space-y-2 pb-8">
          <div className="w-16 h-16 bg-primary text-primary-foreground rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
            <Scale className="w-8 h-8" />
          </div>
          <CardTitle className="text-3xl font-serif font-semibold tracking-tight">RentNotice Pro</CardTitle>
          <CardDescription className="text-base">
            {lockedUser ? `Workspace locked — sign in to continue` : "Secure Legal Operations"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="login-identifier">Email</label>
                <Input
                  id="login-identifier"
                  type="text"
                  autoComplete="username"
                  placeholder="jchen@company.com"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoFocus={!lockedUser}
                  data-testid="input-login-identifier"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium" htmlFor="login-secret">Password</label>
                <Input
                  id="login-secret"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  autoFocus={!!lockedUser}
                  data-testid="input-login-secret"
                />
              </div>
              {error && (
                <p className="text-sm text-destructive" role="alert" data-testid="text-login-error">
                  {error}
                </p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={!identifier.trim() || login.isPending}
              data-testid="button-login"
            >
              {login.isPending ? "Authenticating..." : "Access Workspace"}
            </Button>
          </form>
          {workspace?.mode === "demo" && (
            <p className="text-xs text-muted-foreground text-center mt-6">
              Demo workspace ·{" "}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => setShowActivate(true)}
                data-testid="link-activate-license"
              >
                Activate with a company license
              </button>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Sidebar() {
  const [location, setLocation] = useLocation();
  const lockApp = useLockApp();
  const { data: session } = useSession();
  const { isReadOnly } = usePermissions();
  const { data: sampleData } = useSampleDataState();

  const navGroups = [
    {
      title: "Operations",
      items: [
        { icon: LayoutDashboard, label: "Dashboard", href: "/" },
        { icon: FileText, label: "Notices", href: "/notices" },
        { icon: Database, label: "Ledger Import", href: "/import" },
        { icon: CalendarIcon, label: "Calendar", href: "/calendar" },
        { icon: MapPin, label: "Field Service", href: "/field-service" },
        { icon: Wrench, label: "Maintenance", href: "/maintenance" },
        { icon: MessageSquare, label: "Communications", href: "/communications" },
      ]
    },
    {
      title: "Records",
      items: [
        { icon: Building, label: "Properties", href: "/properties" },
        { icon: Users, label: "Tenants", href: "/tenants" },
        { icon: Scale, label: "Templates", href: "/templates" },
        { icon: BookOpen, label: "State Rules", href: "/state-rules" },
      ]
    },
    {
      title: "Administration",
      items: [
        { icon: BarChart, label: "Reports", href: "/reports" },
        { icon: History, label: "Audit Log", href: "/audit" },
        { icon: SettingsIcon, label: "Settings", href: "/settings" },
      ]
    }
  ];

  return (
    <div className="w-64 border-r bg-card flex flex-col h-[100dvh] sticky top-0 shrink-0">
      <div className="p-6 flex items-center gap-3 border-b shrink-0">
        <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-primary-foreground">
          <Scale className="w-4 h-4" />
        </div>
        <span className="font-serif font-bold text-lg tracking-tight">RentNotice Pro</span>
      </div>
      
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-6">
        {navGroups.map(group => (
          <div key={group.title} className="space-y-1">
            <h4 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{group.title}</h4>
            {group.items.map(item => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <button
                  key={item.href}
                  onClick={() => setLocation(item.href)}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive 
                      ? "bg-primary text-primary-foreground" 
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="p-4 border-t space-y-4 shrink-0 bg-muted/20">
        {sampleData?.active && (
          <button
            type="button"
            onClick={() => setLocation("/settings")}
            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide hover:bg-amber-500/25 transition-colors"
            title="A generated sample portfolio is loaded. Manage it in Settings."
            data-testid="badge-sample-data"
          >
            <FlaskConical className="w-3 h-3" />
            Sample data
          </button>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium border border-border/50">
              {session?.user?.initials}
            </div>
            <div className="flex flex-col text-left">
              <span className="text-sm font-medium leading-none">{session?.user?.name}</span>
              <span className="text-xs text-muted-foreground mt-1 capitalize">{session?.user?.role}</span>
            </div>
          </div>
          {isReadOnly && (
            <span
              className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border/50"
              title="Read-only access: you can view records but cannot make changes."
              data-testid="badge-readonly"
            >
              View only
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={() => lockApp.mutate()} title="Lock Workspace">
            <Lock className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { data: session, isLoading, error: sessionError } = useSession();
  const {
    data: workspace,
    isLoading: workspaceLoading,
    error: workspaceError,
  } = useWorkspaceState();
  const syncLicense = useSyncLicense();
  const launchSyncDone = useRef(false);
  // Days-remaining value at which the user last dismissed the grace warning;
  // the banner reappears when the countdown drops below that value.
  const [graceWarningDismissedAt, setGraceWarningDismissedAt] = useState<number | null>(null);

  // Launch-time re-verification: refresh license status and user directory
  // once per app boot. Offline is fine — cached state + grace period apply.
  useEffect(() => {
    if (workspace?.mode === "activated" && !launchSyncDone.current) {
      launchSyncDone.current = true;
      syncLicense.mutate(undefined, { onError: () => {} });
    }
  }, [workspace?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Periodic re-verification while the app stays open: check hourly, sync
  // whenever the last successful online check is 24h+ old.
  const lastVerifiedAt = workspace?.activation?.lastVerifiedAt ?? null;
  useEffect(() => {
    if (workspace?.mode !== "activated") return;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const id = setInterval(() => {
      const last = lastVerifiedAt ? new Date(lastVerifiedAt).getTime() : NaN;
      if (!Number.isFinite(last) || Date.now() - last >= DAY_MS) {
        syncLicense.mutate(undefined, { onError: () => {} });
      }
    }, 60 * 60 * 1000);
    return () => clearInterval(id);
  }, [workspace?.mode, lastVerifiedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Surface startup failures (database open/migration errors) instead of
  // silently falling through to the lock screen with no data behind it.
  const bootError = sessionError ?? workspaceError;
  if (bootError) return <StartupErrorScreen error={bootError} />;

  // Visible boot indicator: never a fully blank window while the local
  // database opens (or while a failure is still retrying).
  if (isLoading || workspaceLoading) {
    return (
      <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">Loading workspace…</span>
        </div>
      </div>
    );
  }
  if (workspace?.mode === "unset") return <FirstRunScreen />;
  if (!session?.user || session.locked) return <LockScreen />;

  // Grace-period countdown warning: shown a few days before the offline grace
  // window expires (never alongside the blocked banner, which takes over at expiry).
  const graceWarning =
    workspace && !workspace.licenseBlocked
      ? evaluateGraceWarning(workspace.mode, workspace.activation)
      : null;
  const showGraceWarning =
    graceWarning !== null &&
    (graceWarningDismissedAt === null || graceWarning.daysRemaining < graceWarningDismissedAt);

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {workspace?.licenseBlocked && (
          <div
            className="px-8 py-3 bg-destructive/10 border-b border-destructive/20 text-sm flex items-center justify-between gap-4 shrink-0"
            data-testid="banner-license-blocked"
          >
            <span className="text-destructive font-medium">
              {LICENSE_BLOCK_MESSAGES[workspace.licenseBlockReason ?? "grace_expired"]}
              {(workspace.licenseBlockReason === "paused" ||
                workspace.licenseBlockReason === "cancelled") &&
                workspace.activation?.statusReason && (
                  <span className="font-normal" data-testid="text-license-block-reason">
                    {" "}
                    ({workspace.activation.statusReason})
                  </span>
                )}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncLicense.mutate(undefined, { onError: () => {} })}
              disabled={syncLicense.isPending}
              data-testid="button-sync-license-banner"
            >
              {syncLicense.isPending ? "Syncing…" : "Sync now"}
            </Button>
          </div>
        )}
        {showGraceWarning && (
          <div
            className="px-8 py-3 bg-amber-500/10 border-b border-amber-500/20 text-sm flex items-center justify-between gap-4 shrink-0"
            data-testid="banner-grace-warning"
          >
            <span className="text-amber-700 dark:text-amber-400 font-medium">
              {graceWarning.daysRemaining <= 0
                ? "Your offline grace period ends today. Reconnect and re-check your license now to keep working."
                : `Reconnect within ${graceWarning.daysRemaining} ${graceWarning.daysRemaining === 1 ? "day" : "days"} to keep working. This device hasn't verified your company license recently, and editing will lock when the offline grace period ends.`}
            </span>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                onClick={() => syncLicense.mutate(undefined, { onError: () => {} })}
                disabled={syncLicense.isPending}
                data-testid="button-grace-recheck"
              >
                {syncLicense.isPending ? "Checking…" : "Re-check now"}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => setGraceWarningDismissedAt(graceWarning.daysRemaining)}
                title="Dismiss"
                data-testid="button-grace-dismiss"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-8 relative">
          <div className="max-w-6xl mx-auto h-full">
            {children}
          </div>
        </main>
        <footer className="px-8 py-6 border-t bg-muted/30 text-xs text-muted-foreground text-center shrink-0">
          <div className="max-w-4xl mx-auto leading-relaxed">
            {LEGAL_DISCLAIMER}
          </div>
        </footer>
      </div>
    </div>
  );
}

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/properties" component={PropertiesList} />
        <Route path="/properties/:id" component={PropertyView} />
        <Route path="/tenants" component={TenantsList} />
        <Route path="/tenants/:id" component={TenantView} />
        <Route path="/import" component={ImportWizard} />
        <Route path="/notices" component={NoticesList} />
        <Route path="/notices/new" component={NoticeNew} />
        <Route path="/notices/:id" component={NoticeView} />
        <Route path="/calendar" component={CalendarPage} />
        <Route path="/field-service" component={FieldAssignmentsPage} />
        <Route path="/maintenance" component={MaintenancePage} />
        <Route path="/communications" component={CommunicationsPage} />
        <Route path="/templates" component={TemplatesList} />
        <Route path="/templates/:id" component={TemplateView} />
        <Route path="/state-rules" component={StateRulesPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

// See computeRouterBase: the desktop build's relative BASE_URL ("./") must
// never be used as the wouter base or no route ever matches (empty main pane).
const routerBase = computeRouterBase(import.meta.env.BASE_URL);

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={routerBase}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
