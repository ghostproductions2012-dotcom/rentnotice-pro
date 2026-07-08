import { useGetMe, useLogout, getGetMeQueryKey } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, LayoutDashboard, Users, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: user, isLoading, isError, error } = useGetMe({
    query: { retry: false, queryKey: getGetMeQueryKey() }
  });
  
  const logout = useLogout();

  useEffect(() => {
    if (isError) {
      const apiError = error as any;
      if (apiError?.status === 401) {
        setLocation("/login");
      }
    }
  }, [isError, error, setLocation]);

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setLocation("/login");
    } catch (e) {
      console.error(e);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30">
        <div className="flex flex-col items-center gap-4">
          <Skeleton className="h-12 w-12 rounded-full" />
          <Skeleton className="h-4 w-32" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-[100dvh] flex flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="w-full md:w-64 border-r bg-card flex flex-col">
        <div className="p-6 border-b">
          <div className="font-serif font-bold text-xl text-primary mb-1">RentNotice Pro</div>
          <div className="text-sm font-medium text-muted-foreground truncate">{user.companyName}</div>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
          <Link href="/portal" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${location === "/portal" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
              <LayoutDashboard className="w-4 h-4" />
              Overview
          </Link>
          <Link href="/portal/users" className={`flex items-center gap-3 px-3 py-2 rounded-md transition-colors ${location === "/portal/users" ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted text-muted-foreground hover:text-foreground"}`}>
              <Users className="w-4 h-4" />
              Team
          </Link>
        </nav>

        <div className="p-4 border-t bg-muted/20">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center font-bold text-xs">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="text-sm font-medium truncate">{user.name}</div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                {user.role === 'admin' && <ShieldCheck className="w-3 h-3 text-primary" />}
                <span className="capitalize">{user.role}</span>
              </div>
            </div>
          </div>
          <Button variant="outline" className="w-full justify-start text-muted-foreground" onClick={handleLogout} disabled={logout.isPending}>
            <LogOut className="w-4 h-4 mr-2" />
            {logout.isPending ? "Logging out..." : "Log out"}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
