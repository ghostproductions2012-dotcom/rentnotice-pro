import { useMemo, useState } from "react";
import {
  useAuditLog,
  useCompanyProfile,
  useProperties,
  useUsers,
} from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  History,
  Search,
  X,
  Download,
  Printer,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { saveDocument } from "@/lib/download";
import {
  auditActionLabel,
  generateAuditReport,
} from "@/lib/documents/generators/audit-report";
import type { AuditAction, AuditFilters } from "@/lib/types";

const ALL_ACTIONS: AuditAction[] = [
  "tenant_created",
  "tenant_updated",
  "tenant_deleted",
  "property_created",
  "property_updated",
  "property_deleted",
  "ledger_imported",
  "ledger_deleted",
  "mapping_changed",
  "transaction_classified",
  "charge_excluded",
  "charge_included",
  "manual_override",
  "rent_amount_changed",
  "draft_generated",
  "notice_created",
  "notice_updated",
  "notice_finalized",
  "notice_revised",
  "pdf_exported",
  "status_changed",
  "attachment_added",
  "attachment_deleted",
  "draft_deleted",
  "sent_to_attorney",
  "template_created",
  "template_updated",
  "settings_changed",
  "user_created",
  "user_updated",
  "holiday_changed",
  "state_rule_review_changed",
  "backup_exported",
  "backup_restored",
  "login",
  "warning_acknowledged",
  "workspace_activated",
  "directory_synced",
  "service_recorded",
  "work_order_created",
  "work_order_updated",
  "work_order_status_changed",
  "work_order_deleted",
  "chat_channel_created",
  "chat_channel_archived",
  "sample_data_loaded",
  "sample_data_removed",
];

const PAGE_SIZE = 50;

/** Print a PDF blob via a hidden iframe (works in the browser print flow). */
function printPdf(blobUrl: string) {
  const frame = document.createElement("iframe");
  frame.style.position = "fixed";
  frame.style.right = "0";
  frame.style.bottom = "0";
  frame.style.width = "0";
  frame.style.height = "0";
  frame.style.border = "0";
  frame.src = blobUrl;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(blobUrl, "_blank");
    }
    // Keep the frame around long enough for the print dialog to grab it.
    setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}

