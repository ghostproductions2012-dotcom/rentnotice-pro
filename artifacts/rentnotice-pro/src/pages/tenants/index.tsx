import { usePermissions, useTenants } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Users, Search, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "wouter";
import { useState } from "react";
import { formatCents } from "@/lib/types";
import { TenantFormDialog } from "@/components/tenant-form-dialog";

export default function TenantsList() {
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const { data: tenants, isLoading } = useTenants(search);
  const { can } = usePermissions();

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

      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search tenants..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3,4].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : tenants?.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-12 text-center">
            <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No tenants found</h3>
            <p className="text-muted-foreground mb-4">Get started by adding a tenant.</p>
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
            {tenants?.map(tenant => (
              <Link key={tenant.id} href={`/tenants/${tenant.id}`} className="block hover:bg-muted/30 transition-colors p-4 sm:p-6">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-6">
                    <div>
                      <h3 className="font-bold text-lg flex items-center gap-2">
                        {tenant.names.join(" & ")}
                        {tenant.archived && <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-muted text-muted-foreground">Archived</span>}
                      </h3>
                      <div className="flex items-center gap-1.5 text-sm text-muted-foreground mt-1">
                        <MapPin className="w-3.5 h-3.5" />
                        Unit {tenant.unit}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {tenant.monthlyRentCents && (
                      <div className="font-medium font-serif">{formatCents(tenant.monthlyRentCents)}/mo</div>
                    )}
                    <Button variant="ghost" size="sm" className="mt-1 -mr-3">View Record</Button>
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
