import { useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  useImportLedger,
  useMappingPresets,
  useParseLedgerFile,
  usePermissions,
  useTenants,
} from "@/lib/api/hooks";
import type { ColumnMapping, Ledger, ParsedLedgerFile, PmVendor } from "@/lib/types";
import { normalizeRecords } from "@/lib/import";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
  CheckCircle2,
  Database,
  FileText,
  Loader2,
  PencilLine,
  Upload,
} from "lucide-react";
import { ManualStatementDialog } from "@/components/manual-statement-dialog";

const NONE = "__none__";

const VENDOR_LABELS: Record<PmVendor, string> = {
  appfolio: "AppFolio",
  buildium: "Buildium",
  yardi: "Yardi",
  propertyware: "Propertyware",
  rent_manager: "Rent Manager",
  first_light: "First Light PM — Tenant Statement",
  generic: "Generic / Other",
};

const MAPPING_FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean; hint: string }[] = [
  { key: "date", label: "Transaction date", required: true, hint: "Column containing the charge/payment date" },
  { key: "description", label: "Description", hint: "Line-item description" },
  { key: "chargeAmount", label: "Charge amount", hint: "Column with charge amounts (positive)" },
  { key: "paymentAmount", label: "Payment amount", hint: "Column with payment amounts" },
  { key: "creditAmount", label: "Credit amount", hint: "Column with credit/adjustment amounts" },
  { key: "amount", label: "Single signed amount", hint: "Use if one column holds signed amounts instead" },
  { key: "balance", label: "Running balance", hint: "Optional running balance column" },
  { key: "transactionType", label: "Transaction type", hint: "e.g. Charge / Payment / Credit" },
  { key: "category", label: "Category", hint: "Charge category (Rent, Late Fee, Utility…)" },
  { key: "memo", label: "Memo", hint: "Optional memo/notes column" },
  { key: "month", label: "Period / month", hint: "Optional billing-period column" },
  { key: "tenantIdentifier", label: "Tenant identifier", hint: "Optional tenant name/ID column" },
];

type Step = "upload" | "mapping" | "done";

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

  const { data: tenants } = useTenants();
  const { data: presets } = useMappingPresets();
  const parseFile = useParseLedgerFile();
  const importLedger = useImportLedger();
  const { can } = usePermissions();

  const activeTenants = useMemo(() => (tenants ?? []).filter((t) => !t.archived), [tenants]);

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
        setLedgerName(
          `${VENDOR_LABELS[result.detectedVendor]} import — ${file.name.replace(/\.[^.]+$/, "")}`,
        );
        setStep("mapping");
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

  const doImport = () => {
    if (!parsed || !mapping || !canImport) return;
    importLedger.mutate(
      {
        tenantId,
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

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="text-center space-y-2 pb-2">
        <div className="w-16 h-16 bg-primary/10 text-primary rounded-2xl flex items-center justify-center mx-auto mb-4">
          <Database className="w-8 h-8" />
        </div>
        <h1 className="text-3xl font-serif font-bold tracking-tight">Import Ledger</h1>
        <p className="text-muted-foreground">
          Upload an exported ledger from your property management software.
        </p>
      </div>

      <StepIndicator step={step} />

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
                  Detecting vendor format and suggesting a column mapping.
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

      {step === "mapping" && parsed && mapping && (
        <div className="space-y-6">
          {(parsed.warnings.length > 0 || normalizeWarnings.length > 0 || parsed.ocrUsed) && (
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
                <div className="space-y-2">
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle>Column Mapping</CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-3">
                {MAPPING_FIELDS.map((f) => (
                  <div key={f.key} className="grid grid-cols-2 gap-3 items-center">
                    <div>
                      <Label className="text-sm">
                        {f.label}
                        {f.required ? " *" : ""}
                      </Label>
                      <p className="text-xs text-muted-foreground">{f.hint}</p>
                    </div>
                    <Select
                      value={mapping[f.key] ?? NONE}
                      onValueChange={(v) => setField(f.key, v)}
                    >
                      <SelectTrigger data-testid={`select-map-${f.key}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— Not present —</SelectItem>
                        {parsed.headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                {!amountMapped && (
                  <p className="text-xs text-destructive flex gap-1.5 pt-1">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    Map at least one amount column (charge, payment, credit, or single amount).
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
            <Button
              variant="outline"
              onClick={() => {
                setStep("upload");
                setParsed(null);
                setMapping(null);
              }}
              data-testid="button-back-upload"
            >
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
              automatically. Review the rent-only calculation before preparing a notice.
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <Button
                onClick={() => navigate(`/notices/new?tenantId=${imported.tenantId}&ledgerId=${imported.id}`)}
                data-testid="button-prepare-notice"
              >
                <FileText className="w-4 h-4 mr-2" />
                Prepare Notice
              </Button>
              <Button variant="outline" onClick={() => navigate(`/tenants/${imported.tenantId}`)} data-testid="button-view-tenant">
                View Tenant
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("upload");
                  setParsed(null);
                  setMapping(null);
                  setImported(null);
                  setTenantId("");
                  setSavePreset(false);
                  setPresetName("");
                }}
                data-testid="button-import-another"
              >
                Import another
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "upload", label: "Upload file" },
    { id: "mapping", label: "Map columns" },
    { id: "done", label: "Done" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  return (
    <div className="flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium ${
              i === idx
                ? "bg-primary text-primary-foreground"
                : i < idx
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
