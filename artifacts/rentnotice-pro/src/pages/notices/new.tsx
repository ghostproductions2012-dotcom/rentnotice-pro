import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useCalculation,
  useCheckDuplicateNotice,
  useCreateNotice,
  useDeadline,
  useLedgers,
  useProperty,
  usePermissions,
  useTemplates,
  useTenants,
} from "@/lib/api/hooks";
import { isLargeRentIncrease } from "@/lib/engine/noticeRules";
import {
  NOTICE_TYPE_LABELS,
  formatCents,
  type MonthCalculation,
  type NoticeInput,
  type NoticeMonth,
  type NoticeType,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  FileText,
  Loader2,
  Scale,
} from "lucide-react";

const MONETARY_TYPES: NoticeType[] = ["pay_or_quit_3day"];

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function toNoticeMonth(mc: MonthCalculation): NoticeMonth {
  return {
    month: mc.month,
    periodStart: mc.periodStart,
    periodEnd: mc.periodEnd,
    rentChargedCents: mc.rentChargedCents,
    paymentsAppliedCents: mc.paymentsAppliedCents,
    creditsAppliedCents: mc.creditsAppliedCents,
    rentOnlyBalanceCents: mc.rentOnlyBalanceCents,
    selectedAmountCents: mc.rentOnlyBalanceCents,
    overrideReason: null,
  };
}

