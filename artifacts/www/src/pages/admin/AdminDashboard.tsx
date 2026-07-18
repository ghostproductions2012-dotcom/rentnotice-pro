import {
  useGetAdminMetrics,
  getGetAdminMetricsQueryKey,
  useListAdminCompanies,
  getListAdminCompaniesQueryKey,
  useListAdminPendingSignups,
  getListAdminPendingSignupsQueryKey,
  useGetAdminPricingHealth,
  getGetAdminPricingHealthQueryKey,
} from "@workspace/api-client-react";
import AdminLayout from "./AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Link } from "wouter";
import {
  Building2,
  CircleDollarSign,
  KeyRound,
  Users,
  Hourglass,
  ChevronRight,
  AlertTriangle,
} from "lucide-react";

function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function licenseStatusBadge(status: string) {
  if (status === "active") return <Badge>Active</Badge>;
  if (status === "paused") return <Badge variant="secondary">Paused</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}

export default function AdminDashboard() {
  const { data: metrics, isLoading: metricsLoading } = useGetAdminMetrics({
    query: { queryKey: getGetAdminMetricsQueryKey() },
  });
  const { data: companies, isLoading: companiesLoading } =
    useListAdminCompanies({
      query: { queryKey: getListAdminCompaniesQueryKey() },
    });
  const { data: pending } = useListAdminPendingSignups({
    query: { queryKey: getListAdminPendingSignupsQueryKey() },
  });
  const { data: pricingHealth } = useGetAdminPricingHealth({
    query: { queryKey: getGetAdminPricingHealthQueryKey() },
  });

  const statCards = metrics
    ? [
        {
          label: "Companies",
          value: String(metrics.totalCompanies),
          sub: `${metrics.activeSubscriptions} with active subscriptions`,
          icon: Building2,
        },
        {
          label: "Monthly revenue",
          value: money(metrics.mrrCents),
          sub: "MRR across active subscriptions",
          icon: CircleDollarSign,
        },
        {
          label: "Users",
          value: String(metrics.totalUsers),
          sub: `${metrics.activeUsers} active`,
          icon: Users,
        },
        {
          label: "License keys",
          value: String(metrics.totalLicenseKeys),
          sub: `${metrics.activatedLicenseKeys} activated on a device`,
          icon: KeyRound,
        },
      ]
    : [];

  return (
    <AdminLayout>
      <div className="mb-8">
        <h1 className="text-3xl font-serif text-foreground mb-1">
          Platform overview
        </h1>
        <p className="text-muted-foreground">
          Every company, subscription and license across RentNotice Pro.
        </p>
      </div>

      {pricingHealth && !pricingHealth.ok && (
        <Card
          className="mb-8 border-destructive"
          data-testid="card-pricing-health"
        >
          <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <CardTitle className="text-base text-destructive">
              Stripe pricing out of sync with the plan catalog
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="text-sm text-muted-foreground space-y-1">
              {pricingHealth.mismatches.map((m, i) => (
                <li key={`${m.tier}-${m.livePriceId ?? i}`}>
                  <span className="font-medium capitalize text-foreground">
                    {m.tier}
                  </span>
                  : catalog {money(m.catalogAmountCents)}/mo,{" "}
                  {m.reason === "no_live_price"
                    ? "no live Stripe price found"
                    : m.reason === "no_usable_live_price"
                      ? `only unusable live prices (e.g. ${m.liveAmountCents !== null ? money(m.liveAmountCents) : "no amount"}) — catalog price shown instead`
                      : m.reason === "stray_price_ignored"
                        ? `stray live price ${m.liveAmountCents !== null ? money(m.liveAmountCents) : "without an amount"} ignored (${m.livePriceId})`
                        : `live price is ${m.liveAmountCents !== null ? money(m.liveAmountCents) : "unknown"} (${m.livePriceId})`}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {metricsLoading &&
          [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        {statCards.map((s) => (
          <Card key={s.label} data-testid={`card-metric-${s.label}`}>
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {s.label}
              </CardTitle>
              <s.icon className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{s.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{s.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {metrics && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Companies by plan</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-6">
            {metrics.byTier.map((t) => (
              <div key={t.tier} data-testid={`tier-count-${t.tier}`}>
                <div className="text-2xl font-bold">{t.companies}</div>
                <div className="text-sm text-muted-foreground">
                  {t.tierName}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Companies</CardTitle>
        </CardHeader>
        <CardContent>
          {companiesLoading && <Skeleton className="h-32" />}
          {companies && companies.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">
              No companies yet.
            </p>
          )}
          {companies && companies.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Seats</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>MRR</TableHead>
                  <TableHead className="w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.map((c) => (
                  <TableRow
                    key={c.id}
                    className="group"
                    data-testid={`row-company-${c.id}`}
                  >
                    <TableCell>
                      <Link
                        href={`/admin/companies/${c.id}`}
                        className="font-medium text-foreground hover:text-primary"
                        data-testid={`link-company-${c.id}`}
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {c.contactEmail}
                      </div>
                    </TableCell>
                    <TableCell>{c.tierName}</TableCell>
                    <TableCell>
                      {c.seatsUsed} / {c.seats ?? "Unlimited"}
                    </TableCell>
                    <TableCell>{licenseStatusBadge(c.licenseStatus)}</TableCell>
                    <TableCell>
                      {c.licenseStatus === "active"
                        ? money(c.priceMonthlyCents ?? 0)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/admin/companies/${c.id}`}
                        aria-label={`Open ${c.name}`}
                      >
                        <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Hourglass className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-base">
            Pending signups{" "}
            <span className="text-muted-foreground font-normal">
              (started checkout, not completed)
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(!pending || pending.length === 0) && (
            <p className="text-sm text-muted-foreground py-2">
              No pending signups.
            </p>
          )}
          {pending && pending.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Started</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.map((p) => (
                  <TableRow key={p.id} data-testid={`row-pending-${p.id}`}>
                    <TableCell className="font-medium">
                      {p.companyName}
                    </TableCell>
                    <TableCell>
                      {p.adminName}
                      <div className="text-xs text-muted-foreground">
                        {p.email}
                      </div>
                    </TableCell>
                    <TableCell className="capitalize">{p.tier}</TableCell>
                    <TableCell>
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </AdminLayout>
  );
}
