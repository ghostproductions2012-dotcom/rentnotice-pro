import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSession, useSelectUser, useLockApp, useUsers, usePermissions } from "@/lib/api/hooks";
import { Building, Users, FileText, Calendar as CalendarIcon, Settings as SettingsIcon, LogOut, Lock, LayoutDashboard, Database, Scale, ShieldAlert, BarChart, History } from "lucide-react";
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
import { useState } from "react";

const queryClient = new QueryClient();

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
  const { data: users, isLoading } = useUsers();
  const selectUser = useSelectUser();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [pin, setPin] = useState("");

  if (isLoading) return <div className="flex min-h-screen items-center justify-center bg-background"><div className="animate-pulse w-8 h-8 rounded-full bg-primary/20" /></div>;

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedUserId) {
      selectUser.mutate({ userId: selectedUserId, pin });
    }
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
          <CardDescription className="text-base">Secure Legal Operations</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {users?.filter(u => u.active).map(u => (
                  <Button
                    key={u.id}
                    type="button"
                    variant={selectedUserId === u.id ? "default" : "outline"}
                    className="h-auto py-4 flex flex-col items-center gap-2 justify-center"
                    onClick={() => { setSelectedUserId(u.id); setPin(""); }}
                  >
                    <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm font-medium text-foreground">
                      {u.initials}
                    </div>
                    <span className="text-sm">{u.name}</span>
                  </Button>
                ))}
              </div>
              
              {selectedUserId && users?.find(u => u.id === selectedUserId)?.pin !== null && (
                <div className="space-y-2 animate-in fade-in slide-in-from-bottom-2">
                  <label className="text-sm font-medium">PIN Required</label>
                  <Input 
                    type="password" 
                    placeholder="Enter PIN" 
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="text-center text-lg tracking-widest"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              )}
            </div>
            
            <Button 
              type="submit" 
              className="w-full" 
              disabled={!selectedUserId || (users?.find(u => u.id === selectedUserId)?.pin !== null && pin.length < 4) || selectUser.isPending}
            >
              {selectUser.isPending ? "Authenticating..." : "Access Workspace"}
            </Button>
          </form>
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

  const navGroups = [
    {
      title: "Operations",
      items: [
        { icon: LayoutDashboard, label: "Dashboard", href: "/" },
        { icon: FileText, label: "Notices", href: "/notices" },
        { icon: Database, label: "Ledger Import", href: "/import" },
        { icon: CalendarIcon, label: "Calendar", href: "/calendar" },
      ]
    },
    {
      title: "Records",
      items: [
        { icon: Building, label: "Properties", href: "/properties" },
        { icon: Users, label: "Tenants", href: "/tenants" },
        { icon: Scale, label: "Templates", href: "/templates" },
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
  const { data: session, isLoading } = useSession();

  if (isLoading) return null;
  if (!session?.user || session.locked) return <LockScreen />;

  return (
    <div className="flex min-h-[100dvh] w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
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
        <Route path="/templates" component={TemplatesList} />
        <Route path="/templates/:id" component={TemplateView} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/audit" component={AuditPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
