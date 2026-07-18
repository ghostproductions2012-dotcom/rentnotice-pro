// Manual statement entry — the no-file alternative to the import wizard.
// The user types a small table of charges/payments (date, description, type,
// amount); saving creates a ledger with sourceType "manual" whose rows run
// through the exact same classification + rent-only calculation pipeline as
// imported ledgers.

import { useEffect, useMemo, useState } from "react";
import { todayIsoDate } from "@/lib/utils";
import { useImportLedger, usePermissions, useTenants } from "@/lib/api/hooks";
import type { Id, Ledger, ManualTransactionInput } from "@/lib/types";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Loader2, PencilLine, Plus, Trash2 } from "lucide-react";

// Each entry type maps to a category string the keyword classifier resolves
// deterministically, plus the sign convention (charges positive, money in
// negative). "Other charge" intentionally stays unclassified so it is
// excluded from the rent demand and flagged for review.
const ENTRY_TYPES = [
  { value: "rent", label: "Rent charge", category: "Rent", sign: 1 },
  { value: "late_fee", label: "Late fee", category: "Late fee", sign: 1 },
  { value: "utility", label: "Utility charge", category: "Utility", sign: 1 },
  { value: "deposit", label: "Security deposit", category: "Security deposit", sign: 1 },
  { value: "other_charge", label: "Other charge (non-rent)", category: "Other charge", sign: 1 },
  { value: "payment", label: "Payment received", category: "Payment", sign: -1 },
  { value: "credit", label: "Credit / concession", category: "Credit", sign: -1 },
] as const;

type EntryType = (typeof ENTRY_TYPES)[number]["value"];

interface RowDraft {
  date: string;
  description: string;
  type: EntryType;
  amount: string; // dollars, always entered positive
}

// The first row's date defaults to today — the desktop webview renders an
// empty date input as if today were selected, so "" reads as filled in while
// still failing the required-date check. Added rows copy the previous row.
const emptyRow = (): RowDraft => ({ date: todayIsoDate(), description: "", type: "rent", amount: "" });

interface ManualStatementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lock the statement to this tenant (e.g. when opened from a tenant page). */
  tenantId?: Id | null;
  /** Called with the created ledger after a successful save. */
  onCreated?: (ledger: Ledger) => void;
}

export function ManualStatementDialog({
  open,
  onOpenChange,
  tenantId: fixedTenantId,
  onCreated,
}: ManualStatementDialogProps) {
  const { toast } = useToast();
  const { data: tenants } = useTenants();
  const importLedger = useImportLedger();
  const { can } = usePermissions();

  const [tenantId, setTenantId] = useState("");
  const [name, setName] = useState("");
  const [rows, setRows] = useState<RowDraft[]>([emptyRow()]);

  useEffect(() => {
    if (!open) return;
    setTenantId(fixedTenantId ?? "");
    setName(`Manual statement — ${new Date().toLocaleDateString("en-US")}`);
    setRows([emptyRow()]);
  }, [open, fixedTenantId]);

  const activeTenants = useMemo(() => (tenants ?? []).filter((t) => !t.archived), [tenants]);
  const tenant = activeTenants.find((t) => t.id === tenantId);

  const setRow = (i: number, patch: Partial<RowDraft>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { ...emptyRow(), date: rs[rs.length - 1]?.date ?? "" }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const rowValid = (r: RowDraft) =>
    !!r.date && Number.isFinite(Number(r.amount)) && Number(r.amount) > 0;
  const completedRows = rows.filter(rowValid);
  // A row someone started typing but hasn't finished must not be silently dropped.
  const partialRows = rows.filter(
    (r) => !rowValid(r) && (r.date || r.description.trim() || r.amount.trim()),
  );
  const canSave =
    can("ledger.manage") &&
    !!tenantId &&
    name.trim().length > 0 &&
    completedRows.length > 0 &&
    partialRows.length === 0;

  const save = () => {
    if (!canSave) return;
    const manualTransactions: ManualTransactionInput[] = completedRows.map((r) => {
      const def = ENTRY_TYPES.find((t) => t.value === r.type)!;
      return {
        date: r.date,
        description: r.description.trim() || def.label,
        category: def.category,
        amountCents: def.sign * Math.round(Math.abs(Number(r.amount)) * 100),
        memo: "Manually entered",
      };
    });
    importLedger.mutate(
      {
        tenantId,
        name: name.trim(),
        sourceType: "manual",
        fileName: null,
        vendor: "generic",
        mapping: null,
        rows: [],
        manualTransactions,
      },
      {
        onSuccess: (ledger) => {
          toast({
            title: "Statement saved",
            description: `${ledger.transactionCount} manually entered transactions classified and ready for review.`,
          });
          onOpenChange(false);
          onCreated?.(ledger);
        },
        onError: (e) =>
          toast({
            title: "Could not save statement",
            description: e instanceof Error ? e.message : "Unknown error.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="w-5 h-5 text-primary" />
            Enter Statement Manually
          </DialogTitle>
          <DialogDescription>
            No export file needed — type the tenant's charges and payments below. Rows are
            classified with the same rules as imported ledgers and the ledger is permanently
            labeled “manual entry”.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Tenant *</Label>
              {fixedTenantId ? (
                <div className="h-9 flex items-center px-3 rounded-md border bg-muted/40 text-sm">
                  {tenant ? `${tenant.names.join(" & ")}${tenant.unit ? ` — Unit ${tenant.unit}` : ""}` : "…"}
                </div>
              ) : (
                <Select value={tenantId} onValueChange={setTenantId}>
                  <SelectTrigger data-testid="select-manual-tenant">
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
              )}
            </div>
            <div className="space-y-2">
              <Label>Statement name *</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="input-manual-name"
              />
            </div>
          </div>

          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Date *</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-48">Type *</TableHead>
                  <TableHead className="w-32 text-right">Amount ($) *</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Input
                        type="date"
                        value={row.date}
                        onChange={(e) => setRow(i, { date: e.target.value })}
                        data-testid={`input-manual-date-${i}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        value={row.description}
                        onChange={(e) => setRow(i, { description: e.target.value })}
                        placeholder={ENTRY_TYPES.find((t) => t.value === row.type)?.label}
                        data-testid={`input-manual-description-${i}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.type}
                        onValueChange={(v) => setRow(i, { type: v as EntryType })}
                      >
                        <SelectTrigger data-testid={`select-manual-type-${i}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ENTRY_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="text-right"
                        value={row.amount}
                        onChange={(e) => setRow(i, { amount: e.target.value })}
                        data-testid={`input-manual-amount-${i}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeRow(i)}
                        disabled={rows.length === 1}
                        aria-label="Remove row"
                        data-testid={`button-manual-remove-${i}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Button variant="outline" size="sm" onClick={addRow} data-testid="button-manual-add-row">
            <Plus className="w-4 h-4 mr-2" />
            Add row
          </Button>
          {partialRows.length > 0 && (
            <p className="text-xs text-destructive" data-testid="text-manual-incomplete">
              {partialRows.length} row{partialRows.length === 1 ? " is" : "s are"} incomplete —
              every started row needs a date and an amount greater than zero (or remove it).
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Enter amounts as positive numbers — payments and credits are applied automatically.
            Only rent charges count toward a 3-day notice demand; everything else is excluded and
            listed separately.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importLedger.isPending}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!canSave || importLedger.isPending} data-testid="button-manual-save">
            {importLedger.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save {completedRows.length > 0 ? `${completedRows.length} ` : ""}Transaction
            {completedRows.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
