import {
  useGetAdminMe,
  useAdminLogout,
  getGetAdminMeQueryKey,
} from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { LogOut, ShieldCheck } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { data: admin, isLoading, isError } = useGetAdminMe({
    query: { retry: false, queryKey: getGetAdminMeQueryKey() },
  });

  const logout = useAdminLogout();

  useEffect(() => {
    if (isError) {
      setLocation("/admin/login");
    }
  }, [isError, setLocation]);

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
      queryClient.removeQueries({ queryKey: getGetAdminMeQueryKey() });
      setLocation("/admin/login");
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

  if (!admin) return null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-muted/20">
      <header className="border-b bg-card sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-2 sm:gap-4">
          <Link
            href="/admin"
            className="flex items-center gap-2 font-serif font-bold text-base sm:text-lg text-primary min-w-0"
          >
            <ShieldCheck className="w-5 h-5 shrink-0" />
            <span className="truncate">RentNotice Pro</span>
            <span className="hidden sm:inline-block text-xs font-sans font-semibold uppercase tracking-wide bg-primary/10 text-primary rounded px-2 py-0.5 whitespace-nowrap">
              Platform Admin
            </span>
          </Link>
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden sm:block text-sm text-muted-foreground truncate max-w-[220px]">
              {admin.email}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleLogout}
              disabled={logout.isPending}
              data-testid="button-admin-logout"
            >
              <LogOut className="w-4 h-4 mr-2" />
              {logout.isPending ? "Logging out..." : "Log out"}
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1 py-8 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
