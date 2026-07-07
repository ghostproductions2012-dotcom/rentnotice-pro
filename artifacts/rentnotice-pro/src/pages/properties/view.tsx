import { useProperty, useTenants } from "@/lib/api/hooks";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building, MapPin, Users, FileText, ArrowLeft, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function PropertyView() {
  const { id } = useParams<{ id: string }>();
  const { data: property, isLoading } = useProperty(id);
  const { data: tenants } = useTenants("", id);

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted w-1/3 rounded" /><div className="h-64 bg-muted rounded" /></div>;
  if (!property) return <div>Property not found</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/properties">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold tracking-tight">{property.nickname}</h1>
            {property.isLosAngelesCity && (
              <span className="px-2.5 py-0.5 rounded-full bg-accent/20 text-accent-foreground text-xs font-semibold uppercase tracking-wider">
                LARSO
              </span>
            )}
          </div>
          <p className="text-muted-foreground flex items-center gap-2 mt-1">
            <MapPin className="w-4 h-4" />
            {property.addressLine1}, {property.city}, {property.state} {property.zip}
          </p>
        </div>
        <Button variant="outline">Edit</Button>
        <Button variant="outline" size="icon">
          <MoreHorizontal className="w-4 h-4" />
        </Button>
      </div>

      <Tabs defaultValue="details" className="w-full">
        <TabsList className="w-full justify-start border-b rounded-none h-12 bg-transparent p-0">
          <TabsTrigger value="details" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Details</TabsTrigger>
          <TabsTrigger value="tenants" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Tenants</TabsTrigger>
          <TabsTrigger value="payment" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:shadow-none px-6">Payment Profile</TabsTrigger>
        </TabsList>
        
        <TabsContent value="details" className="pt-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Management & Ownership</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Owner Name</div>
                  <div>{property.ownerName}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Management Company</div>
                  <div>{property.managementCompany || "N/A"}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Manager Contact</div>
                  <div>{property.managerContact || "N/A"}</div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Units ({property.units.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {property.units.map(unit => (
                    <div key={unit} className="px-3 py-1 bg-muted rounded-md text-sm font-medium">
                      {unit}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="tenants" className="pt-6">
          <Card>
            <CardContent className="p-0">
              <div className="divide-y">
                {tenants?.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">No tenants recorded for this property.</div>
                ) : (
                  tenants?.map(tenant => (
                    <Link key={tenant.id} href={`/tenants/${tenant.id}`} className="block hover:bg-muted/50 transition-colors p-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="font-medium flex items-center gap-2">
                            {tenant.names.join(" & ")}
                            {tenant.archived && <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-muted text-muted-foreground">Archived</span>}
                          </div>
                          <div className="text-sm text-muted-foreground">Unit {tenant.unit}</div>
                        </div>
                        <Button variant="ghost" size="sm">View</Button>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="payment" className="pt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Authorized Payment Profile</CardTitle>
              <p className="text-sm text-muted-foreground">This information appears on notices requiring payment.</p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Pay To</div>
                  <div className="font-medium">{property.payment.payToName}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Payment Address</div>
                  <div>{property.payment.paymentAddress}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Phone</div>
                  <div>{property.payment.phone}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Accepted Methods</div>
                  <div className="capitalize">{property.payment.acceptedMethods.join(", ").replace(/_/g, ' ')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
