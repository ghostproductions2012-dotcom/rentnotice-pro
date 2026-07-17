import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useCreateProperty,
  useCreateTenant,
  useImportLedger,
  useMappingPresets,
  useParseLedgerFile,
  usePermissions,
  useProperties,
  useTenants,
} from "@/lib/api/hooks";
import type { ColumnMapping, Ledger, ParsedLedgerFile, PmVendor, StatementInfo } from "@/lib/types";
import { normalizeRecords } from "@/lib/import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  ChevronDown,
  Database,
  FileText,
  Loader2,
  PencilLine,
  Sparkles,
  Upload,
  UserPlus,
  UserRound,
} from "lucide-react";
import { ManualStatementDialog } from "@/components/manual-statement-dialog";

const NONE = "__none__";
const CREATE_NEW = "__create_new__";

const VENDOR_LABELS: Record<PmVendor, string> = {
  appfolio: "AppFolio",
  buildium: "Buildium",
  yardi: "Yardi",
  propertyware: "Propertyware",
  rent_manager: "Rent Manager",
  tenant_statement: "Tenant Statement (PDF)",
  generic: "Generic / Other",
};

interface MappingField {
  key: keyof ColumnMapping;
  label: string;
  required?: boolean;
  hint: string;
}

// The three fields nearly every ledger needs. Everything else is "Advanced".
const ESSENTIAL_FIELDS: MappingField[] = [
  { key: "date", label: "Transaction date", required: true, hint: "Column containing the charge/payment date" },
  { key: "description", label: "Description", hint: "Line-item description" },
  { key: "amount", label: "Amount", hint: "Signed amount column (charges positive, payments negative)" },
];

const ADVANCED_FIELDS: MappingField[] = [
  { key: "chargeAmount", label: "Charge amount", hint: "Separate column with charge amounts (positive)" },
  { key: "paymentAmount", label: "Payment amount", hint: "Separate column with payment amounts" },
  { key: "creditAmount", label: "Credit amount", hint: "Column with credit/adjustment amounts" },
  { key: "balance", label: "Running balance", hint: "Optional running balance column" },
  { key: "transactionType", label: "Transaction type", hint: "e.g. Charge / Payment / Credit" },
  { key: "category", label: "Category", hint: "Charge category (Rent, Late Fee, Utility…)" },
  { key: "memo", label: "Memo", hint: "Optional memo/notes column" },
  { key: "month", label: "Period / month", hint: "Optional billing-period column" },
  { key: "tenantIdentifier", label: "Tenant identifier", hint: "Optional tenant name/ID column" },
];

type Step = "upload" | "confirm" | "mapping" | "done";

/** Case/whitespace-insensitive name comparison helper. */
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function statementPeriodLabel(st: StatementInfo): string {
  if (!st.periodStart && !st.periodEnd) return "";
  const fmt = (iso: string | null) => {
    if (!iso) return "?";
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : iso;
  };
  return `${fmt(st.periodStart)} – ${fmt(st.periodEnd)}`;
}

