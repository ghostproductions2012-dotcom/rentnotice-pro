import { useMemo, useRef, useState } from "react";
import {
  useWorkOrders,
  useWorkOrder,
  useCreateWorkOrder,
  useUpdateWorkOrder,
  useChangeWorkOrderStatus,
  useDeleteWorkOrder,
  useProperties,
  useTenants,
  usePermissions,
  useSettings,
  useAddAttachment,
  useAttachments,
  useDeleteAttachment,
} from "@/lib/api/hooks";
import { getServices } from "@/lib/api/services";
import type {
  WorkOrder,
  WorkOrderCategory,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@/lib/types";
import {
  WORK_ORDER_CATEGORY_LABELS,
  WORK_ORDER_PRIORITY_LABELS,
  WORK_ORDER_STATUS_LABELS,
  formatCents,
} from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Wrench,
  Plus,
  Search,
  Trash2,
  CalendarClock,
  History,
  UploadCloud,
  DownloadCloud,
  Loader2,
  Smartphone,
  List,
  LayoutGrid,
  ImagePlus,
  Camera,
  X,
} from "lucide-react";
import { downscalePhotoDataUrl } from "@/lib/images";
import {
  FIELD_SYNC_AUTH_REQUIRED_MESSAGE,
  useFieldSyncAuth,
} from "@/lib/field-sync";

const SYNC_URL = "/api/field/work-orders";

type RemoteWorkOrderPhoto = {
  id: string;
  photoDataUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string;
  note: string;
};

type RemoteWorkOrder = {
  id: string;
  workOrderId: string;
  assigneeName: string;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  category: string;
  title: string;
  description: string;
  propertyAddress: string;
  unit: string;
  tenantNames: string;
  dueDate: string | null;
  vendorName: string;
  vendorContact: string;
  fieldNotes: string;
  completedAt: string | null;
  photos: RemoteWorkOrderPhoto[];
  createdAt: string;
  updatedAt: string;
};

const STATUS_VARIANT: Record<WorkOrderStatus, string> = {
  new: "bg-accent text-accent-foreground",
  assigned: "bg-blue-600 text-white",
  in_progress: "bg-primary text-primary-foreground",
  on_hold: "bg-amber-500 text-white",
  completed: "bg-green-600 text-white",
  cancelled: "bg-muted text-muted-foreground",
};

const PRIORITY_VARIANT: Record<WorkOrderPriority, string> = {
  low: "bg-muted text-muted-foreground",
  normal: "bg-secondary text-secondary-foreground",
  high: "bg-amber-500 text-white",
  emergency: "bg-destructive text-destructive-foreground",
};

const STATUS_ORDER: WorkOrderStatus[] = [
  "new",
  "assigned",
  "in_progress",
  "on_hold",
  "completed",
  "cancelled",
];

function centsToInput(cents: number | null): string {
  return cents == null ? "" : (cents / 100).toFixed(2);
}

