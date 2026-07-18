import {
  useDeleteTenant,
  useLedgers,
  useNotices,
  usePermissions,
  useTenant,
  useUpdateTenant,
} from "@/lib/api/hooks";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  FileText,
  ArrowLeft,
  MoreHorizontal,
  Database,
  Pencil,
  PencilLine,
  Archive,
  ArchiveRestore,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link, useLocation } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TenantFormDialog } from "@/components/tenant-form-dialog";
import { WorkOrderMiniList } from "@/components/work-order-mini-list";
import { LedgerViewDialog } from "@/components/ledger-view-dialog";
import { ManualStatementDialog } from "@/components/manual-statement-dialog";
import { useToast } from "@/hooks/use-toast";
import { formatCents, type Id } from "@/lib/types";
import { useState } from "react";
import {
  useListTenantCommunications,
  getListTenantCommunicationsQueryKey,
} from "@workspace/api-client-react";
import { registerCommsLicenseKey, useCommsIdentity } from "@/lib/comms/identity";

registerCommsLicenseKey();

export default function TenantView() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { data: tenant, isLoading } = useTenant(id);
  const { data: ledgers } = useLedgers(id);
  const { data: notices } = useNotices({ tenantId: id });
  const updateTenant = useUpdateTenant();
  const deleteTenant = useDeleteTenant();
  const { can } = usePermissions();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [viewLedgerId, setViewLedgerId] = useState<Id | null>(null);

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted w-1/3 rounded" /><div className="h-64 bg-muted rounded" /></div>;
  if (!tenant) return <div>Tenant not found</div>;

  const canManage = can("tenant.manage");

  const toggleArchive = () =>
    updateTenant.mutate(
      { id: tenant.id, patch: { archived: !tenant.archived } },
      {
        onSuccess: () =>
          toast({ title: tenant.archived ? "Tenant unarchived" : "Tenant archived" }),
        onError: (e) =>
          toast({
            title: "Could not update tenant",
            description: e instanceof Error ? e.message : "Unknown error.",
            variant: "destructive",
          }),
      },
    );

  const doDelete = () =>
    deleteTenant.mutate(tenant.id, {
      onSuccess: () => {
        toast({ title: "Tenant deleted", description: `${tenant.names.join(" & ")} was removed.` });
        navigate("/tenants");
      },
      onError: (e) =>
        toast({
          title: "Could not delete tenant",
          description: e instanceof Error ? e.message : "Unknown error.",
          variant: "destructive",
        }),
    });

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" data-testid="button-tenant-menu">
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => setEditOpen(true)}
              disabled={!canManage}
              data-testid="menu-edit-tenant"
            >
              <Pencil className="w-4 h-4 mr-2" />
              Edit tenant
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={toggleArchive}
              disabled={!canManage || updateTenant.isPending}
              data-testid="menu-archive-tenant"
            >
              {tenant.archived ? (
                <>
                  <ArchiveRestore className="w-4 h-4 mr-2" />
                  Unarchive tenant
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4 mr-2" />
                  Archive tenant
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setDeleteOpen(true)}
              disabled={!canManage}
              data-testid="menu-delete-tenant"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete tenant
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
          <TabsTrigger value="maintenance" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Maintenance</TabsTrigger>
          <TabsTrigger value="communications" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Communications</TabsTrigger>
        </TabsList>
        
        <TabsContent value="ledgers" className="pt-6">
          <div className="flex justify-between items-center mb-4 gap-2 flex-wrap">
            <h2 className="text-lg font-semibold">Financial Ledgers</h2>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setManualOpen(true)}
                disabled={!can("ledger.manage")}
                data-testid="button-enter-statement"
              >
                <PencilLine className="w-4 h-4 mr-2" />
                Enter Statement Manually
              </Button>
              <Button size="sm" asChild>
                <Link href="/import">Import Ledger</Link>
              </Button>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {ledgers?.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No ledgers yet. Import a file export, or enter a statement manually — no file
                    needed.
                  </div>
                ) : (
                  ledgers?.map(ledger => (
                    <div key={ledger.id} className="p-4 flex items-center justify-between hover:bg-muted/30">
                      <div>
                        <div className="font-medium flex items-center gap-2 flex-wrap">
                          {ledger.sourceType === "manual" ? (
                            <PencilLine className="w-4 h-4 text-primary" />
                          ) : (
                            <Database className="w-4 h-4 text-primary" />
                          )}
                          {ledger.name}
                          {ledger.sourceType === "manual" && (
                            <Badge variant="secondary" data-testid={`badge-manual-${ledger.id}`}>
                              Manual entry
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {ledger.periodStart} to {ledger.periodEnd} • {ledger.transactionCount} transactions
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setViewLedgerId(ledger.id)}
                        data-testid={`button-view-ledger-${ledger.id}`}
                      >
                        View Ledger
                      </Button>
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

        <TabsContent value="details" className="pt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Tenant Details</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-sm font-medium text-muted-foreground">Email</div>
                <div>{tenant.email || "—"}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Phone</div>
                <div>{tenant.phone || "—"}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Move-out Date</div>
                <div>{tenant.moveOutDate || "—"}</div>
              </div>
              <div>
                <div className="text-sm font-medium text-muted-foreground">Notes</div>
                <div className="whitespace-pre-wrap">{tenant.notes || "—"}</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="maintenance" className="pt-6">
          <WorkOrderMiniList filters={{ tenantId: tenant.id }} />
        </TabsContent>

        <TabsContent value="communications" className="pt-6">
          <TenantCommunicationsTab tenantId={tenant.id} />
        </TabsContent>
      </Tabs>

      <TenantFormDialog open={editOpen} onOpenChange={setEditOpen} tenant={tenant} />
      <ManualStatementDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        tenantId={tenant.id}
      />
      <LedgerViewDialog
        ledgerId={viewLedgerId}
        onOpenChange={(open) => !open && setViewLedgerId(null)}
      />
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              “{tenant.names.join(" & ")}” and their record will be permanently removed. Ledgers
              and notices that reference this tenant may become orphaned. If you only need to
              hide them, archive instead. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={doDelete}
              data-testid="button-confirm-delete-tenant"
            >
              Delete Tenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const COMM_KIND_LABELS: Record<string, string> = {
  email: "Email",
  announcement: "Announcement",
  notice_served: "Notice served",
  work_order: "Work order",
};

/**
 * Server-side communication log for this tenant (emails, announcements,
 * served-notice and work-order entries). Cloud-backed, so it needs an
 * activated workspace.
 */
function TenantCommunicationsTab({ tenantId }: { tenantId: Id }) {
  const identity = useCommsIdentity();
  const historyQuery = useListTenantCommunications(
    { tenantId, limit: 100 },
    {
      query: {
        queryKey: getListTenantCommunicationsQueryKey({ tenantId, limit: 100 }),
        enabled: identity.ready,
      },
    },
  );

  if (!identity.ready) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground" data-testid="text-comms-tab-requires-activation">
          Communication history syncs through your company's cloud workspace and is
          available once this workspace is activated with a license key.
        </CardContent>
      </Card>
    );
  }

  const history = historyQuery.data ?? [];
  return (
    <Card>
      <CardContent className="p-0">
        <div className="divide-y" data-testid="list-tenant-comm-history">
          {historyQuery.isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : history.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No communications logged for this tenant yet. Send one from the
              Communications page.
            </div>
          ) : (
            history.map((c) => (
              <div key={c.id} className="p-4 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-normal">
                    {COMM_KIND_LABELS[c.kind] ?? c.kind}
                  </Badge>
                  {c.subject && <span className="font-medium text-sm truncate">{c.subject}</span>}
                  <Badge
                    variant={
                      c.status === "failed"
                        ? "destructive"
                        : c.status === "logged"
                          ? "secondary"
                          : "default"
                    }
                    className="ml-auto"
                  >
                    {c.status}
                  </Badge>
                </div>
                {c.bodyText && (
                  <p className="text-sm text-muted-foreground line-clamp-2 whitespace-pre-wrap">
                    {c.bodyText}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {new Date(c.createdAt).toLocaleString()}
                  {c.createdByName ? ` · by ${c.createdByName}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
