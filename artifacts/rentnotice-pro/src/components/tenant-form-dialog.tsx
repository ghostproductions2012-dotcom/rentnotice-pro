// Create/edit dialog for tenants, used by the tenant list ("Add Tenant") and
// the tenant view ("Edit" in the ... menu). Talks to the data layer only via
// the useCreateTenant / useUpdateTenant hooks.

import { useEffect, useState } from "react";
import { useCreateTenant, useProperties, useUpdateTenant } from "@/lib/api/hooks";
import type { Tenant } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { Link } from "wouter";

interface TenantFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this tenant instead of creating one. */
  tenant?: Tenant | null;
  /** Preselect a property when creating (e.g. from a property page). */
  defaultPropertyId?: string | null;
}

export function TenantFormDialog({
  open,
  onOpenChange,
  tenant,
  defaultPropertyId,
}: TenantFormDialogProps) {
  const { toast } = useToast();
  const { data: properties } = useProperties();
  const createTenant = useCreateTenant();
  const updateTenant = useUpdateTenant();
  const editing = !!tenant;

  const [names, setNames] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [unit, setUnit] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [leaseStart, setLeaseStart] = useState("");
  const [notes, setNotes] = useState("");

  // Re-seed the form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setNames(tenant ? tenant.names.join(", ") : "");
    setPropertyId(tenant?.propertyId ?? defaultPropertyId ?? "");
    setUnit(tenant?.unit ?? "");
    setEmail(tenant?.email ?? "");
    setPhone(tenant?.phone ?? "");
    setMonthlyRent(
      tenant?.monthlyRentCents != null ? (tenant.monthlyRentCents / 100).toFixed(2) : "",
    );
    setLeaseStart(tenant?.leaseStart ?? "");
    setNotes(tenant?.notes ?? "");
  }, [open, tenant, defaultPropertyId]);

  const parsedNames = names
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter(Boolean);
  const rentCents = monthlyRent.trim() ? Math.round(Number(monthlyRent) * 100) : null;
  const rentValid = rentCents == null || (Number.isFinite(rentCents) && rentCents >= 0);
  const valid = parsedNames.length > 0 && !!propertyId && rentValid;
  const busy = createTenant.isPending || updateTenant.isPending;

  const selectedProperty = properties?.find((p) => p.id === propertyId);

  const onError = (e: unknown) =>
    toast({
      title: editing ? "Could not save tenant" : "Could not create tenant",
      description: e instanceof Error ? e.message : "Unknown error.",
      variant: "destructive",
    });

  const save = () => {
    if (!valid) return;
    if (editing && tenant) {
      updateTenant.mutate(
        {
          id: tenant.id,
          patch: {
            names: parsedNames,
            propertyId: propertyId || null,
            unit: unit.trim(),
            email: email.trim(),
            phone: phone.trim(),
            monthlyRentCents: rentCents,
            leaseStart: leaseStart || null,
            notes: notes.trim(),
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Tenant updated" });
            onOpenChange(false);
          },
          onError,
        },
      );
    } else {
      createTenant.mutate(
        {
          names: parsedNames,
          propertyId: propertyId || null,
          unit: unit.trim() || undefined,
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          monthlyRentCents: rentCents,
          leaseStart: leaseStart || null,
          notes: notes.trim() || undefined,
        },
        {
          onSuccess: (t) => {
            toast({
              title: "Tenant created",
              description: `${t.names.join(" & ")} was added.`,
            });
            onOpenChange(false);
          },
          onError,
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Tenant" : "Add Tenant"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Update this tenant's record. Changes apply to future notices only."
              : "Create a tenant record linked to a property."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tenant name(s) *</Label>
            <Input
              value={names}
              onChange={(e) => setNames(e.target.value)}
              placeholder="e.g. Maria Lopez, James Lopez"
              data-testid="input-tenant-names"
            />
            <p className="text-xs text-muted-foreground">
              List every adult on the lease, separated by commas.
            </p>
          </div>
          <div className="space-y-2">
            <Label>Property *</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger data-testid="select-tenant-property">
                <SelectValue placeholder="Select a property" />
              </SelectTrigger>
              <SelectContent>
                {(properties ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nickname} — {p.addressLine1}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {(properties?.length ?? 0) === 0 && (
              <p className="text-xs text-destructive">
                No properties exist yet.{" "}
                <Link href="/properties" className="underline">
                  Add a property first
                </Link>
                {" "}— notices require the property's address and payment details.
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Unit</Label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. 3B"
                list="tenant-unit-options"
                data-testid="input-tenant-unit"
              />
              {selectedProperty && selectedProperty.units.length > 0 && (
                <datalist id="tenant-unit-options">
                  {selectedProperty.units.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              )}
            </div>
            <div className="space-y-2">
              <Label>Monthly rent ($)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={monthlyRent}
                onChange={(e) => setMonthlyRent(e.target.value)}
                placeholder="e.g. 1850.00"
                data-testid="input-tenant-rent"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-tenant-email"
              />
            </div>
            <div className="space-y-2">
              <Label>Phone</Label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-testid="input-tenant-phone"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Lease start</Label>
            <Input
              type="date"
              value={leaseStart}
              onChange={(e) => setLeaseStart(e.target.value)}
              data-testid="input-tenant-lease-start"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes (never printed on notices)…"
              data-testid="input-tenant-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || busy} data-testid="button-save-tenant">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editing ? "Save Changes" : "Create Tenant"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