export default function ImportWizard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("upload");
  const [dragOver, setDragOver] = useState(false);
  const [parsed, setParsed] = useState<ParsedLedgerFile | null>(null);
  const [tenantId, setTenantId] = useState<string>("");
  const [ledgerName, setLedgerName] = useState("");
  const [vendor, setVendor] = useState<PmVendor>("generic");
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [savePreset, setSavePreset] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [imported, setImported] = useState<Ledger | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Confirm-step selection: an existing tenant id, or CREATE_NEW.
  const [confirmChoice, setConfirmChoice] = useState<string>("");

  const { data: tenants } = useTenants();
  const { data: properties } = useProperties();
  const { data: presets } = useMappingPresets();
  const parseFile = useParseLedgerFile();
  const importLedger = useImportLedger();
  const createTenant = useCreateTenant();
  const createProperty = useCreateProperty();
  const { can } = usePermissions();

  const activeTenants = useMemo(() => (tenants ?? []).filter((t) => !t.archived), [tenants]);
  const statement = parsed?.statement ?? null;

  // Auto-match the statement tenant against existing (non-archived) tenants.
  const matchedTenant = useMemo(() => {
    if (!statement?.tenantName) return null;
    const target = normName(statement.tenantName);
    return (
      activeTenants.find((t) => t.names.some((n) => normName(n) === target)) ??
      activeTenants.find((t) => normName(t.names.join(" ")) === target) ??
      null
    );
  }, [statement, activeTenants]);

  // Auto-match the statement premises against existing properties.
  const matchedProperty = useMemo(() => {
    if (!statement?.street) return null;
    const target = normName(statement.street);
    return (properties ?? []).find((p) => normName(p.addressLine1) === target) ?? null;
  }, [statement, properties]);

  // Default the confirm-step choice whenever a new statement is parsed.
  useEffect(() => {
    if (!statement) return;
    setConfirmChoice(matchedTenant ? matchedTenant.id : statement.tenantName ? CREATE_NEW : "");
  }, [statement, matchedTenant]);

  // Dry-run the normalization pipeline against the current mapping so
  // row-level problems (e.g. unreadable date cells) are visible before import.
  const normalizeWarnings = useMemo(() => {
    if (!parsed || !mapping) return [];
    return normalizeRecords(parsed.rows, mapping).warnings;
  }, [parsed, mapping]);

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    parseFile.mutate(file, {
      onSuccess: (result) => {
        setParsed(result);
        setVendor(result.detectedVendor);
        setMapping(result.suggestedMapping);
        setAdvancedOpen(false);
        const st = result.statement;
        if (st && (st.tenantName || st.street)) {
          const period = statementPeriodLabel(st);
          setLedgerName(
            `Tenant Statement — ${st.tenantName ?? file.name.replace(/\.[^.]+$/, "")}${period ? ` (${period})` : ""}`,
          );
          setStep("confirm");
        } else {
          setLedgerName(
            `${VENDOR_LABELS[result.detectedVendor]} import — ${file.name.replace(/\.[^.]+$/, "")}`,
          );
          setStep("mapping");
        }
      },
      onError: (e) =>
        toast({
          title: "Could not read file",
          description: e instanceof Error ? e.message : "Unsupported or corrupted file.",
          variant: "destructive",
        }),
    });
  };

  const setField = (key: keyof ColumnMapping, value: string) =>
    setMapping((m) => (m ? { ...m, [key]: value === NONE ? null : value } : m));

  const amountMapped =
    !!mapping && (!!mapping.chargeAmount || !!mapping.paymentAmount || !!mapping.creditAmount || !!mapping.amount);
  const canImport =
    can("ledger.manage") &&
    !!parsed && !!mapping && !!mapping.date && amountMapped && !!tenantId && ledgerName.trim().length > 0 &&
    (!savePreset || presetName.trim().length > 0);

  const runImport = (importTenantId: string) => {
    if (!parsed || !mapping) return;
    importLedger.mutate(
      {
        tenantId: importTenantId,
        name: ledgerName.trim(),
        sourceType: parsed.sourceType,
        fileName: parsed.fileName,
        vendor,
        mapping,
        rows: parsed.rows,
        savePresetName: savePreset ? presetName.trim() : null,
      },
      {
        onSuccess: (ledger) => {
          setImported(ledger);
          setStep("done");
          toast({
            title: "Ledger imported",
            description: `${ledger.transactionCount} transactions classified and ready for review.`,
          });
        },
        onError: (e) =>
          toast({
            title: "Import failed",
            description: e instanceof Error ? e.message : "Unknown error.",
            variant: "destructive",
          }),
      },
    );
  };

  const doImport = () => {
    if (!canImport) return;
    runImport(tenantId);
  };

  /**
   * Confirm-step import: resolves the tenant first — either the selected
   * existing tenant, or a one-click create of the property + tenant from the
   * statement header — then runs the ledger import.
   */
  const doConfirmImport = async () => {
    if (!parsed || !mapping || !statement) return;
    try {
      let resolvedTenantId = confirmChoice;
      if (confirmChoice === CREATE_NEW) {
        let propertyId = matchedProperty?.id ?? null;
        if (!propertyId && statement.street) {
          const prop = await createProperty.mutateAsync({
            nickname: statement.street,
            addressLine1: statement.street,
            city: statement.city ?? "",
            state: statement.state ?? "CA",
            zip: statement.zip ?? "",
            units: statement.unit ? [statement.unit] : [],
            ownerName: "",
          });
          propertyId = prop.id;
        }
        const tenant = await createTenant.mutateAsync({
          names: [statement.tenantName ?? "Unknown tenant"],
          propertyId,
          unit: statement.unit ?? "",
          notes: statement.leaseNumber ? `Lease # ${statement.leaseNumber} (from imported statement)` : "",
        });
        resolvedTenantId = tenant.id;
        toast({
          title: "Tenant created",
          description: `${tenant.names.join(" & ")} was added${statement.street ? ` at ${statement.street}` : ""}.`,
        });
      }
      if (!resolvedTenantId) return;
      setTenantId(resolvedTenantId);
      runImport(resolvedTenantId);
    } catch (e) {
      toast({
        title: "Could not create tenant",
        description: e instanceof Error ? e.message : "Unknown error.",
        variant: "destructive",
      });
    }
  };

  const confirmBusy = importLedger.isPending || createTenant.isPending || createProperty.isPending;
  const confirmReady =
    can("ledger.manage") &&
    !!parsed && !!mapping && !!mapping.date && amountMapped &&
    ledgerName.trim().length > 0 &&
    (confirmChoice === CREATE_NEW ? !!statement?.tenantName : !!confirmChoice);

  const resetAll = () => {
    setStep("upload");
    setParsed(null);
    setMapping(null);
    setImported(null);
    setTenantId("");
    setConfirmChoice("");
    setSavePreset(false);
    setPresetName("");
    setAdvancedOpen(false);
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="text-center space-y-2 pb-2">
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Database className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Import Ledger</h1>
        <p className="text-muted-foreground">
          Upload a tenant statement or exported ledger from your property management software.
        </p>
      </div>

      <StepIndicator step={step} hasStatement={!!statement} />

      {step === "upload" && (
        <Card
          className={`border-dashed border-2 ${dragOver ? "border-primary bg-primary/5" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFile(e.dataTransfer.files?.[0]);
          }}
        >
          <CardContent
            className="p-12 text-center hover:bg-muted/10 transition-colors cursor-pointer"
            onClick={() => fileRef.current?.click()}
            data-testid="upload-dropzone"
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.xls,.xlsx,.pdf"
              className="hidden"
              data-testid="input-ledger-file"
              onChange={(e) => {
                handleFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {parseFile.isPending ? (
              <>
                <Loader2 className="w-10 h-10 mx-auto text-primary mb-4 animate-spin" />
                <h3 className="text-lg font-medium">Reading file…</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Detecting the statement format and reading the header.
                </p>
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">Click to upload or drag &amp; drop</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Supports CSV, Excel, and PDF formats
                </p>
                <div className="mt-6 flex justify-center gap-4 text-xs text-muted-foreground font-mono">
                  <span className="bg-muted px-2 py-1 rounded">AppFolio</span>
                  <span className="bg-muted px-2 py-1 rounded">Buildium</span>
                  <span className="bg-muted px-2 py-1 rounded">Yardi</span>
                  <span className="bg-muted px-2 py-1 rounded">Rent Manager</span>
                  <span className="bg-muted px-2 py-1 rounded">Propertyware</span>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {step === "upload" && (
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            No export file from your software?{" "}
            <Button
              variant="link"
              className="px-1 h-auto"
              onClick={() => setManualOpen(true)}
              disabled={!can("ledger.manage")}
              data-testid="button-enter-statement-import"
            >
              <PencilLine className="w-4 h-4 mr-1" />
              Enter a statement manually
            </Button>
          </p>
        </div>
      )}

      <ManualStatementDialog
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={(ledger) => {
          setImported(ledger);
          setStep("done");
        }}
      />

      {step === "confirm" && parsed && mapping && statement && (
        <div className="space-y-6">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 flex gap-3">
              <Sparkles className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium" data-testid="text-detected-vendor">
                  {VENDOR_LABELS[vendor]} detected
                </p>
                <p className="text-sm text-muted-foreground">
                  The statement header was read automatically — confirm the tenant below and import.
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle className="flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Statement Details
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-3 text-sm">
                {statement.tenantName && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Tenant</span>
                    <span className="font-medium text-right" data-testid="text-statement-tenant">
                      {statement.tenantName}
                    </span>
                  </div>
                )}
                {statement.street && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Premises</span>
                    <span className="font-medium text-right" data-testid="text-statement-premises">
                      {statement.street}
                      {statement.unit ? ` #${statement.unit}` : ""}
                      {statement.city ? `, ${statement.city}` : ""}
                      {statement.state ? `, ${statement.state}` : ""}
                      {statement.zip ? ` ${statement.zip}` : ""}
                    </span>
                  </div>
                )}
                {statement.leaseNumber && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Lease #</span>
                    <span className="font-medium">{statement.leaseNumber}</span>
                  </div>
                )}
                {statementPeriodLabel(statement) && (
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Statement period</span>
                    <span className="font-medium">{statementPeriodLabel(statement)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Transactions</span>
                  <span className="font-medium">{parsed.rows.length} rows</span>
                </div>
                <div className="pt-3 border-t space-y-2">
                  <Label>Ledger name *</Label>
                  <Input
                    value={ledgerName}
                    onChange={(e) => setLedgerName(e.target.value)}
                    data-testid="input-ledger-name"
                  />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle className="flex items-center gap-2">
                  <UserRound className="w-4 h-4" />
                  Tenant
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                {matchedTenant ? (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-primary/5 border border-primary/20">
                    <CheckCircle2 className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <p className="text-sm" data-testid="text-tenant-matched">
                      Matched existing tenant{" "}
                      <span className="font-medium">{matchedTenant.names.join(" & ")}</span>
                      {matchedTenant.unit ? ` — Unit ${matchedTenant.unit}` : ""}.
                    </p>
                  </div>
                ) : statement.tenantName ? (
                  <div className="flex items-start gap-2 p-3 rounded-md bg-accent/5 border border-accent/30">
                    <UserPlus className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    <p className="text-sm" data-testid="text-tenant-new">
                      No existing tenant named{" "}
                      <span className="font-medium">{statement.tenantName}</span> —{" "}
                      {statement.street
                        ? matchedProperty
                          ? `they will be created at the existing property ${matchedProperty.nickname}.`
                          : "the tenant and property will be created for you."
                        : "the tenant will be created for you."}
                    </p>
                  </div>
                ) : null}

                <div className="space-y-2">
                  <Label>Import this statement for *</Label>
                  <Select value={confirmChoice} onValueChange={setConfirmChoice}>
                    <SelectTrigger data-testid="select-confirm-tenant">
                      <SelectValue placeholder="Choose a tenant" />
                    </SelectTrigger>
                    <SelectContent>
                      {statement.tenantName && (
                        <SelectItem value={CREATE_NEW}>
                          + Create “{statement.tenantName}”
                          {statement.street && !matchedProperty ? ` and property ${statement.street}` : ""}
                        </SelectItem>
                      )}
                      {activeTenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.names.join(" & ")} {t.unit ? `— Unit ${t.unit}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {confirmChoice === CREATE_NEW && statement.street && !matchedProperty && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Building2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>
                      New property: {statement.street}
                      {statement.unit ? ` (Unit ${statement.unit})` : ""}
                      {statement.city ? `, ${statement.city}` : ""}
                      {statement.state ? `, ${statement.state}` : ""}
                      {statement.zip ? ` ${statement.zip}` : ""}. County, bedrooms, and
                      payment details can be added later before serving a notice.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {(parsed.warnings.length > 0 || normalizeWarnings.length > 0 || parsed.ocrUsed) && (
            <ImportWarnings parsed={parsed} normalizeWarnings={normalizeWarnings} />
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button variant="outline" onClick={resetAll} data-testid="button-back-upload">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Choose a different file
              </Button>
              <Button
                variant="ghost"
                onClick={() => setStep("mapping")}
                data-testid="button-adjust-mapping"
              >
                Adjust column mapping
              </Button>
            </div>
            <Button
              onClick={doConfirmImport}
              disabled={!confirmReady || confirmBusy}
              data-testid="button-confirm-import"
            >
              {confirmBusy ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Import {parsed.rows.length} rows
            </Button>
          </div>
        </div>
      )}

      {step === "mapping" && parsed && mapping && (
        <div className="space-y-6">
          {(parsed.warnings.length > 0 || normalizeWarnings.length > 0 || parsed.ocrUsed) && (
            <ImportWarnings parsed={parsed} normalizeWarnings={normalizeWarnings} />
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle>Import Details</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label>Tenant *</Label>
                  <Select value={tenantId} onValueChange={setTenantId}>
                    <SelectTrigger data-testid="select-tenant">
                      <SelectValue placeholder="Select the tenant this ledger belongs to" />
                    </SelectTrigger>
                    <SelectContent>
                      {activeTenants.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.names.join(" & ")} {t.unit ? `— Unit ${t.unit}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ledger name *</Label>
                  <Input
                    value={ledgerName}
                    onChange={(e) => setLedgerName(e.target.value)}
                    data-testid="input-ledger-name"
                  />
                </div>
                {statement && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setStep("confirm")}
                    data-testid="button-back-confirm"
                  >
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    Back to detected statement
                  </Button>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle>Column Mapping</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-3">
                {ESSENTIAL_FIELDS.map((f) => (
                  <MappingFieldRow
                    key={f.key}
                    field={f}
                    mapping={mapping}
                    headers={parsed.headers}
                    onChange={setField}
                  />
                ))}
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-between px-1"
                      data-testid="button-toggle-advanced"
                    >
                      <span className="text-sm text-muted-foreground">
                        Advanced mapping (split charge/payment columns, balance, memo…)
                      </span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                      />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-3 pt-2">
                    {ADVANCED_FIELDS.map((f) => (
                      <MappingFieldRow
                        key={f.key}
                        field={f}
                        mapping={mapping}
                        headers={parsed.headers}
                        onChange={setField}
                      />
                    ))}
                    <div className="space-y-2 pt-2 border-t">
                      <Label>Source vendor</Label>
                      <Select value={vendor} onValueChange={(v) => setVendor(v as PmVendor)}>
                        <SelectTrigger data-testid="select-vendor">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(VENDOR_LABELS) as PmVendor[]).map((v) => (
                            <SelectItem key={v} value={v}>
                              {VENDOR_LABELS[v]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {parsed.detectedVendor !== "generic" && (
                        <p className="text-xs text-muted-foreground">
                          Detected: {VENDOR_LABELS[parsed.detectedVendor]}
                        </p>
                      )}
                    </div>
                    {(presets?.length ?? 0) > 0 && (
                      <div className="space-y-2">
                        <Label>Apply saved mapping preset</Label>
                        <Select
                          onValueChange={(id) => {
                            const p = presets?.find((x) => x.id === id);
                            if (p) {
                              setMapping({ ...p.mapping });
                              setVendor(p.vendor);
                            }
                          }}
                        >
                          <SelectTrigger data-testid="select-preset">
                            <SelectValue placeholder="Choose a preset (optional)" />
                          </SelectTrigger>
                          <SelectContent>
                            {presets?.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name} ({VENDOR_LABELS[p.vendor]})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-2">
                      <Checkbox
                        id="save-preset"
                        checked={savePreset}
                        onCheckedChange={(c) => setSavePreset(c === true)}
                        data-testid="checkbox-save-preset"
                      />
                      <Label htmlFor="save-preset" className="font-normal">
                        Save this mapping as a preset for future imports
                      </Label>
                    </div>
                    {savePreset && (
                      <Input
                        placeholder="Preset name, e.g. “AppFolio standard export”"
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        data-testid="input-preset-name"
                      />
                    )}
                  </CollapsibleContent>
                </Collapsible>
                {!amountMapped && (
                  <p className="text-xs text-destructive flex gap-1.5 pt-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Map at least one amount column (either the single Amount field above, or the
                    split charge/payment columns under Advanced).
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle>
                File Preview{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({parsed.rows.length} rows in {parsed.fileName})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {parsed.headers.map((h) => (
                      <TableHead key={h} className="whitespace-nowrap">
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsed.rows.slice(0, 8).map((row, i) => (
                    <TableRow key={i}>
                      {parsed.headers.map((h) => (
                        <TableCell key={h} className="whitespace-nowrap text-sm">
                          {row[h] ?? ""}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={resetAll} data-testid="button-back-upload">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Choose a different file
            </Button>
            <Button onClick={doImport} disabled={!canImport || importLedger.isPending} data-testid="button-import">
              {importLedger.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Import {parsed.rows.length} rows
            </Button>
          </div>
        </div>
      )}

      {step === "done" && imported && (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <CheckCircle2 className="w-14 h-14 mx-auto text-primary" />
            <h2 className="text-2xl font-serif font-bold">Ledger imported</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              “{imported.name}” — {imported.transactionCount} transactions were classified
              automatically. Continue straight into the 3-day notice, or review the ledger first.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button
                onClick={() => navigate(`/notices/new?tenantId=${imported.tenantId}&ledgerId=${imported.id}`)}
                data-testid="button-prepare-notice"
              >
                <FileText className="w-4 h-4 mr-2" />
                Prepare 3-Day Notice
              </Button>
              <Button variant="outline" onClick={() => navigate(`/tenants/${imported.tenantId}`)} data-testid="button-view-tenant">
                View Tenant
              </Button>
              <Button variant="ghost" onClick={resetAll} data-testid="button-import-another">
                Import another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ImportWarnings({
  parsed,
  normalizeWarnings,
}: {
  parsed: ParsedLedgerFile;
  normalizeWarnings: string[];
}) {
  return (
    <Card className="border-accent/40 bg-accent/5">
      <CardContent className="p-4 space-y-1">
        {parsed.ocrUsed && (
          <p className="text-sm flex gap-2">
            <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            OCR was used to read this PDF — verify every amount against the original.
          </p>
        )}
        {parsed.warnings.map((w, i) => (
          <p key={i} className="text-sm flex gap-2">
            <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            {w}
          </p>
        ))}
        {normalizeWarnings.map((w, i) => (
          <p key={`n-${i}`} className="text-sm flex gap-2" data-testid={`text-normalize-warning-${i}`}>
            <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            {w}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function MappingFieldRow({
  field,
  mapping,
  headers,
  onChange,
}: {
  field: MappingField;
  mapping: ColumnMapping;
  headers: string[];
  onChange: (key: keyof ColumnMapping, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 items-center">
      <div>
        <Label className="text-sm">
          {field.label}
          {field.required ? " *" : ""}
        </Label>
        <p className="text-xs text-muted-foreground">{field.hint}</p>
      </div>
      <Select value={mapping[field.key] ?? NONE} onValueChange={(v) => onChange(field.key, v)}>
        <SelectTrigger data-testid={`select-map-${field.key}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— Not present —</SelectItem>
          {headers.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function StepIndicator({ step, hasStatement }: { step: Step; hasStatement: boolean }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload", label: "Upload file" },
    hasStatement ? { id: "confirm", label: "Confirm details" } : { id: "mapping", label: "Map columns" },
    { id: "done", label: "Done" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  const activeIdx = idx === -1 ? 1 : idx; // "mapping" while a statement exists → middle step
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              i === activeIdx
                ? "bg-primary text-primary-foreground"
                : i < activeIdx
                  ? "bg-primary/10 text-primary"
                  : "bg-muted text-muted-foreground"
            }`}
          >
            <span className="w-5 h-5 rounded-full bg-background/20 flex items-center justify-center text-xs font-bold">
              {i + 1}
            </span>
            {s.label}
          </div>
          {i < steps.length - 1 && <div className="w-8 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}
