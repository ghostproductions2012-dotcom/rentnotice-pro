import { useTenant, useLedgers, useNotices } from "@/lib/api/hooks";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, FileText, ArrowLeft, MoreHorizontal, Database, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCents } from "@/lib/types";

export default function TenantView() {
  const { id } = useParams<{ id: string }>();
  const { data: tenant, isLoading } = useTenant(id);
  const { data: ledgers } = useLedgers(id);
  const { data: notices } = useNotices({ tenantId: id });

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted w-1/3 rounded" /><div className="h-64 bg-muted rounded" /></div>;
  if (!tenant) return <div>Tenant not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/tenants">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold tracking-tight">{tenant.names.join(" & ")}</h1>
            {tenant.archived && (
              <span className="px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground text-xs font-semibold uppercase tracking-wider">
                Archived
              </span>
            )}
          </div>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            Unit {tenant.unit}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/notices/new">Create Notice</Link>
        </Button>
        <Button variant="outline" size="icon">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Monthly Rent</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tenant.monthlyRentCents ? formatCents(tenant.monthlyRentCents) : "Unknown"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Lease Start</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tenant.leaseStart || "Unknown"}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ledgers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{ledgers?.length || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Notices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{notices?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ledgers" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0">
          <TabsTrigger value="ledgers" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Ledgers</TabsTrigger>
          <TabsTrigger value="notices" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Notices</TabsTrigger>
          <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Details</TabsTrigger>
        </TabsList>
        
        <TabsContent value="ledgers" className="pt-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Financial Ledgers</h2>
            <Button size="sm" asChild>
              <Link href="/import">Import Ledger</Link>
            </Button>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {ledgers?.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">No ledgers imported yet.</div>
                ) : (
                  ledgers?.map(ledger => (
                    <div key={ledger.id} className="p-4 flex items-center justify-between hover:bg-muted/30">
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          <Database className="w-4 h-4 text-primary" />
                          {ledger.name}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {ledger.periodStart} to {ledger.periodEnd} • {ledger.transactionCount} transactions
                        </div>
                      </div>
                      <Button variant="outline" size="sm">View Ledger</Button>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notices" className="pt-6">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {notices?.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">No notices generated yet.</div>
                ) : (
                  notices?.map(notice => (
                    <Link key={notice.id} href={`/notices/${notice.id}`} className="block p-4 hover:bg-muted/30 transition-colors">
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-medium flex items-center gap-2">
                            <FileText className="w-4 h-4 text-primary" />
                            {notice.noticeType.replace(/_/g, ' ').toUpperCase()}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            Demanding {formatCents(notice.totalAmountCents)} • Prepared {new Date(notice.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-medium capitalize">{notice.status.replace(/_/g, ' ')}</div>
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
