import {
  useGetAdminCompany,
  getGetAdminCompanyQueryKey,
  getListAdminCompaniesQueryKey,
  getGetAdminMetricsQueryKey,
  useCreateAdminLicenseKey,
  useUpdateAdminLicenseKey,
  useResetAdminLicenseDevice,
  useUpdateAdminUser,
} from "@workspace/api-client-react";
import AdminLayout from "./AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import {
  ArrowLeft,
  CheckCircle2,
  AlertTriangle,
  Info,
  KeyRound,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";

const ROLES = ["admin", "manager", "staff", "readonly"] as const;

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function errText(e: unknown): string {
  return (e as { error?: string })?.error ?? "Something went wrong";
}

function keyStatusBadge(status: string) {
  if (status === "active") return <Badge>Active</Badge>;
  if (status === "revoked") return <Badge variant="destructive">Revoked</Badge>;
  return <Badge variant="secondary">{status}</Badge>;
}

function auditIcon(status: "pass" | "warn" | "info") {
  if (status === "pass")
    return <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />;
  if (status === "warn")
    return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />;
  return <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />;
}

export default function AdminCompanyDetail() {
  const params = useParams<{ companyId: string }>();
  const companyId = params.companyId ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useGetAdminCompany(companyId, {
    query: { queryKey: getGetAdminCompanyQueryKey(companyId) },
  });

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: getGetAdminCompanyQueryKey(companyId),
    });
    queryClient.invalidateQueries({ queryKey: getListAdminCompaniesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetAdminMetricsQueryKey() });
  };

  const createKey = useCreateAdminLicenseKey({
    mutation: {
      onSuccess: (created, vars) => {
        refresh();
        toast({
          title: vars.data.rotate ? "Key rotated" : "Key generated",
          description: `New license key: ${created.key}`,
        });
      },
      onError: (e) =>
        toast({ title: "Failed", description: errText(e), variant: "destructive" }),
    },
  });
  const updateKey = useUpdateAdminLicenseKey({
    mutation: {
      onSuccess: (updated) => {
        refresh();
        toast({
          title:
            updated.status === "revoked" ? "Key revoked" : "Key reactivated",
        });
      },
      onError: (e) =>
        toast({ title: "Failed", description: errText(e), variant: "destructive" }),
    },
  });
  const resetDevice = useResetAdminLicenseDevice({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({ title: "Device binding cleared" });
      },
      onError: (e) =>
        toast({ title: "Failed", description: errText(e), variant: "destructive" }),
    },
  });
  const updateUser = useUpdateAdminUser({
    mutation: {
      onSuccess: () => {
        refresh();
        toast({ title: "User updated" });
      },
      onError: (e) =>
        toast({ title: "Failed", description: errText(e), variant: "destructive" }),
    },
  });

  if (isLoading) {
    return (
      <AdminLayout>
        <Skeleton className="h-8 w-64 mb-6" />
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
        <Skeleton className="h-64" />
      </AdminLayout>
    );
  }

  if (!data) {
    return (
      <AdminLayout>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
        >
          <ArrowLeft className="w-4 h-4" /> Back to overview
        </Link>
        <p className="text-muted-foreground">Company not found.</p>
      </AdminLayout>
    );
  }

  const { company, subscription, license, licenses, users, audit } = data;

  return (
    <AdminLayout>
      <Link
        href="/admin"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
        data-testid="link-back-to-admin"
      >
        <ArrowLeft className="w-4 h-4" /> Back to overview
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-serif text-foreground mb-1" data-testid="text-company-name">
          {company.name}
        </h1>
        <p className="text-muted-foreground">
          {company.contactEmail} · customer since{" "}
          {new Date(company.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Plan
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{subscription.tierName}</div>
            <p className="text-xs text-muted-foreground mt-1">
              {subscription.seats ?? "Unlimited"} seats ·{" "}
              {money(subscription.priceMonthlyCents ?? 0)}/mo list price
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Subscription
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {subscription.status}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {subscription.cancelAtPeriodEnd
                ? "Cancels at period end"
                : subscription.currentPeriodEnd
                  ? `Renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                  : "No Stripe subscription on file"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              License standing
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize" data-testid="text-license-status">
              {license.status}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {license.statusReason}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <KeyRound className="w-4 h-4" /> License keys
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={createKey.isPending}
              onClick={() =>
                createKey.mutate({ companyId, data: { rotate: false } })
              }
              data-testid="button-generate-key"
            >
              <Plus className="w-4 h-4 mr-1" /> New key
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={createKey.isPending}
                  data-testid="button-rotate-key"
                >
                  <RefreshCw className="w-4 h-4 mr-1" /> Rotate
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Rotate license keys?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All existing keys for {company.name} will be revoked and a
                    single new key will be issued. Desktops using an old key
                    will lose access on their next license check until the new
                    key is entered.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() =>
                      createKey.mutate({ companyId, data: { rotate: true } })
                    }
                    data-testid="button-confirm-rotate"
                  >
                    Revoke all & issue new key
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Device</TableHead>
                <TableHead>Last verified</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {licenses.map((k) => (
                <TableRow key={k.id} data-testid={`row-key-${k.id}`}>
                  <TableCell className="font-mono text-xs">{k.key}</TableCell>
                  <TableCell>{keyStatusBadge(k.status)}</TableCell>
                  <TableCell className="text-sm">
                    {k.deviceName ?? k.deviceId ?? (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {k.lastVerifiedAt ? (
                      new Date(k.lastVerifiedAt).toLocaleString()
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-2">
                    {(k.deviceId || k.deviceName) && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={resetDevice.isPending}
                        onClick={() => resetDevice.mutate({ keyId: k.id })}
                        data-testid={`button-reset-device-${k.id}`}
                      >
                        Reset device
                      </Button>
                    )}
                    {k.status !== "revoked" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={updateKey.isPending}
                        onClick={() =>
                          updateKey.mutate({
                            keyId: k.id,
                            data: { status: "revoked" },
                          })
                        }
                        data-testid={`button-revoke-key-${k.id}`}
                      >
                        Revoke
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={updateKey.isPending}
                        onClick={() =>
                          updateKey.mutate({
                            keyId: k.id,
                            data: { status: "active" },
                          })
                        }
                        data-testid={`button-reactivate-key-${k.id}`}
                      >
                        Reactivate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">
            Team ({users.filter((u) => u.active).length} active of{" "}
            {subscription.seats ?? "Unlimited"} seats)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead className="text-right">Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
                  <TableCell>
                    <div className="font-medium flex items-center gap-1.5">
                      {u.name}
                      {u.isMasterAdmin && (
                        <span title="Master admin (billing owner)">
                          <ShieldCheck className="w-3.5 h-3.5 text-primary" />
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {u.email}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.status === "active" && <Badge>Active</Badge>}
                    {u.status === "invited" && (
                      <Badge variant="secondary">Invited</Badge>
                    )}
                    {u.status === "deactivated" && (
                      <Badge variant="outline">Deactivated</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <Select
                      value={u.role}
                      disabled={u.isMasterAdmin || updateUser.isPending}
                      onValueChange={(role) =>
                        updateUser.mutate({
                          userId: u.id,
                          data: { role: role as (typeof ROLES)[number] },
                        })
                      }
                    >
                      <SelectTrigger
                        className="w-32 h-8 capitalize"
                        data-testid={`select-role-${u.id}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={u.isMasterAdmin || updateUser.isPending}
                      className={u.active ? "text-destructive" : ""}
                      onClick={() =>
                        updateUser.mutate({
                          userId: u.id,
                          data: { active: !u.active },
                        })
                      }
                      data-testid={`button-toggle-active-${u.id}`}
                    >
                      {u.active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tier enforcement audit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {audit.map((check) => (
            <div
              key={check.id}
              className="flex items-start gap-3"
              data-testid={`audit-${check.id}`}
            >
              {auditIcon(check.status)}
              <div>
                <div className="text-sm font-medium">{check.label}</div>
                <div className="text-sm text-muted-foreground">
                  {check.detail}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
