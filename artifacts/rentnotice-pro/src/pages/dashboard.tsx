import { useDashboard, useNotices } from "@/lib/api/hooks";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/types";
import { FileText, AlertCircle, Building, Users, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: dashboard, isLoading } = useDashboard();
  const { data: notices } = useNotices();

  if (isLoading || !dashboard) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-64 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Operations Overview</h1>
          <p className="text-muted-foreground mt-1">Real-time status of legal notices and compliance.</p>
        </div>
        <Button asChild>
          <Link href="/notices/new">Prepare New Notice</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Notices</CardTitle>
            <FileText className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.totals.activeNotices}</div>
            <p className="text-xs text-muted-foreground mt-1">Across all properties</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Demanded</CardTitle>
            <span className="text-lg font-serif">§</span>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{formatCents(dashboard.totals.totalDemandedCents)}</div>
            <p className="text-xs text-muted-foreground mt-1">Outstanding balances</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Needs Review</CardTitle>
            <AlertCircle className={`w-4 h-4 ${dashboard.countsByStatus.needs_review > 0 ? 'text-destructive' : 'text-muted-foreground'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.countsByStatus.needs_review}</div>
            <p className="text-xs text-muted-foreground mt-1">Awaiting approval</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-sm font-medium text-muted-foreground">Expiring Soon</CardTitle>
            <CalendarIcon className="w-4 h-4 text-accent" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{dashboard.expiringSoon.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Within 3 days</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-serif font-semibold">Action Required</h2>
          
          {dashboard.needsReview.length > 0 ? (
            <div className="space-y-4">
              {dashboard.needsReview.map(notice => (
                <Card key={notice.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4 flex flex-row items-center justify-between">
                    <div>
                      <h3 className="font-medium">{notice.tenantNames.join(", ")}</h3>
                      <p className="text-sm text-muted-foreground">{notice.propertyAddress}, Unit {notice.unit}</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <div className="font-medium">{formatCents(notice.totalAmountCents)}</div>
                        <div className="text-xs text-muted-foreground">Draft</div>
                      </div>
                      <Button variant="outline" size="icon" asChild>
                        <Link href={`/notices/${notice.id}`}>
                          <ArrowRight className="w-4 h-4" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed bg-muted/20">
              <CardContent className="p-8 text-center text-muted-foreground">
                <FileText className="w-8 h-8 mx-auto mb-3 opacity-20" />
                <p>No notices currently awaiting review.</p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <h2 className="text-xl font-serif font-semibold">Compliance Alerts</h2>
          {dashboard.complianceWarnings.length > 0 ? (
            <div className="space-y-4">
              {dashboard.complianceWarnings.map((warn, i) => (
                <Card key={i} className="border-destructive/30 bg-destructive/5">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium">{warn.tenantNames.join(", ")}</p>
                        <p className="text-sm text-muted-foreground mt-1">{warn.message}</p>
                      </div>
                    </div>
                    <Button variant="link" className="h-auto p-0 text-xs pl-6 text-primary" asChild>
                      <Link href={`/notices/${warn.noticeId}`}>View Notice</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="border-dashed bg-muted/20">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                <ShieldAlert className="w-8 h-8 mx-auto mb-3 opacity-20 text-primary" />
                <p>No active compliance warnings.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  )
}

function ShieldAlert(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  )
}
