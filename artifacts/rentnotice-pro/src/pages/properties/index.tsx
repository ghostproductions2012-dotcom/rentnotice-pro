import { usePermissions, useProperties, useSettings, useWorkspaceState } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Building, MapPin, Search, Plus, Download } from "lucide-react";
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
import { PropertyFormDialog } from "@/components/property-form-dialog";
import { BuildiumImportDialog } from "@/components/buildium-import-dialog";

type PropertySort = "name" | "address" | "units" | "recent";

export default function PropertiesList() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PropertySort>("name");
  const [stateFilter, setStateFilter] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { data: allProperties, isLoading } = useProperties(search);
  const { data: settings } = useSettings();
  const { data: workspace } = useWorkspaceState();
  const { can } = usePermissions();

  const states = useMemo(() => {
    const set = new Set((allProperties ?? []).map((p) => p.state).filter(Boolean));
    return [...set].sort();
  }, [allProperties]);

  const properties = useMemo(() => {
    let list = allProperties ?? [];
    if (stateFilter) list = list.filter((p) => p.state === stateFilter);
    const sorted = [...list];
    switch (sort) {
      case "name":
        sorted.sort((a, b) => a.nickname.localeCompare(b.nickname));
        break;
      case "address":
        sorted.sort((a, b) =>
          `${a.addressLine1} ${a.city}`.localeCompare(`${b.addressLine1} ${b.city}`),
        );
        break;
      case "units":
        sorted.sort((a, b) => b.units.length - a.units.length);
        break;
      case "recent":
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
    }
    return sorted;
  }, [allProperties, stateFilter, sort]);

  const buildiumReady =
    workspace?.mode === "activated" &&
    Boolean(settings?.buildiumClientId && settings?.buildiumClientSecret);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Properties</h1>
          <p className="text-muted-foreground mt-1">Manage real estate assets and payment profiles.</p>
        </div>
        <div className="flex items-center gap-3">
          {buildiumReady && (
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              disabled={!can("property.manage")}
              data-testid="button-buildium-import"
            >
              <Download className="w-4 h-4 mr-2" />
              Import from Buildium
            </Button>
          )}
          <Button
            onClick={() => setAddOpen(true)}
            disabled={!can("property.manage")}
            data-testid="button-add-property"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Property
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search by name, address, city, or owner..." 
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-property-search"
          />
        </div>
        <Select
          value={stateFilter || "__all"}
          onValueChange={(v) => setStateFilter(v === "__all" ? "" : v)}
        >
          <SelectTrigger className="w-36" data-testid="select-property-state">
            <SelectValue placeholder="All states" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">All states</SelectItem>
            {states.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={(v) => setSort(v as PropertySort)}>
          <SelectTrigger className="w-44" data-testid="select-property-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Sort: Name</SelectItem>
            <SelectItem value="address">Sort: Address</SelectItem>
            <SelectItem value="units">Sort: Unit count</SelectItem>
            <SelectItem value="recent">Sort: Recently added</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : properties?.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-12 text-center">
            <Building className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No properties found</h3>
            <p className="text-muted-foreground mb-4">Get started by adding a new property.</p>
            <Button
              variant="outline"
              onClick={() => setAddOpen(true)}
              disabled={!can("property.manage")}
              data-testid="button-add-property-empty"
            >
              Add Property
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {properties?.map(property => (
            <Link key={property.id} href={`/properties/${property.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="font-bold font-serif text-lg leading-tight">{property.nickname}</h3>
                      <div className="flex items-start gap-1.5 text-sm text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span className="line-clamp-2">
                          {property.addressLine1}
                          {property.addressLine2 ? `, ${property.addressLine2}` : ""}
                          <br />
                          {property.city}, {property.state} {property.zip}
                        </span>
                      </div>
                    </div>
                  </div>
                  
                  <div className="pt-4 border-t grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider font-semibold">Units</div>
                      <div className="font-medium">{property.units.length}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-1 text-xs uppercase tracking-wider font-semibold">Jurisdiction</div>
                      <div className="font-medium">{property.state} {property.isLosAngelesCity ? "(LA City)" : ""}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <PropertyFormDialog open={addOpen} onOpenChange={setAddOpen} />
      <BuildiumImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </div>
  );
}