export default function AuditPage() {
  const [propertyId, setPropertyId] = useState("");
  const [unit, setUnit] = useState("");
  const [actions, setActions] = useState<AuditAction[]>([]);
  const [userId, setUserId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [generating, setGenerating] = useState<"download" | "print" | null>(null);

  const { toast } = useToast();
  const { data: properties } = useProperties();
  const { data: users } = useUsers();
  const { data: companyProfile } = useCompanyProfile();

  const filters: AuditFilters = useMemo(
    () => ({
      propertyId: propertyId || undefined,
      unit: unit || undefined,
      actions: actions.length > 0 ? actions : undefined,
      userId: userId || undefined,
      from: from || undefined,
      to: to || undefined,
      search: search.trim() || undefined,
      limit: 0, // full history; the list paginates client-side
    }),
    [propertyId, unit, actions, userId, from, to, search],
  );

  const { data: audit, isLoading } = useAuditLog(filters);

  const selectedProperty = properties?.find((p) => p.id === propertyId) ?? null;

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (selectedProperty) labels.push(`Property: ${selectedProperty.nickname}`);
    if (unit) labels.push(`Unit: ${unit}`);
    if (actions.length > 0)
      labels.push(`Actions: ${actions.map(auditActionLabel).join(", ")}`);
    if (userId) {
      const u = users?.find((x) => x.id === userId);
      labels.push(`User: ${u?.name ?? userId}`);
    }
    if (from && to) labels.push(`Date range: ${from} to ${to}`);
    else if (from) labels.push(`From: ${from}`);
    else if (to) labels.push(`Through: ${to}`);
    if (search.trim()) labels.push(`Search: "${search.trim()}"`);
    return labels;
  }, [selectedProperty, unit, actions, userId, from, to, search, users]);

  const hasFilters = activeFilterLabels.length > 0;

  const clearAll = () => {
    setPropertyId("");
    setUnit("");
    setActions([]);
    setUserId("");
    setFrom("");
    setTo("");
    setSearch("");
    setVisibleCount(PAGE_SIZE);
  };

  const resetPaging = () => setVisibleCount(PAGE_SIZE);

  const toggleAction = (action: AuditAction) => {
    setActions((prev) =>
      prev.includes(action) ? prev.filter((a) => a !== action) : [...prev, action],
    );
    resetPaging();
  };

  const runReport = async (mode: "download" | "print") => {
    if (generating || !audit) return;
    setGenerating(mode);
    try {
      const { blob, fileName } = await generateAuditReport({
        companyProfile: companyProfile ?? null,
        entries: audit,
        appliedFilters: activeFilterLabels,
      });
      const blobUrl = URL.createObjectURL(blob);
      if (mode === "download") {
        const result = await saveDocument(fileName, blobUrl);
        if (result === "saved") toast({ title: "Report saved" });
      } else {
        printPdf(blobUrl);
      }
    } catch (err) {
      toast({
        title: "Could not generate the report",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setGenerating(null);
    }
  };

  const visible = audit?.slice(0, visibleCount) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Audit Log</h1>
          <p className="text-muted-foreground mt-1">
            Immutable record of all system activity and data changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => runReport("print")}
            disabled={generating !== null || isLoading}
            data-testid="button-print-report"
          >
            {generating === "print" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Printer className="w-4 h-4 mr-2" />
            )}
            Print
          </Button>
          <Button
            onClick={() => runReport("download")}
            disabled={generating !== null || isLoading}
            data-testid="button-download-report"
          >
            {generating === "download" ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Download report
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search summaries and users..."
                className="pl-9"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  resetPaging();
                }}
                data-testid="input-audit-search"
              />
            </div>
            <Select
              value={propertyId || "__all"}
              onValueChange={(v) => {
                setPropertyId(v === "__all" ? "" : v);
                setUnit("");
                resetPaging();
              }}
            >
              <SelectTrigger className="w-48" data-testid="select-audit-property">
                <SelectValue placeholder="All properties" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All properties</SelectItem>
                {properties?.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nickname}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={unit || "__all"}
              onValueChange={(v) => {
                setUnit(v === "__all" ? "" : v);
                resetPaging();
              }}
              disabled={!selectedProperty || selectedProperty.units.length === 0}
            >
              <SelectTrigger className="w-36" data-testid="select-audit-unit">
                <SelectValue
                  placeholder={selectedProperty ? "All units" : "Select property first"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All units</SelectItem>
                {selectedProperty?.units.map((u) => (
                  <SelectItem key={u} value={u}>
                    Unit {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="w-44 justify-between font-normal"
                  data-testid="button-audit-actions"
                >
                  {actions.length === 0
                    ? "All actions"
                    : actions.length === 1
                      ? auditActionLabel(actions[0])
                      : `${actions.length} actions`}
                  <ChevronDown className="w-4 h-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-0" align="start">
                <div className="flex items-center justify-between px-3 py-2 border-b">
                  <span className="text-sm font-medium">Filter by action</span>
                  {actions.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        setActions([]);
                        resetPaging();
                      }}
                      data-testid="button-clear-actions"
                    >
                      All actions
                    </Button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto p-2 space-y-1">
                  {ALL_ACTIONS.map((a) => (
                    <label
                      key={a}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={actions.includes(a)}
                        onCheckedChange={() => toggleAction(a)}
                        data-testid={`checkbox-action-${a}`}
                      />
                      {auditActionLabel(a)}
                    </label>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            <Select
              value={userId || "__all"}
              onValueChange={(v) => {
                setUserId(v === "__all" ? "" : v);
                resetPaging();
              }}
            >
              <SelectTrigger className="w-40" data-testid="select-audit-user">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All users</SelectItem>
                {users?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                className="w-36"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  resetPaging();
                }}
                aria-label="From date"
                data-testid="input-audit-from"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                className="w-36"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  resetPaging();
                }}
                aria-label="To date"
                data-testid="input-audit-to"
              />
            </div>
          </div>

          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {activeFilterLabels.map((label) => (
                <Badge key={label} variant="secondary" className="font-normal">
                  {label}
                </Badge>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={clearAll}
                data-testid="button-clear-filters"
              >
                <X className="w-3.5 h-3.5 mr-1" />
                Clear all filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading audit trail...
              </div>
            ) : audit?.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                {hasFilters
                  ? "No audit entries match the current filters."
                  : "No activity recorded yet."}
              </div>
            ) : (
              visible.map((entry) => (
                <div
                  key={entry.id}
                  className="p-4 flex items-start gap-4 hover:bg-muted/30"
                >
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <History className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-medium">{entry.summary}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(entry.timestamp).toLocaleString()} • User:{" "}
                      {entry.userName} • Action: {auditActionLabel(entry.action)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {!isLoading && audit && audit.length > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span data-testid="text-audit-count">
                Showing {Math.min(visibleCount, audit.length)} of {audit.length}{" "}
                {audit.length === 1 ? "entry" : "entries"}
              </span>
              {audit.length > visibleCount && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                  data-testid="button-load-more"
                >
                  Load more
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