export default function NoticeNew() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [params] = useState(() => new URLSearchParams(window.location.search));

  const [step, setStep] = useState(1);
  const [tenantId, setTenantId] = useState(params.get("tenantId") ?? "");
  const [ledgerId, setLedgerId] = useState(params.get("ledgerId") ?? "");
  const [noticeType, setNoticeType] = useState<NoticeType>("pay_or_quit_3day");
  const [selectedMonths, setSelectedMonths] = useState<Record<string, boolean>>({});
  const [templateId, setTemplateId] = useState<string>("");
  const [includeLahd, setIncludeLahd] = useState(false);
  const [covenantDescription, setCovenantDescription] = useState("");
  const [entryDate, setEntryDate] = useState("");
  const [entryTimeWindow, setEntryTimeWindow] = useState("");
  const [entryReason, setEntryReason] = useState("");
  const [terminationDate, setTerminationDate] = useState("");
  const [rentIncreaseAmount, setRentIncreaseAmount] = useState("");
  const [rentIncreaseDate, setRentIncreaseDate] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [duplicateDialog, setDuplicateDialog] = useState(false);
  const [duplicateReason, setDuplicateReason] = useState("");

  const { data: tenants } = useTenants();
  const tenant = useMemo(() => tenants?.find((t) => t.id === tenantId) ?? null, [tenants, tenantId]);
  const { data: property } = useProperty(tenant?.propertyId);
  const { data: ledgers } = useLedgers(tenantId || undefined);
  const monetary = MONETARY_TYPES.includes(noticeType);
  const { data: calc, isLoading: calcLoading } = useCalculation(monetary && ledgerId ? ledgerId : null);
  const { data: templates } = useTemplates({ noticeType });

  const checkDuplicate = useCheckDuplicateNotice();
  const createNotice = useCreateNotice();
  const { can } = usePermissions();
  const canCreate = can("notice.create");

  const activeTenants = useMemo(() => (tenants ?? []).filter((t) => !t.archived), [tenants]);
  const jurisdiction = property?.state || "CA";

  // Rent-increase notice-period preview: >10% over scheduled rent triggers the
  // 90-day period under Cal. Civ. Code §827(b)(2) instead of the standard 30.
  const rentIncreaseNewCents = rentIncreaseAmount
    ? Math.round(Number(rentIncreaseAmount) * 100)
    : null;
  const largeIncrease = isLargeRentIncrease(rentIncreaseNewCents, tenant?.monthlyRentCents);
  const noticePeriodDays = largeIncrease ? 90 : 30;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: deadlinePreview } = useDeadline(
    noticeType === "rent_increase" && rentIncreaseNewCents ? today : null,
    noticeType,
    jurisdiction,
    {
      rentIncrease: {
        newRentCents: rentIncreaseNewCents,
        currentRentCents: tenant?.monthlyRentCents ?? null,
      },
    },
  );
  const jurisdictionTemplates = useMemo(() => {
    const all = templates ?? [];
    const local = all.filter((t) => t.jurisdiction === jurisdiction);
    return local.length > 0 ? local : all;
  }, [templates, jurisdiction]);

  // Preselect delinquent months whenever the calculation changes.
  useEffect(() => {
    if (!calc) return;
    const next: Record<string, boolean> = {};
    for (const m of calc.months) next[m.month] = m.rentOnlyBalanceCents > 0;
    setSelectedMonths(next);
  }, [calc]);

  // Default LAHD letter for City of LA properties.
  useEffect(() => {
    setIncludeLahd(property?.isLosAngelesCity ?? false);
  }, [property]);

  // Keep the template choice valid for the chosen type/jurisdiction.
  useEffect(() => {
    if (jurisdictionTemplates.length > 0 && !jurisdictionTemplates.some((t) => t.id === templateId)) {
      setTemplateId(jurisdictionTemplates[0].id);
    }
  }, [jurisdictionTemplates, templateId]);

  const months: NoticeMonth[] = useMemo(() => {
    if (!monetary || !calc) return [];
    return calc.months.filter((m) => selectedMonths[m.month]).map(toNoticeMonth);
  }, [monetary, calc, selectedMonths]);

  const totalCents = months.reduce((s, m) => s + m.selectedAmountCents, 0);

  const step1Valid = !!tenant && !!property && (!monetary || !!ledgerId);
  const step2Valid = !monetary || (months.length > 0 && totalCents > 0);
  const typeFieldsValid = (() => {
    switch (noticeType) {
      case "perform_covenant_3day":
        return covenantDescription.trim().length > 0;
      case "entry_24hr":
        return !!entryDate && entryTimeWindow.trim().length > 0 && entryReason.trim().length > 0;
      case "termination_30day":
      case "termination_60day":
        return !!terminationDate;
      case "rent_increase":
        return Number(rentIncreaseAmount) > 0 && !!rentIncreaseDate;
      default:
        return true;
    }
  })();

  const buildInput = (duplicateOverrideReason: string | null): NoticeInput => ({
    noticeType,
    jurisdiction,
    tenantId,
    propertyId: property!.id,
    unit: tenant!.unit,
    ledgerId: monetary ? ledgerId || null : null,
    months,
    payment: { ...property!.payment },
    templateId: templateId || null,
    includeLahdLetter: includeLahd,
    covenantDescription: covenantDescription.trim() || undefined,
    entryDate: entryDate || null,
    entryTimeWindow: entryTimeWindow.trim() || undefined,
    entryReason: entryReason.trim() || undefined,
    terminationDate: terminationDate || null,
    rentIncreaseNewAmountCents: rentIncreaseAmount ? Math.round(Number(rentIncreaseAmount) * 100) : null,
    rentIncreaseEffectiveDate: rentIncreaseDate || null,
    internalNotes: internalNotes.trim() || undefined,
    duplicateOverrideReason,
  });

  const submit = (input: NoticeInput) =>
    createNotice.mutate(input, {
      onSuccess: (notice) => {
        toast({ title: "Draft created", description: "The notice draft is ready for validation and review." });
        navigate(`/notices/${notice.id}`);
      },
      onError: (e) =>
        toast({
          title: "Could not create notice",
          description: e instanceof Error ? e.message : "Unknown error.",
          variant: "destructive",
        }),
    });

  const handleCreate = () => {
    if (!tenant || !property) return;
    checkDuplicate.mutate(
      {
        tenantId,
        propertyId: property.id,
        unit: tenant.unit,
        months: months.map((m) => m.month),
        noticeType,
      },
      {
        onSuccess: (result) => {
          if (result.duplicate) {
            setDuplicateDialog(true);
          } else {
            submit(buildInput(null));
          }
        },
        onError: () => submit(buildInput(null)),
      },
    );
  };

  const busy = checkDuplicate.isPending || createNotice.isPending;
  const lastStep = 3;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notices">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Prepare Notice</h1>
          <p className="text-muted-foreground mt-1">
            Guided preparation with rent-only calculation and compliance validation.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {["Tenant & Source", "Calculation Review", "Configure & Create"].map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
                step === i + 1
                  ? "bg-primary text-primary-foreground"
                  : step > i + 1
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs font-bold">
                {i + 1}
              </span>
              {label}
            </div>
            {i < 2 && <div className="w-6 h-px bg-border" />}
          </div>
        ))}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>Select Tenant &amp; Source</CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="space-y-2">
              <Label>Notice type *</Label>
              <Select value={noticeType} onValueChange={(v) => setNoticeType(v as NoticeType)}>
                <SelectTrigger data-testid="select-notice-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(NOTICE_TYPE_LABELS) as NoticeType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {NOTICE_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tenant *</Label>
              <Select
                value={tenantId}
                onValueChange={(v) => {
                  setTenantId(v);
                  setLedgerId("");
                }}
              >
                <SelectTrigger data-testid="select-tenant">
                  <SelectValue placeholder="Select tenant" />
                </SelectTrigger>
                <SelectContent>
                  {activeTenants.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.names.join(" & ")} {t.unit ? `— Unit ${t.unit}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tenant && !property && (
                <p className="text-xs text-destructive">
                  This tenant is not linked to a property. Assign a property before preparing a notice.
                </p>
              )}
              {property && (
                <p className="text-xs text-muted-foreground">
                  {property.nickname} — {property.addressLine1}, {property.city}, {property.state}{" "}
                  {property.zip} (jurisdiction: {jurisdiction})
                </p>
              )}
            </div>
            {monetary && (
              <div className="space-y-2">
                <Label>Ledger *</Label>
                <Select value={ledgerId} onValueChange={setLedgerId} disabled={!tenantId}>
                  <SelectTrigger data-testid="select-ledger">
                    <SelectValue
                      placeholder={tenantId ? "Select the imported ledger" : "Select a tenant first"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(ledgers ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name} ({l.transactionCount} txns)
                        {l.sourceType === "manual" ? " — manual entry" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {tenantId && (ledgers?.length ?? 0) === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No ledgers for this tenant yet.{" "}
                    <Link href="/import" className="text-primary underline">
                      Import a ledger
                    </Link>{" "}
                    or enter a statement manually from the tenant's page to calculate the
                    rent-only demand.
                  </p>
                )}
              </div>
            )}
            <div className="pt-2 flex justify-end">
              <Button
                onClick={() => setStep(monetary ? 2 : 3)}
                disabled={!step1Valid}
                data-testid="button-step1-next"
              >
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 2 && monetary && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <Scale className="w-5 h-5 text-primary" />
              Rent-Only Calculation Review
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            {calcLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" /> Calculating…
              </div>
            )}
            {calc && (
              <>
                {calc.globalWarnings.length > 0 && (
                  <div className="rounded-lg border border-accent/40 bg-accent/5 p-4 space-y-1">
                    {calc.globalWarnings.map((w, i) => (
                      <p key={i} className="text-sm flex gap-2">
                        <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                        {w}
                      </p>
                    ))}
                  </div>
                )}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Rent charged</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">Rent-only balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calc.months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell>
                          <Checkbox
                            checked={!!selectedMonths[m.month]}
                            disabled={m.rentOnlyBalanceCents <= 0}
                            onCheckedChange={(c) =>
                              setSelectedMonths((s) => ({ ...s, [m.month]: c === true }))
                            }
                            data-testid={`checkbox-month-${m.month}`}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                        <TableCell className="text-right">{formatCents(m.rentChargedCents)}</TableCell>
                        <TableCell className="text-right">{formatCents(m.paymentsAppliedCents)}</TableCell>
                        <TableCell className="text-right">{formatCents(m.creditsAppliedCents)}</TableCell>
                        <TableCell className="text-right font-serif font-bold">
                          {formatCents(m.rentOnlyBalanceCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <div className="flex items-center justify-between rounded-lg bg-muted/40 px-4 py-3">
                  <div className="text-sm text-muted-foreground">
                    Excluded non-rent charges (late fees, utilities, deposits…):{" "}
                    <span className="font-medium text-foreground">
                      {formatCents(calc.totalExcludedCents)}
                    </span>{" "}
                    — never included in the demand.
                  </div>
                  <div className="text-right">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">
                      Total demand
                    </div>
                    <div className="font-serif text-2xl font-bold" data-testid="text-total-demand">
                      {formatCents(totalCents)}
                    </div>
                  </div>
                </div>
              </>
            )}
            <div className="pt-2 flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <Button onClick={() => setStep(3)} disabled={!step2Valid} data-testid="button-step2-next">
                Next <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" />
              Configure Notice
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-5">
            <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm">
              <span className="font-medium">{NOTICE_TYPE_LABELS[noticeType]}</span> —{" "}
              {tenant?.names.join(" & ")}
              {monetary && (
                <>
                  {" "}
                  • {months.length} month{months.length === 1 ? "" : "s"} •{" "}
                  <span className="font-serif font-bold">{formatCents(totalCents)}</span>
                </>
              )}
            </div>

            <div className="space-y-2">
              <Label>Template *</Label>
              <Select value={templateId} onValueChange={setTemplateId}>
                <SelectTrigger data-testid="select-template">
                  <SelectValue placeholder="Select template" />
                </SelectTrigger>
                <SelectContent>
                  {jurisdictionTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} ({t.jurisdiction}, v{t.currentVersion})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {noticeType === "perform_covenant_3day" && (
              <div className="space-y-2">
                <Label>Covenant violation description *</Label>
                <Textarea
                  value={covenantDescription}
                  onChange={(e) => setCovenantDescription(e.target.value)}
                  placeholder="Describe the lease covenant violated and how to cure it…"
                  data-testid="input-covenant"
                />
              </div>
            )}

            {noticeType === "entry_24hr" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Entry date *</Label>
                  <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} data-testid="input-entry-date" />
                </div>
                <div className="space-y-2">
                  <Label>Time window *</Label>
                  <Input
                    placeholder="e.g. 9:00 AM – 12:00 PM"
                    value={entryTimeWindow}
                    onChange={(e) => setEntryTimeWindow(e.target.value)}
                    data-testid="input-entry-window"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Reason *</Label>
                  <Input
                    placeholder="e.g. Repair kitchen faucet"
                    value={entryReason}
                    onChange={(e) => setEntryReason(e.target.value)}
                    data-testid="input-entry-reason"
                  />
                </div>
              </div>
            )}

            {(noticeType === "termination_30day" || noticeType === "termination_60day") && (
              <div className="space-y-2 max-w-xs">
                <Label>Termination date *</Label>
                <Input
                  type="date"
                  value={terminationDate}
                  onChange={(e) => setTerminationDate(e.target.value)}
                  data-testid="input-termination-date"
                />
              </div>
            )}

            {noticeType === "rent_increase" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-lg">
                <div className="space-y-2">
                  <Label>New monthly rent ($) *</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={rentIncreaseAmount}
                    onChange={(e) => setRentIncreaseAmount(e.target.value)}
                    data-testid="input-rent-increase-amount"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Effective date *</Label>
                  <Input
                    type="date"
                    value={rentIncreaseDate}
                    onChange={(e) => setRentIncreaseDate(e.target.value)}
                    data-testid="input-rent-increase-date"
                  />
                </div>
                {rentIncreaseNewCents != null && rentIncreaseNewCents > 0 && (
                  <div
                    className={`sm:col-span-2 rounded-lg border p-4 text-sm space-y-1 ${
                      largeIncrease ? "border-accent/40 bg-accent/5" : "bg-muted/40"
                    }`}
                    data-testid="text-rent-increase-period"
                  >
                    <p className="flex gap-2 font-medium">
                      {largeIncrease && (
                        <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                      )}
                      Required notice period: {noticePeriodDays} calendar days
                      {largeIncrease
                        ? " — the increase exceeds 10% of the tenant's scheduled rent (Cal. Civ. Code §827(b)(2))."
                        : " (increase is 10% or less of the tenant's scheduled rent)."}
                    </p>
                    {tenant?.monthlyRentCents != null && tenant.monthlyRentCents > 0 ? (
                      <p className="text-muted-foreground">
                        Scheduled rent {formatCents(tenant.monthlyRentCents)} → new rent{" "}
                        {formatCents(rentIncreaseNewCents)}.
                        {deadlinePreview && (
                          <>
                            {" "}
                            If served today, the notice period expires{" "}
                            <span className="font-medium text-foreground" data-testid="text-rent-increase-expiration">
                              {deadlinePreview.expirationDate}
                            </span>
                            .
                          </>
                        )}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">
                        No scheduled rent is on file for this tenant, so the 10% threshold cannot be
                        checked — the standard 30-day period is assumed. Verify before serving.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {property?.isLosAngelesCity && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="lahd"
                  checked={includeLahd}
                  onCheckedChange={(c) => setIncludeLahd(c === true)}
                  data-testid="checkbox-lahd"
                />
                <Label htmlFor="lahd" className="font-normal">
                  Include LAHD Right to Counsel letter (City of Los Angeles requirement)
                </Label>
              </div>
            )}

            <div className="space-y-2">
              <Label>Internal notes (never printed)</Label>
              <Textarea
                value={internalNotes}
                onChange={(e) => setInternalNotes(e.target.value)}
                placeholder="Optional notes for your team…"
                data-testid="input-internal-notes"
              />
            </div>

            <div className="pt-2 flex justify-between">
              <Button variant="outline" onClick={() => setStep(monetary ? 2 : 1)}>
                <ArrowLeft className="w-4 h-4 mr-2" /> Back
              </Button>
              <Button
                onClick={handleCreate}
                disabled={
                  !step1Valid || !step2Valid || !typeFieldsValid || !templateId || busy || !canCreate
                }
                data-testid="button-create-notice"
              >
                {busy && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                {canCreate ? "Create Draft Notice" : "Insufficient permissions"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {step > lastStep && null}

      <Dialog open={duplicateDialog} onOpenChange={setDuplicateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-accent" />
              Possible duplicate notice
            </DialogTitle>
            <DialogDescription>
              An active notice of the same type already covers this tenant, unit, or one of the
              selected months. Creating another may confuse service and deadlines. Provide a reason
              to proceed anyway.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={duplicateReason}
            onChange={(e) => setDuplicateReason(e.target.value)}
            placeholder="Reason for creating a duplicate (required)…"
            data-testid="input-duplicate-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialog(false)}>
              Cancel
            </Button>
            <Button
              disabled={duplicateReason.trim().length === 0 || createNotice.isPending}
              onClick={() => {
                setDuplicateDialog(false);
                submit(buildInput(duplicateReason.trim()));
              }}
              data-testid="button-confirm-duplicate"
            >
              Create anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
