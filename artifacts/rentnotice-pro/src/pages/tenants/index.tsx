import { usePermissions, useProperties, useTenants } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Search, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { formatCents } from "@/lib/types";
import { TenantFormDialog } from "@/components/tenant-form-dialog";

type TenantSort = "name" | "property" | "rent";
type TenantStatus = "active" | "archived" | "all";

export default function TenantsList() {
  const [search, setSearch] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [unit, setUnit] = useState("");
  const [status, setStatus] = useState<TenantStatus>("all");
  const [sort, setSort] = useState<TenantSort>("name");
  const [addOpen, setAddOpen] = useState(false);
  const { data: allTenants, isLoading } = useTenants(search, propertyId || undefined);
  const { data: properties } = useProperties();
  const { can } = usePermissions();

  const selectedProperty = properties?.find((p) => p.id === propertyId) ?? null;
  const propertyName = useMemo(() => {
    const map = new Map((properties ?? []).map((p) => [p.id, p.nickname]));
    return (id: string | null) => (id ? (map.get(id) ?? "") : "");
  }, [properties]);

  const tenants = useMemo(() => {
    let list = allTenants ?? [];
    if (unit) list = list.filter((t) => t.unit === unit);
    if (status === "active") list = list.filter((t) => !t.archived);
    if (status === "archived") list = list.filter((t) => t.archived);
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => (a.names[0] ?? "").localeCompare(b.names[0] ?? ""));
        break;
      case "property":
        sorted.sort(
          (a, b) =>
            propertyName(a.propertyId).localeCompare(propertyName(b.propertyId)) ||
            a.unit.localeCompare(b.unit, undefined, { numeric: true }),
        );
        break;
      case "rent":
        sorted.sort((a, b) => (b.monthlyRentCents ?? -1) - (a.monthlyRentCents ?? -1));
        break;
    }
    return sorted;
  }, [allTenants, unit, status, sort, propertyName]);

  const hasFilters = Boolean(search || propertyId || unit || status !== "all");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground mt-1">Manage tenant records and associated ledgers.</p>
        </div>
        <Button
          onClick={() => setAddOpen(true)}
          disabled={!can("tenant.manage")}
          data-testid="button-add-tenant"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Tenant
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name or unit..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-tenant-search"
          />
        </div>
        <Select
          value={propertyId || "__all"}
          onValueChange={(v) => {
            setPropertyId(v === "__all" ? "" : v);
            setUnit("");
          }}
        >
          <SelectTrigger className="w-48" data-testid="select-tenant-filter-property">
            <SelectValue placeholder="All properties" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All properties</SelectItem>
            {properties?.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nickname}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={unit || "__all"}
          onValueChange={(v) => setUnit(v === "__all" ? "" : v)}
          disabled={!selectedProperty || selectedProperty.units.length === 0}
        >
          <SelectTrigger className="w-36" data-testid="select-tenant-filter-unit">
            <SelectValue placeholder={selectedProperty ? "All units" : "Select property first"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All units</SelectItem>
            {selectedProperty?.units.map((u) => (
              <SelectItem key={u} value={u}>
                Unit {u}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setStatus(v as TenantStatus)}>
          <SelectTrigger className="w-36" data-testid="select-tenant-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as TenantSort)}>
          <SelectTrigger className="w-44" data-testid="select-tenant-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="property">Sort: Property & unit</SelectItem>
            <SelectItem value="rent">Sort: Monthly rent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : tenants.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No tenants found</h3>
            <p className="text-muted-foreground mb-4">
              {hasFilters ? "No tenants match the current filters." : "Get started by adding a tenant."}
            </p>
            <Button
              variant="outline"
              onClick={() => setAddOpen(true)}
              disabled={!can("tenant.manage")}
              data-testid="button-add-tenant-empty"
            >
              Add Tenant
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="border rounded-xl bg-card overflow-hidden">
          <div className="divide-y">
            {tenants.map(tenant => (
              <Link key={tenant.id} href={`/tenants/${tenant.id}`} className="group block cursor-pointer hover:bg-muted/30 transition-colors p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <div>
                      <h3 className="font-bold text-lg flex items-center gap-2">
                        {tenant.names.join(" & ")}
                        {tenant.archived && <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-muted text-muted-foreground">Archived</span>}
                      </h3>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {propertyName(tenant.propertyId)
                          ? `${propertyName(tenant.propertyId)} • Unit ${tenant.unit}`
                          : `Unit ${tenant.unit}`}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {tenant.monthlyRentCents && (
                      <div className="font-medium font-serif">{formatCents(tenant.monthlyRentCents)}/mo</div>
                    )}
                    <Button variant="ghost" size="sm" className="mt-1 -mr-3 cursor-pointer group-hover:underline group-hover:text-primary group-hover:bg-muted/60 transition-colors">View Record</Button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <TenantFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
