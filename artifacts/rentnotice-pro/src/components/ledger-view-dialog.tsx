// Read-only ledger detail dialog: metadata plus every classified transaction.
// Opened from the tenant view ("View Ledger"). Clearly labels the ledger's
// source (manual entry vs. imported file) so the evidence trail stays honest.

import { useLedger } from "@/lib/api/hooks";
import { formatCents, type Id } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, PencilLine, FileText } from "lucide-react";

interface LedgerViewDialogProps {
  ledgerId: Id | null;
  onOpenChange: (open: boolean) => void;
}

export function LedgerViewDialog({ ledgerId, onOpenChange }: LedgerViewDialogProps) {
  const { data: detail, isLoading } = useLedger(ledgerId);
  const ledger = detail?.ledger;
  const manual = ledger?.sourceType === "manual";

  return (
    <Dialog open={!!ledgerId} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {ledger?.name ?? "Ledger"}
            {ledger && (
              <Badge variant={manual ? "secondary" : "outline"} data-testid="badge-ledger-source">
                {manual ? (
                  <>
                    <PencilLine className="w-3 h-3 mr-1" /> Manual entry
                  </>
                ) : (
                  <>
                    <FileText className="w-3 h-3 mr-1" /> Imported file
                  </>
                )}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {ledger ? (
              <>
                {manual
                  ? "Entered by hand — every row below was typed in manually, not imported."
                  : `Imported from ${ledger.sourceFileName ?? "a file"}.`}{" "}
                {ledger.periodStart} to {ledger.periodEnd} • {ledger.transactionCount} transactions.
              </>
            ) : (
              "Loading ledger…"
            )}
          </DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground p-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading transactions…
          </div>
        )}
        {detail && (
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Classified as</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.transactions.map((txn) => {
                  const cls = txn.userOverrideClass ?? txn.systemClass;
                  return (
                    <TableRow key={txn.id} data-testid={`row-txn-${txn.rowIndex}`}>
                      <TableCell className="whitespace-nowrap">{txn.date}</TableCell>
                      <TableCell>
                        <div>{txn.description || <span className="text-muted-foreground">—</span>}</div>
                        {txn.flagged && (
                          <div className="text-xs text-destructive mt-0.5">
                            Flagged: {txn.flagReason ?? "review needed"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="capitalize">{cls.replace(/_/g, " ")}</span>
                        {txn.userOverrideClass && (
                          <span className="text-xs text-muted-foreground ml-1">(override)</span>
                        )}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium whitespace-nowrap ${
                          txn.amountCents < 0 ? "text-primary" : ""
                        }`}
                      >
                        {formatCents(txn.amountCents)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
