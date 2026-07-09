// Create/edit dialog for properties, used by the property list ("Add
// Property") and the property view ("Edit"). Captures address, ownership,
// and the authorized payment profile that appears on notices.

import { useEffect, useState } from "react";
import { useCreateProperty, useUpdateProperty } from "@/lib/api/hooks";
import {
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type Property,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface PropertyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided the dialog edits this property instead of creating one. */
  property?: Property | null;
}

const ALL_METHODS = Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[];

export function PropertyFormDialog({ open, onOpenChange, property }: PropertyFormDialogProps) {
  const { toast } = useToast();
  const createProperty = useCreateProperty();
  const updateProperty = useUpdateProperty();
  const editing = !!property;

  const [nickname, setNickname] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressLine2, setAddressLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("CA");
  const [zip, setZip] = useState("");
  const [county, setCounty] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [units, setUnits] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [managementCompany, setManagementCompany] = useState("");
  const [managerContact, setManagerContact] = useState("");
  const [isLosAngelesCity, setIsLosAngelesCity] = useState(false);
  const [notes, setNotes] = useState("");
  // Payment profile
  const [payToName, setPayToName] = useState("");
  const [payToPerson, setPayToPerson] = useState("");
  const [paymentAddress, setPaymentAddress] = useState("");
  const [paymentPhone, setPaymentPhone] = useState("");
  const [acceptedMethods, setAcceptedMethods] = useState<PaymentMethod[]>([]);
  const [inPersonAllowed, setInPersonAllowed] = useState(false);
  const [officeHours, setOfficeHours] = useState("");
  const [paymentDays, setPaymentDays] = useState("");
  const [electronicInstructions, setElectronicInstructions] = useState("");

  useEffect(() => {
    if (!open) return;
    setNickname(property?.nickname ?? "");
    setAddressLine1(property?.addressLine1 ?? "");
    setAddressLine2(property?.addressLine2 ?? "");
    setCity(property?.city ?? "");
    setState(property?.state ?? "CA");
    setZip(property?.zip ?? "");
    setCounty(property?.county ?? "");
    setBedrooms(property?.bedrooms != null ? String(property.bedrooms) : "");
    setUnits(property ? property.units.join(", ") : "");
    setOwnerName(property?.ownerName ?? "");
    setManagementCompany(property?.managementCompany ?? "");
    setManagerContact(property?.managerContact ?? "");
    setIsLosAngelesCity(property?.isLosAngelesCity ?? false);
    setNotes(property?.notes ?? "");
    setPayToName(property?.payment.payToName ?? "");
    setPayToPerson(property?.payment.payToPerson ?? "");
    setPaymentAddress(property?.payment.paymentAddress ?? "");
    setPaymentPhone(property?.payment.phone ?? "");
    setAcceptedMethods(property ? [...property.payment.acceptedMethods] : []);
    setInPersonAllowed(property?.payment.inPersonAllowed ?? false);
    setOfficeHours(property?.payment.officeHours ?? "");
    setPaymentDays(property?.payment.paymentDays ?? "");
    setElectronicInstructions(property?.payment.electronicInstructions ?? "");
  }, [open, property]);

  const parsedUnits = units
    .split(/[,\n]/)
    .map((u) => u.trim())
    .filter(Boolean);

  const bedroomsNum = bedrooms.trim() === "" ? null : Number(bedrooms);
  const bedroomsValid =
    bedroomsNum == null || (Number.isInteger(bedroomsNum) && bedroomsNum >= 0);

  const valid =
    nickname.trim().length > 0 &&
    addressLine1.trim().length > 0 &&
    city.trim().length > 0 &&
    state.trim().length === 2 &&
    zip.trim().length > 0 &&
    ownerName.trim().length > 0 &&
    bedroomsValid;
  const busy = createProperty.isPending || updateProperty.isPending;

  const toggleMethod = (m: PaymentMethod, checked: boolean) =>
    setAcceptedMethods((prev) => (checked ? [...prev, m] : prev.filter((x) => x !== m)));

  const paymentPatch = {
    payToName: payToName.trim(),
    payToPerson: payToPerson.trim(),
    paymentAddress: paymentAddress.trim(),
    phone: paymentPhone.trim(),
    acceptedMethods,
    inPersonAllowed,
    officeHours: officeHours.trim(),
    paymentDays: paymentDays.trim(),
    electronicInstructions: electronicInstructions.trim(),
  };

  const onError = (e: unknown) =>
    toast({
      title: editing ? "Could not save property" : "Could not create property",
      description: e instanceof Error ? e.message : "Unknown error.",
      variant: "destructive",
    });

  const save = () => {
    if (!valid) return;
    if (editing && property) {
      updateProperty.mutate(
        {
          id: property.id,
          patch: {
            nickname: nickname.trim(),
            addressLine1: addressLine1.trim(),
            addressLine2: addressLine2.trim(),
            city: city.trim(),
            state: state.trim().toUpperCase(),
            zip: zip.trim(),
            county: county.trim(),
            bedrooms: bedroomsNum,
            units: parsedUnits,
            ownerName: ownerName.trim(),
            managementCompany: managementCompany.trim(),
            managerContact: managerContact.trim(),
            payment: { ...property.payment, ...paymentPatch },
            isLosAngelesCity,
            notes: notes.trim(),
          },
        },
        {
          onSuccess: () => {
            toast({ title: "Property updated" });
            onOpenChange(false);
          },
          onError,
        },
      );
    } else {
      createProperty.mutate(
        {
          nickname: nickname.trim(),
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || undefined,
          city: city.trim(),
          state: state.trim().toUpperCase(),
          zip: zip.trim(),
          county: county.trim() || undefined,
          bedrooms: bedroomsNum,
          units: parsedUnits,
          ownerName: ownerName.trim(),
          managementCompany: managementCompany.trim() || undefined,
          managerContact: managerContact.trim() || undefined,
          payment: paymentPatch,
          isLosAngelesCity,
          notes: notes.trim() || undefined,
        },
        {
          onSuccess: (p) => {
            toast({ title: "Property created", description: `${p.nickname} was added.` });
            onOpenChange(false);
          },
          onError,
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Property" : "Add Property"}</DialogTitle>
          <DialogDescription>
            Address, ownership, and the authorized payment profile printed on notices.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Nickname *</Label>
            <Input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="e.g. Maple Street Fourplex"
              data-testid="input-property-nickname"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Address line 1 *</Label>
              <Input
                value={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
                data-testid="input-property-address1"
              />
            </div>
            <div className="space-y-2">
              <Label>Address line 2</Label>
              <Input
                value={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
                data-testid="input-property-address2"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label>City *</Label>
              <Input value={city} onChange={(e) => setCity(e.target.value)} data-testid="input-property-city" />
            </div>
            <div className="space-y-2">
              <Label>State *</Label>
              <Input
                value={state}
                onChange={(e) => setState(e.target.value)}
                maxLength={2}
                placeholder="CA"
                data-testid="input-property-state"
              />
            </div>
            <div className="space-y-2">
              <Label>ZIP *</Label>
              <Input value={zip} onChange={(e) => setZip(e.target.value)} data-testid="input-property-zip" />
            </div>
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label>County</Label>
              <Input value={county} onChange={(e) => setCounty(e.target.value)} data-testid="input-property-county" />
            </div>
            <div className="space-y-2 col-span-2 sm:col-span-1">
              <Label>Bedrooms</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={bedrooms}
                onChange={(e) => setBedrooms(e.target.value)}
                placeholder="e.g. 2"
                data-testid="input-property-bedrooms"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Units</Label>
            <Input
              value={units}
              onChange={(e) => setUnits(e.target.value)}
              placeholder="e.g. 1, 2, 3B, 4"
              data-testid="input-property-units"
            />
            <p className="text-xs text-muted-foreground">Unit labels, separated by commas.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Owner name *</Label>
              <Input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                data-testid="input-property-owner"
              />
            </div>
            <div className="space-y-2">
              <Label>Management company</Label>
              <Input
                value={managementCompany}
                onChange={(e) => setManagementCompany(e.target.value)}
                data-testid="input-property-mgmt"
              />
            </div>
            <div className="space-y-2">
              <Label>Manager contact</Label>
              <Input
                value={managerContact}
                onChange={(e) => setManagerContact(e.target.value)}
                data-testid="input-property-manager"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="la-city"
              checked={isLosAngelesCity}
              onCheckedChange={(c) => setIsLosAngelesCity(c === true)}
              data-testid="checkbox-property-la"
            />
            <Label htmlFor="la-city" className="font-normal">
              Located in the City of Los Angeles (enables the LAHD letter requirement)
            </Label>
          </div>

          <div className="rounded-lg border p-4 space-y-4">
            <div>
              <h3 className="font-medium">Authorized Payment Profile</h3>
              <p className="text-xs text-muted-foreground">
                Printed on notices that demand payment. Leave blank to inherit company defaults.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Pay to</Label>
                <Input
                  value={payToName}
                  onChange={(e) => setPayToName(e.target.value)}
                  data-testid="input-payment-payto"
                />
              </div>
              <div className="space-y-2">
                <Label>Person to whom rent is paid</Label>
                <Input
                  value={payToPerson}
                  onChange={(e) => setPayToPerson(e.target.value)}
                  placeholder="Individual's name (CCP §1161(2))"
                  data-testid="input-payment-payto-person"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment address</Label>
                <Input
                  value={paymentAddress}
                  onChange={(e) => setPaymentAddress(e.target.value)}
                  data-testid="input-payment-address"
                />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input
                  value={paymentPhone}
                  onChange={(e) => setPaymentPhone(e.target.value)}
                  data-testid="input-payment-phone"
                />
              </div>
              <div className="space-y-2">
                <Label>Office hours</Label>
                <Input
                  value={officeHours}
                  onChange={(e) => setOfficeHours(e.target.value)}
                  placeholder="e.g. Mon–Fri 9:00 AM – 5:00 PM"
                  data-testid="input-payment-hours"
                />
              </div>
              <div className="space-y-2">
                <Label>Payment days</Label>
                <Input
                  value={paymentDays}
                  onChange={(e) => setPaymentDays(e.target.value)}
                  placeholder="e.g. Monday through Friday"
                  data-testid="input-payment-days"
                />
              </div>
              <div className="space-y-2">
                <Label>Electronic payment instructions</Label>
                <Input
                  value={electronicInstructions}
                  onChange={(e) => setElectronicInstructions(e.target.value)}
                  data-testid="input-payment-electronic"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Accepted methods</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ALL_METHODS.map((m) => (
                  <div key={m} className="flex items-center gap-2">
                    <Checkbox
                      id={`method-${m}`}
                      checked={acceptedMethods.includes(m)}
                      onCheckedChange={(c) => toggleMethod(m, c === true)}
                      data-testid={`checkbox-method-${m}`}
                    />
                    <Label htmlFor={`method-${m}`} className="font-normal text-sm">
                      {PAYMENT_METHOD_LABELS[m]}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="in-person"
                checked={inPersonAllowed}
                onCheckedChange={(c) => setInPersonAllowed(c === true)}
                data-testid="checkbox-payment-inperson"
              />
              <Label htmlFor="in-person" className="font-normal">
                In-person payment allowed at the payment address
              </Label>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes (never printed on notices)…"
              data-testid="input-property-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid || busy} data-testid="button-save-property">
            {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editing ? "Save Changes" : "Create Property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