function inputToCents(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export default function MaintenancePage() {
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [propertyFilter, setPropertyFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [view, setView] = useState<"list" | "board">("list");
  const [search, setSearch] = useState("");
  const { data: workOrders, isLoading } = useWorkOrders();
  const { data: properties } = useProperties();
  const { data: tenants } = useTenants();
  const { data: settings } = useSettings();
  const { licenseKey, syncHeaders } = useFieldSyncAuth();
  const { can } = usePermissions();
  const { toast } = useToast();
  const qc = useQueryClient();
  const addAttachment = useAddAttachment();
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);

  const createWorkOrder = useCreateWorkOrder();
  const updateWorkOrder = useUpdateWorkOrder();
  const changeStatus = useChangeWorkOrderStatus();
  const deleteWorkOrder = useDeleteWorkOrder();

  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);
  const [deleteReason, setDeleteReason] = useState("");

  // Create form state
  const [propertyId, setPropertyId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [unit, setUnit] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<WorkOrderCategory>("general");
  const [priority, setPriority] = useState<WorkOrderPriority>("normal");
  const [dueDate, setDueDate] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [vendorName, setVendorName] = useState("");
  const [vendorContact, setVendorContact] = useState("");
  const [costEstimate, setCostEstimate] = useState("");

  const canManage = can ? can("field.manage") : true;

  const propertyById = useMemo(() => {
    const map = new Map<string, string>();
    (properties ?? []).forEach((p) => map.set(p.id, p.nickname));
    return map;
  }, [properties]);

  const tenantById = useMemo(() => {
    const map = new Map<string, string>();
    (tenants ?? []).forEach((t) => map.set(t.id, t.names.join(" & ")));
    return map;
  }, [tenants]);

  const propertyTenants = useMemo(
    () => (tenants ?? []).filter((t) => !propertyId || t.propertyId === propertyId),
    [tenants, propertyId],
  );

  const filtered = useMemo(() => {
    let list = workOrders ?? [];
    if (statusFilter === "open") {
      list = list.filter((w) => !["completed", "cancelled"].includes(w.status));
    } else if (statusFilter !== "all") {
      list = list.filter((w) => w.status === statusFilter);
    }
    if (categoryFilter !== "all") list = list.filter((w) => w.category === categoryFilter);
    if (propertyFilter !== "all") list = list.filter((w) => w.propertyId === propertyFilter);
    if (priorityFilter !== "all") list = list.filter((w) => w.priority === priorityFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (w) =>
          w.title.toLowerCase().includes(q) ||
          w.description.toLowerCase().includes(q) ||
          w.assigneeName.toLowerCase().includes(q) ||
          w.vendorName.toLowerCase().includes(q) ||
          (propertyById.get(w.propertyId) ?? "").toLowerCase().includes(q),
      );
    }
    // Emergency first, then by due date, then newest.
    const prioRank: Record<WorkOrderPriority, number> = { emergency: 0, high: 1, normal: 2, low: 3 };
    return [...list].sort((a, b) => {
      const p = prioRank[a.priority] - prioRank[b.priority];
      if (p !== 0) return p;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [workOrders, statusFilter, categoryFilter, propertyFilter, priorityFilter, search, propertyById]);

  const boardStatuses = useMemo<WorkOrderStatus[]>(() => {
    if (statusFilter === "open")
      return STATUS_ORDER.filter((s) => !["completed", "cancelled"].includes(s));
    if (statusFilter === "all") return STATUS_ORDER;
    return STATUS_ORDER.filter((s) => s === statusFilter);
  }, [statusFilter]);

  const resetCreateForm = () => {
    setPropertyId("");
    setTenantId("");
    setUnit("");
    setTitle("");
    setDescription("");
    setCategory("general");
    setPriority("normal");
    setDueDate("");
    setAssigneeName("");
    setVendorName("");
    setVendorContact("");
    setCostEstimate("");
  };

  const handleCreate = () => {
    if (!propertyId || !title.trim()) return;
    createWorkOrder.mutate(
      {
        propertyId,
        tenantId: tenantId || null,
        unit,
        title: title.trim(),
        description,
        category,
        priority,
        dueDate: dueDate || null,
        assigneeName,
        vendorName,
        vendorContact,
        costEstimateCents: inputToCents(costEstimate),
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          resetCreateForm();
          toast({ title: "Work order created" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Could not create work order",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteWorkOrder.mutate(
      { id: deleteTarget.id, reason: deleteReason.trim() || "Deleted by user" },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          setDeleteReason("");
          if (detailId === deleteTarget.id) setDetailId(null);
          toast({ title: "Work order deleted" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Could not delete work order",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  const syncEnabled = settings?.syncEnabled === true;

  const propertyAddressById = useMemo(() => {
    const map = new Map<string, string>();
    (properties ?? []).forEach((p) =>
      map.set(p.id, `${p.addressLine1}, ${p.city}, ${p.state} ${p.zip}`),
    );
    return map;
  }, [properties]);

  const handlePush = async () => {
    const assigned = (workOrders ?? []).filter((w) => w.assigneeName.trim());
    if (!assigned.length) {
      toast({
        title: "Nothing to push",
        description: "Assign a work order to a field staff member first.",
      });
      return;
    }
    if (!licenseKey) {
      toast({
        title: "Push failed",
        description: FIELD_SYNC_AUTH_REQUIRED_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    setSyncing("push");
    try {
      const res = await fetch(SYNC_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...syncHeaders },
        body: JSON.stringify({
          workOrders: assigned.map((w) => ({
            id: w.id,
            workOrderId: w.id,
            assigneeName: w.assigneeName,
            status: w.status,
            priority: w.priority,
            category: w.category,
            title: w.title,
            description: w.description,
            propertyAddress: propertyAddressById.get(w.propertyId) ?? "",
            unit: w.unit,
            tenantNames: w.tenantId ? (tenantById.get(w.tenantId) ?? "") : "",
            dueDate: w.dueDate,
            vendorName: w.vendorName,
            vendorContact: w.vendorContact,
            fieldNotes: "",
            completedAt: w.completedAt,
            photos: [],
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
          })),
        }),
      });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      const data = (await res.json()) as { pushed: number };
      toast({
        title: "Pushed to field",
        description: `${data.pushed} work order${data.pushed === 1 ? "" : "s"} synced to the mobile relay.`,
      });
    } catch (e) {
      toast({
        title: "Push failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSyncing(null);
    }
  };

  const handlePull = async () => {
    if (!licenseKey) {
      toast({
        title: "Pull failed",
        description: FIELD_SYNC_AUTH_REQUIRED_MESSAGE,
        variant: "destructive",
      });
      return;
    }
    setSyncing("pull");
    try {
      const res = await fetch(SYNC_URL, { headers: syncHeaders });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      const remote = (await res.json()) as RemoteWorkOrder[];
      const local = workOrders ?? [];
      const services = getServices();
      let updated = 0;
      for (const r of remote) {
        const l = local.find((w) => w.id === r.id);
        if (!l) continue; // desktop is the source of work orders
        let touched = false;

        const remoteNewer = r.updatedAt > l.updatedAt;
        if (remoteNewer && r.status !== l.status) {
          await changeStatus.mutateAsync({
            id: l.id,
            toStatus: r.status,
            note: r.fieldNotes
              ? `Field update: ${r.fieldNotes}`
              : "Updated from field sync",
          });
          touched = true;
        }

        // Photos from the field become work-order attachments (append-only).
        if (r.photos.length > 0) {
          const existing = await services.listAttachments("work_order", l.id);
          const knownNames = new Set(existing.map((a) => a.fileName));
          for (const p of r.photos) {
            const fileName = `field-photo-${p.id}.jpg`;
            if (knownNames.has(fileName)) continue;
            const dataUrl = await downscalePhotoDataUrl(p.photoDataUrl);
            await addAttachment.mutateAsync({
              entityType: "work_order",
              entityId: l.id,
              kind: "photo",
              fileName,
              mimeType: "image/jpeg",
              dataUrl,
              note: [
                p.note,
                p.latitude != null && p.longitude != null
                  ? `GPS ${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}`
                  : "",
                `Captured ${p.capturedAt}`,
              ]
                .filter(Boolean)
                .join(" • "),
            });
            touched = true;
          }
        }
        if (touched) updated += 1;
      }
      qc.invalidateQueries();
      toast({
        title: "Pulled field updates",
        description: updated
          ? `${updated} work order${updated === 1 ? "" : "s"} updated with field activity.`
          : "Everything is already up to date.",
      });
    } catch (e) {
      toast({
        title: "Pull failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSyncing(null);
    }
  };

  const overdue = (w: WorkOrder) =>
    !!w.dueDate &&
    !["completed", "cancelled"].includes(w.status) &&
    w.dueDate < new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Maintenance</h1>
          <p className="text-muted-foreground mt-1">
            Track work orders, vendors, and repair costs across your properties.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && (
            <>
              <Button
                variant="outline"
                onClick={handlePull}
                disabled={!syncEnabled || syncing !== null}
                data-testid="button-pull-work-orders"
              >
                {syncing === "pull" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <DownloadCloud className="w-4 h-4 mr-2" />
                )}
                Pull Field Updates
              </Button>
              <Button
                variant="outline"
                onClick={handlePush}
                disabled={!syncEnabled || syncing !== null}
                data-testid="button-push-work-orders"
              >
                {syncing === "push" ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <UploadCloud className="w-4 h-4 mr-2" />
                )}
                Push to Field
              </Button>
            </>
          )}
          {canManage && (
            <Button onClick={() => setCreateOpen(true)} data-testid="button-new-work-order">
              <Plus className="w-4 h-4 mr-2" />
              New Work Order
            </Button>
          )}
        </div>
      </div>

      {!syncEnabled && canManage && (
        <Card>
          <CardContent className="py-4 flex items-start gap-3">
            <Smartphone className="w-5 h-5 mt-0.5 text-muted-foreground" />
            <div>
              <div className="font-medium">Mobile sync is off</div>
              <div className="text-sm text-muted-foreground">
                Enable field sync in Settings to push work orders to the RentNotice Field
                mobile app and pull back completion updates and photos.
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 w-64"
            placeholder="Search work orders…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-work-orders"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {WORK_ORDER_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-44" data-testid="select-category-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(WORK_ORDER_CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={priorityFilter} onValueChange={setPriorityFilter}>
          <SelectTrigger className="w-40" data-testid="select-priority-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {Object.entries(WORK_ORDER_PRIORITY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={propertyFilter} onValueChange={setPropertyFilter}>
          <SelectTrigger className="w-48" data-testid="select-property-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All properties</SelectItem>
            {(properties ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nickname}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center rounded-md border overflow-hidden">
          <Button
            variant={view === "list" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("list")}
            data-testid="button-view-list"
          >
            <List className="w-4 h-4 mr-1.5" />
            List
          </Button>
          <Button
            variant={view === "board" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none"
            onClick={() => setView("board")}
            data-testid="button-view-board"
          >
            <LayoutGrid className="w-4 h-4 mr-1.5" />
            Board
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading work orders…</div>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <Wrench className="w-10 h-10 mx-auto text-muted-foreground" />
            <div className="font-medium text-lg">
              {workOrders?.length ? "No work orders match your filters" : "No work orders yet"}
            </div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {workOrders?.length
                ? "Adjust the filters above to see more results."
                : "Log maintenance requests and repairs to keep a complete history for every property."}
            </p>
          </CardContent>
        </Card>
      ) : view === "board" ? (
        <div className="flex gap-3 overflow-x-auto pb-2 items-start">
          {boardStatuses.map((s) => {
            const items = filtered.filter((w) => w.status === s);
            return (
              <div
                key={s}
                className="w-72 shrink-0 rounded-lg bg-muted/40 border p-2 space-y-2"
                data-testid={`board-column-${s}`}
              >
                <div className="flex items-center justify-between px-1 py-0.5">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_VARIANT[s]}`}>
                    {WORK_ORDER_STATUS_LABELS[s]}
                  </span>
                  <span className="text-xs text-muted-foreground font-medium">{items.length}</span>
                </div>
                {items.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-6">No work orders</div>
                ) : (
                  items.map((w) => (
                    <Card
                      key={w.id}
                      className="cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => setDetailId(w.id)}
                      data-testid={`board-card-${w.id}`}
                    >
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm leading-snug">{w.title}</span>
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${PRIORITY_VARIANT[w.priority]}`}>
                            {WORK_ORDER_PRIORITY_LABELS[w.priority]}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {propertyById.get(w.propertyId) ?? "Unknown property"}
                          {w.unit ? `, Unit ${w.unit}` : ""}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                            {WORK_ORDER_CATEGORY_LABELS[w.category]}
                          </Badge>
                          {w.dueDate && (
                            <span className={overdue(w) ? "text-destructive font-medium" : ""}>
                              <CalendarClock className="w-3 h-3 inline mr-0.5" />
                              {w.dueDate}
                            </span>
                          )}
                          {w.assigneeName && <span className="truncate">{w.assigneeName}</span>}
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((w) => (
            <Card
              key={w.id}
              className="cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => setDetailId(w.id)}
              data-testid={`card-work-order-${w.id}`}
            >
              <CardContent className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_VARIANT[w.status]}`}>
                        {WORK_ORDER_STATUS_LABELS[w.status]}
                      </span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded ${PRIORITY_VARIANT[w.priority]}`}>
                        {WORK_ORDER_PRIORITY_LABELS[w.priority]}
                      </span>
                      <span className="font-medium">{w.title}</span>
                      <Badge variant="outline">{WORK_ORDER_CATEGORY_LABELS[w.category]}</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {propertyById.get(w.propertyId) ?? "Unknown property"}
                      {w.unit ? `, Unit ${w.unit}` : ""}
                      {w.tenantId && tenantById.get(w.tenantId)
                        ? ` — ${tenantById.get(w.tenantId)}`
                        : ""}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-3 flex-wrap">
                      {w.assigneeName && (
                        <span>
                          Assigned to <span className="text-foreground">{w.assigneeName}</span>
                        </span>
                      )}
                      {w.vendorName && (
                        <span>
                          Vendor <span className="text-foreground">{w.vendorName}</span>
                        </span>
                      )}
                      {w.dueDate && (
                        <span className={overdue(w) ? "text-destructive font-medium" : ""}>
                          <CalendarClock className="w-3.5 h-3.5 inline mr-1" />
                          Due {w.dueDate}
                          {overdue(w) ? " (overdue)" : ""}
                        </span>
                      )}
                      {w.costActualCents != null ? (
                        <span>
                          Cost <span className="text-foreground">{formatCents(w.costActualCents)}</span>
                        </span>
                      ) : w.costEstimateCents != null ? (
                        <span>
                          Est. <span className="text-foreground">{formatCents(w.costEstimateCents)}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {canManage && !["completed", "cancelled"].includes(w.status) && (
                    <div
                      className="flex items-center gap-2 shrink-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Select
                        value={w.status}
                        onValueChange={(v) =>
                          changeStatus.mutate(
                            { id: w.id, toStatus: v as WorkOrderStatus },
                            {
                              onError: (e: unknown) =>
                                toast({
                                  title: "Could not update status",
                                  description: e instanceof Error ? e.message : String(e),
                                  variant: "destructive",
                                }),
                            },
                          )
                        }
                      >
                        <SelectTrigger className="w-36" data-testid={`select-status-${w.id}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_ORDER.map((s) => (
                            <SelectItem key={s} value={s}>
                              {WORK_ORDER_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Work Order</DialogTitle>
            <DialogDescription>
              Log a maintenance request or repair for one of your properties.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Property</label>
                <Select
                  value={propertyId}
                  onValueChange={(v) => {
                    setPropertyId(v);
                    setTenantId("");
                  }}
                >
                  <SelectTrigger data-testid="select-property">
                    <SelectValue placeholder="Select property" />
                  </SelectTrigger>
                  <SelectContent>
                    {(properties ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nickname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tenant (optional)</label>
                <Select value={tenantId || "none"} onValueChange={(v) => setTenantId(v === "none" ? "" : v)}>
                  <SelectTrigger data-testid="select-tenant">
                    <SelectValue placeholder="No tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No tenant</SelectItem>
                    {propertyTenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.names.join(" & ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Unit (optional)</label>
                <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. 4B" data-testid="input-unit" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Due date (optional)</label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} data-testid="input-due-date" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Kitchen sink leaking"
                data-testid="input-title"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description (optional)</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What needs to be fixed? Access instructions, symptoms…"
                data-testid="input-description"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select value={category} onValueChange={(v) => setCategory(v as WorkOrderCategory)}>
                  <SelectTrigger data-testid="select-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WORK_ORDER_CATEGORY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Priority</label>
                <Select value={priority} onValueChange={(v) => setPriority(v as WorkOrderPriority)}>
                  <SelectTrigger data-testid="select-priority">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(WORK_ORDER_PRIORITY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Assigned to (optional)</label>
                <Input
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                  placeholder="Staff member or field agent"
                  data-testid="input-assignee"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Cost estimate (optional)</label>
                <Input
                  value={costEstimate}
                  onChange={(e) => setCostEstimate(e.target.value)}
                  placeholder="0.00"
                  inputMode="decimal"
                  data-testid="input-cost-estimate"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Vendor (optional)</label>
                <Input
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="e.g. ABC Plumbing"
                  data-testid="input-vendor"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Vendor contact (optional)</label>
                <Input
                  value={vendorContact}
                  onChange={(e) => setVendorContact(e.target.value)}
                  placeholder="Phone or email"
                  data-testid="input-vendor-contact"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!propertyId || !title.trim() || createWorkOrder.isPending}
              data-testid="button-create-work-order"
            >
              {createWorkOrder.isPending ? "Creating…" : "Create Work Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      <WorkOrderDetailDialog
        id={detailId}
        onClose={() => setDetailId(null)}
        canManage={canManage}
        propertyById={propertyById}
        tenantById={tenantById}
        onDelete={(w) => setDeleteTarget(w)}
        updateWorkOrder={updateWorkOrder}
        changeStatus={changeStatus}
      />

      {/* Delete confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete work order?</DialogTitle>
            <DialogDescription>
              This permanently removes "{deleteTarget?.title}" and its history. The deletion is
              recorded in the audit log.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">Reason (optional)</label>
            <Input
              value={deleteReason}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="e.g. Duplicate entry"
              data-testid="input-delete-reason"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleteWorkOrder.isPending}
              data-testid="button-confirm-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {deleteWorkOrder.isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function WorkOrderDetailDialog({
  id,
  onClose,
  canManage,
  propertyById,
  tenantById,
  onDelete,
  updateWorkOrder,
  changeStatus,
}: {
  id: string | null;
  onClose: () => void;
  canManage: boolean;
  propertyById: Map<string, string>;
  tenantById: Map<string, string>;
  onDelete: (w: WorkOrder) => void;
  updateWorkOrder: ReturnType<typeof useUpdateWorkOrder>;
  changeStatus: ReturnType<typeof useChangeWorkOrderStatus>;
}) {
  const { data: workOrder } = useWorkOrder(id);
  const { data: attachments } = useAttachments("work_order", id);
  const addAttachment = useAddAttachment();
  const deleteAttachment = useDeleteAttachment();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [notes, setNotes] = useState<string | null>(null);
  const [costActual, setCostActual] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState("");
  const [previewPhoto, setPreviewPhoto] = useState<string | null>(null);

  const handlePhotoFile = async (file: File) => {
    if (!id) return;
    try {
      const rawDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the file"));
        reader.readAsDataURL(file);
      });
      const dataUrl = await downscalePhotoDataUrl(rawDataUrl);
      await addAttachment.mutateAsync({
        entityType: "work_order",
        entityId: id,
        kind: "photo",
        fileName: file.name || `photo-${Date.now()}.jpg`,
        mimeType: "image/jpeg",
        dataUrl,
      });
      toast({ title: "Photo added" });
    } catch (e) {
      toast({
        title: "Could not add photo",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  if (!id) return null;
  const w = workOrder;
  const photos = (attachments ?? []).filter((a) => a.kind === "photo");

  const saveDetails = () => {
    if (!w) return;
    updateWorkOrder.mutate(
      {
        id: w.id,
        patch: {
          internalNotes: notes ?? w.internalNotes,
          costActualCents: costActual != null ? inputToCents(costActual) : w.costActualCents,
        },
      },
      {
        onSuccess: () => {
          setNotes(null);
          setCostActual(null);
          toast({ title: "Work order updated" });
        },
        onError: (e: unknown) =>
          toast({
            title: "Could not save",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto" data-testid="dialog-work-order-detail">
        {!w ? (
          <div className="py-8 text-center text-muted-foreground">Loading…</div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_VARIANT[w.status]}`}>
                  {WORK_ORDER_STATUS_LABELS[w.status]}
                </span>
                {w.title}
              </DialogTitle>
              <DialogDescription>
                {propertyById.get(w.propertyId) ?? "Unknown property"}
                {w.unit ? `, Unit ${w.unit}` : ""}
                {w.tenantId && tenantById.get(w.tenantId) ? ` — ${tenantById.get(w.tenantId)}` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                <div>
                  <span className="text-muted-foreground">Category:</span>{" "}
                  {WORK_ORDER_CATEGORY_LABELS[w.category]}
                </div>
                <div>
                  <span className="text-muted-foreground">Priority:</span>{" "}
                  {WORK_ORDER_PRIORITY_LABELS[w.priority]}
                </div>
                {w.dueDate && (
                  <div>
                    <span className="text-muted-foreground">Due:</span> {w.dueDate}
                  </div>
                )}
                {w.assigneeName && (
                  <div>
                    <span className="text-muted-foreground">Assigned to:</span> {w.assigneeName}
                  </div>
                )}
                {w.vendorName && (
                  <div>
                    <span className="text-muted-foreground">Vendor:</span> {w.vendorName}
                    {w.vendorContact ? ` (${w.vendorContact})` : ""}
                  </div>
                )}
                {w.costEstimateCents != null && (
                  <div>
                    <span className="text-muted-foreground">Estimate:</span>{" "}
                    {formatCents(w.costEstimateCents)}
                  </div>
                )}
                {w.completedAt && (
                  <div>
                    <span className="text-muted-foreground">Completed:</span>{" "}
                    {new Date(w.completedAt).toLocaleString()}
                  </div>
                )}
              </div>
              {w.description && <p className="whitespace-pre-wrap">{w.description}</p>}

              {canManage && (
                <div className="space-y-3 border-t pt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Actual cost</label>
                      <Input
                        value={costActual ?? centsToInput(w.costActualCents)}
                        onChange={(e) => setCostActual(e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        data-testid="input-cost-actual"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Change status</label>
                      <Select
                        value={w.status}
                        onValueChange={(v) =>
                          changeStatus.mutate(
                            {
                              id: w.id,
                              toStatus: v as WorkOrderStatus,
                              note: statusNote.trim() || undefined,
                            },
                            {
                              onSuccess: () => setStatusNote(""),
                              onError: (e: unknown) =>
                                toast({
                                  title: "Could not update status",
                                  description: e instanceof Error ? e.message : String(e),
                                  variant: "destructive",
                                }),
                            },
                          )
                        }
                      >
                        <SelectTrigger data-testid="select-detail-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {STATUS_ORDER.map((s) => (
                            <SelectItem key={s} value={s}>
                              {WORK_ORDER_STATUS_LABELS[s]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Status note (used on next change)</label>
                    <Input
                      value={statusNote}
                      onChange={(e) => setStatusNote(e.target.value)}
                      placeholder="e.g. Waiting on parts"
                      data-testid="input-status-note"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Internal notes</label>
                    <Textarea
                      value={notes ?? w.internalNotes}
                      onChange={(e) => setNotes(e.target.value)}
                      data-testid="input-internal-notes"
                    />
                  </div>
                </div>
              )}

              <div className="border-t pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-medium flex items-center gap-2">
                    <Camera className="w-4 h-4" />
                    Photos {photos.length > 0 && `(${photos.length})`}
                  </div>
                  {canManage && (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handlePhotoFile(file);
                          e.target.value = "";
                        }}
                        data-testid="input-photo-file"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={addAttachment.isPending}
                        data-testid="button-add-photo"
                      >
                        {addAttachment.isPending ? (
                          <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                        ) : (
                          <ImagePlus className="w-4 h-4 mr-1.5" />
                        )}
                        Add Photo
                      </Button>
                    </>
                  )}
                </div>
                {photos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No photos yet. Add one here, or pull field updates to bring in photos
                    captured on mobile.
                  </p>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {photos.map((p) => (
                      <div key={p.id} className="relative group">
                        <img
                          src={p.dataUrl}
                          alt={p.note || p.fileName}
                          title={p.note || p.fileName}
                          className="w-full h-20 object-cover rounded border cursor-pointer"
                          onClick={() => setPreviewPhoto(p.dataUrl)}
                          data-testid={`img-photo-${p.id}`}
                        />
                        {canManage && (
                          <button
                            className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() =>
                              deleteAttachment.mutate(p.id, {
                                onError: (e: unknown) =>
                                  toast({
                                    title: "Could not remove photo",
                                    description: e instanceof Error ? e.message : String(e),
                                    variant: "destructive",
                                  }),
                              })
                            }
                            aria-label="Remove photo"
                            data-testid={`button-remove-photo-${p.id}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {previewPhoto && (
                  <div
                    className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
                    onClick={() => setPreviewPhoto(null)}
                    data-testid="photo-preview-overlay"
                  >
                    <img
                      src={previewPhoto}
                      alt="Work order photo"
                      className="max-w-full max-h-full rounded shadow-lg"
                    />
                  </div>
                )}
              </div>

              <div className="border-t pt-4 space-y-2">
                <div className="font-medium flex items-center gap-2">
                  <History className="w-4 h-4" />
                  History
                </div>
                <div className="space-y-1.5">
                  {[...w.statusHistory]
                    .sort((a, b) => b.changedAt.localeCompare(a.changedAt))
                    .map((h) => (
                      <div key={h.id} className="text-sm text-muted-foreground">
                        <span className="text-foreground">
                          {WORK_ORDER_STATUS_LABELS[h.toStatus]}
                        </span>{" "}
                        — {new Date(h.changedAt).toLocaleString()}
                        {h.changedByName ? ` by ${h.changedByName}` : ""}
                        {h.note ? ` — ${h.note}` : ""}
                      </div>
                    ))}
                </div>
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between sm:justify-between">
              {canManage ? (
                <Button variant="ghost" className="text-destructive" onClick={() => onDelete(w)} data-testid="button-delete-work-order">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={onClose}>
                  Close
                </Button>
                {canManage && (
                  <Button
                    onClick={saveDetails}
                    disabled={updateWorkOrder.isPending || (notes == null && costActual == null)}
                    data-testid="button-save-work-order"
                  >
                    {updateWorkOrder.isPending ? "Saving…" : "Save"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
