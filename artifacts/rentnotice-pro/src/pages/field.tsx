import { useMemo, useState } from "react";
import {
  useFieldAssignments,
  useCreateFieldAssignment,
  useUpdateFieldAssignment,
  useNotices,
  useTenants,
  useSettings,
  usePermissions,
  useRecordService,
  useUsers,
} from "@/lib/api/hooks";
import type { FieldAssignment, FieldEvidence, Notice } from "@/lib/types";
import { NOTICE_TYPE_LABELS, formatCents } from "@/lib/types";
import { Card, CardContent } from "@/components/ui/card";
import { FieldEvidenceGallery } from "@/components/field-evidence-gallery";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  MapPin,
  Plus,
  UploadCloud,
  DownloadCloud,
  Camera,
  Ban,
  Smartphone,
  Loader2,
  Check,
  ChevronsUpDown,
  UserPlus,
} from "lucide-react";
import { useLocation } from "wouter";
import { downscalePhotoDataUrl } from "@/lib/images";
import {
  FIELD_SYNC_AUTH_REQUIRED_MESSAGE,
  useFieldSyncAuth,
} from "@/lib/field-sync";

const SYNC_URL = "/api/field/assignments";

type RemoteEvidence = {
  id: string;
  photoDataUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  capturedAt: string;
  note: string;
};

type RemoteAssignment = {
  id: string;
  noticeId: string;
  assigneeName: string;
  instructions: string;
  status: FieldAssignment["status"];
  serviceMethod: FieldAssignment["serviceMethod"];
  completedAt: string | null;
  serverNotes: string;
  tenantNames: string[];
  propertyAddress: string;
  unit: string;
  noticeType: string;
  deadlineDate: string | null;
  totalAmountCents: number | null;
  source?: string | null;
  evidence: RemoteEvidence[];
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABELS: Record<FieldAssignment["status"], string> = {
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_VARIANT: Record<FieldAssignment["status"], string> = {
  assigned: "bg-accent text-accent-foreground",
  in_progress: "bg-primary text-primary-foreground",
  completed: "bg-green-600 text-white",
  cancelled: "bg-muted text-muted-foreground",
};

const METHOD_LABELS: Record<string, string> = {
  personal: "Personal service",
  substitute: "Substituted service",
  post_and_mail: "Post & mail",
  other: "Other",
};

type ServeCandidate = {
  noticeId: string;
  assignmentId: string;
  tenantNames: string[];
  propertyAddress: string;
  unit: string;
  completedAt: string;
  serviceMethod: FieldAssignment["serviceMethod"];
  assigneeName: string;
};

function localDateParts(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "", time: "" };
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function toPushPayload(
  a: FieldAssignment,
  notice: Notice | undefined,
  source: string | null,
) {
  return {
    id: a.id,
    noticeId: a.noticeId,
    assigneeName: a.assigneeName,
    instructions: a.instructions,
    status: a.status,
    serviceMethod: a.serviceMethod,
    completedAt: a.completedAt,
    serverNotes: "",
    tenantNames: notice?.tenantNames ?? [],
    propertyAddress: notice?.propertyAddress ?? "",
    unit: notice?.unit ?? "",
    noticeType: notice?.noticeType ?? "",
    deadlineDate: notice?.deadlineDate ?? null,
    totalAmountCents: notice?.totalAmountCents ?? null,
    source,
    evidence: a.evidence.map((e) => ({
      id: e.id,
      photoDataUrl: e.photoDataUrl,
      latitude: e.latitude,
      longitude: e.longitude,
      accuracyMeters: e.accuracyMeters,
      capturedAt: e.capturedAt,
      note: e.note,
    })),
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export default function FieldAssignmentsPage() {
  const { data: assignments, isLoading } = useFieldAssignments();
  const { data: notices } = useNotices();
  const { data: tenants } = useTenants();
  const { data: settings } = useSettings();
  const { data: users } = useUsers();
  const createAssignment = useCreateFieldAssignment();
  const updateAssignment = useUpdateFieldAssignment();
  const { toast } = useToast();
  const { can } = usePermissions();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { licenseKey, syncHeaders } = useFieldSyncAuth();

  const [createOpen, setCreateOpen] = useState(false);
  const [noticeId, setNoticeId] = useState("");
  const [assigneeName, setAssigneeName] = useState("");
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentQuery, setAgentQuery] = useState("");
  const [instructions, setInstructions] = useState("");
  const [syncing, setSyncing] = useState<"push" | "pull" | null>(null);
  const [evidenceView, setEvidenceView] = useState<FieldAssignment | null>(null);
  const [serveCandidates, setServeCandidates] = useState<ServeCandidate[]>([]);
  const [recordingService, setRecordingService] = useState(false);
  const recordService = useRecordService();

  const noticeById = useMemo(() => {
    const map = new Map<string, Notice>();
    (notices ?? []).forEach((n) => map.set(n.id, n));
    return map;
  }, [notices]);

  const tenantSourceById = useMemo(() => {
    const map = new Map<string, string | null>();
    (tenants ?? []).forEach((t) => map.set(t.id, t.externalSource ?? null));
    return map;
  }, [tenants]);

  const eligibleNotices = useMemo(
    () =>
      (notices ?? []).filter((n) =>
        ["finalized", "served", "reviewed", "needs_review"].includes(n.status),
      ),
    [notices],
  );

  // Known field agents: active team members plus anyone previously assigned.
  const agentOptions = useMemo(() => {
    const names = new Map<string, string>();
    (users ?? [])
      .filter((u) => u.active)
      .forEach((u) => {
        const name = u.name.trim();
        if (name) names.set(name.toLowerCase(), name);
      });
    (assignments ?? []).forEach((a) => {
      const name = a.assigneeName.trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    });
    return Array.from(names.values()).sort((a, b) => a.localeCompare(b));
  }, [users, assignments]);

  const syncEnabled = settings?.syncEnabled === true;
  const canManage = can ? can("field.manage") : true;
  const canRecordService = can ? can("notice.status") : true;

  const handleCreate = () => {
    if (!noticeId || !assigneeName.trim()) return;
    createAssignment.mutate(
      { noticeId, assigneeName: assigneeName.trim(), instructions },
      {
        onSuccess: () => {
          setCreateOpen(false);
          setNoticeId("");
          setAssigneeName("");
          setInstructions("");
          toast({ title: "Assignment created", description: "Push to field to send it to mobile agents." });
        },
        onError: (e: unknown) =>
          toast({ title: "Could not create assignment", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
      },
    );
  };

  const handlePush = async () => {
    if (!assignments?.length) {
      toast({ title: "Nothing to push", description: "Create a field assignment first." });
      return;
    }
    if (!licenseKey) {
      toast({ title: "Push failed", description: FIELD_SYNC_AUTH_REQUIRED_MESSAGE, variant: "destructive" });
      return;
    }
    setSyncing("push");
    try {
      const res = await fetch(SYNC_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...syncHeaders },
        body: JSON.stringify({
          assignments: assignments.map((a) => {
            const notice = noticeById.get(a.noticeId);
            const source = notice
              ? (tenantSourceById.get(notice.tenantId) ?? null)
              : null;
            return toPushPayload(a, notice, source);
          }),
        }),
      });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      const data = (await res.json()) as { pushed: number };
      toast({ title: "Pushed to field", description: `${data.pushed} assignment${data.pushed === 1 ? "" : "s"} synced to the mobile relay.` });
    } catch (e) {
      toast({ title: "Push failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSyncing(null);
    }
  };

  const handlePull = async () => {
    if (!licenseKey) {
      toast({ title: "Pull failed", description: FIELD_SYNC_AUTH_REQUIRED_MESSAGE, variant: "destructive" });
      return;
    }
    setSyncing("pull");
    try {
      const res = await fetch(SYNC_URL, { headers: syncHeaders });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      const remote = (await res.json()) as RemoteAssignment[];
      const local = assignments ?? [];
      let updated = 0;
      for (const r of remote) {
        const l = local.find((a) => a.id === r.id);
        if (!l) continue; // desktop is the source of assignments
        const localEvidenceIds = new Set(l.evidence.map((e) => e.id));
        const incoming = r.evidence.filter((e) => !localEvidenceIds.has(e.id));
        const newEvidence: FieldEvidence[] = [];
        for (const e of incoming) {
          newEvidence.push({
            id: e.id,
            // Downscale/recompress at ingest so oversized phone photos never
            // bloat the local database or the generated notice packet.
            photoDataUrl: await downscalePhotoDataUrl(e.photoDataUrl),
            latitude: e.latitude,
            longitude: e.longitude,
            accuracyMeters: e.accuracyMeters,
            capturedAt: e.capturedAt,
            note: e.note,
          });
        }
        const remoteNewer = r.updatedAt > l.updatedAt;
        if (!remoteNewer && newEvidence.length === 0) continue;
        await updateAssignment.mutateAsync({
          id: l.id,
          patch: {
            ...(remoteNewer
              ? {
                  status: r.status,
                  serviceMethod: r.serviceMethod,
                  completedAt: r.completedAt,
                }
              : {}),
            evidence: [...l.evidence, ...newEvidence],
            updatedAt: remoteNewer ? r.updatedAt : undefined,
          },
        });
        updated += 1;
      }
      qc.invalidateQueries();
      toast({
        title: "Pulled field updates",
        description: updated
          ? `${updated} assignment${updated === 1 ? "" : "s"} updated with field activity.`
          : "Everything is already up to date.",
      });
      if (canRecordService) {
        const candidates: ServeCandidate[] = [];
        for (const r of remote) {
          if (r.status !== "completed" || !r.completedAt) continue;
          const l = local.find((a) => a.id === r.id);
          if (!l) continue;
          const notice = noticeById.get(l.noticeId);
          if (!notice) continue;
          if (["served", "mailed"].includes(notice.status)) continue;
          if (notice.service.dateServed) continue;
          candidates.push({
            noticeId: notice.id,
            assignmentId: l.id,
            tenantNames: notice.tenantNames,
            propertyAddress: notice.propertyAddress,
            unit: notice.unit,
            completedAt: r.completedAt,
            serviceMethod: r.serviceMethod ?? l.serviceMethod,
            assigneeName: l.assigneeName,
          });
        }
        if (candidates.length > 0) setServeCandidates(candidates);
      }
    } catch (e) {
      toast({ title: "Pull failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setSyncing(null);
    }
  };

  const handleRecordServices = async () => {
    setRecordingService(true);
    let recorded = 0;
    let failed = 0;
    for (const c of serveCandidates) {
      const { date, time } = localDateParts(c.completedAt);
      if (!date) {
        failed += 1;
        continue;
      }
      try {
        await recordService.mutateAsync({
          id: c.noticeId,
          service: {
            dateServed: date,
            timeServed: time || null,
            method: c.serviceMethod,
            servedBy: c.assigneeName,
            serverNotes: "Recorded automatically from field sync",
            mailedDate: null,
          },
          source: "field_sync",
        });
        recorded += 1;
      } catch {
        failed += 1;
      }
    }
    setRecordingService(false);
    setServeCandidates([]);
    qc.invalidateQueries();
    if (recorded > 0) {
      toast({
        title: "Service recorded",
        description: `${recorded} notice${recorded === 1 ? "" : "s"} marked as served from field evidence. Deadlines are now counting.`,
      });
    }
    if (failed > 0) {
      toast({
        title: "Some notices could not be updated",
        description: `${failed} notice${failed === 1 ? "" : "s"} failed to record service. Record it manually from the notice page.`,
        variant: "destructive",
      });
    }
  };

  const handleCancel = (a: FieldAssignment) => {
    updateAssignment.mutate(
      { id: a.id, patch: { status: "cancelled" } },
      { onSuccess: () => toast({ title: "Assignment cancelled" }) },
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Field Assignments</h1>
          <p className="text-muted-foreground mt-1">
            Dispatch notices to process servers and collect on-site service evidence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={handlePull}
            disabled={!syncEnabled || syncing !== null}
            data-testid="button-pull-field"
          >
            {syncing === "pull" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <DownloadCloud className="w-4 h-4 mr-2" />}
            Pull updates
          </Button>
          <Button
            variant="outline"
            onClick={handlePush}
            disabled={!syncEnabled || syncing !== null}
            data-testid="button-push-field"
          >
            {syncing === "push" ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
            Push to field
          </Button>
          {canManage && (
            <Button onClick={() => setCreateOpen(true)} data-testid="button-new-assignment">
              <Plus className="w-4 h-4 mr-2" />
              New Assignment
            </Button>
          )}
        </div>
      </div>

      {!syncEnabled && (
        <Card className="border-dashed">
          <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <Smartphone className="w-5 h-5 text-muted-foreground" />
              <div>
                <div className="font-medium">Mobile sync is off</div>
                <div className="text-sm text-muted-foreground">
                  Enable field sync in Settings to push assignments to the RentNotice Field mobile app and pull back service evidence.
                </div>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setLocation("/settings")} data-testid="button-goto-settings">
              Open Settings
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="text-muted-foreground py-12 text-center">Loading assignments…</div>
      ) : !assignments?.length ? (
        <Card>
          <CardContent className="py-16 text-center space-y-3">
            <MapPin className="w-10 h-10 mx-auto text-muted-foreground" />
            <div className="font-medium text-lg">No field assignments yet</div>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Create an assignment from a finalized notice, then push it to your process servers' mobile devices.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {assignments.map((a) => {
            const notice = noticeById.get(a.noticeId);
            return (
              <Card key={a.id} data-testid={`card-assignment-${a.id}`}>
                <CardContent className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${STATUS_VARIANT[a.status]}`}>
                          {STATUS_LABELS[a.status]}
                        </span>
                        <span className="font-medium">
                          {notice ? notice.tenantNames.join(", ") : "Unknown notice"}
                        </span>
                        {notice && (
                          <Badge variant="outline">{NOTICE_TYPE_LABELS[notice.noticeType]}</Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {notice ? `${notice.propertyAddress}${notice.unit ? `, Unit ${notice.unit}` : ""}` : a.noticeId}
                      </div>
                      <div className="text-sm">
                        <span className="text-muted-foreground">Server:</span> {a.assigneeName}
                        {a.serviceMethod && (
                          <span className="ml-3 text-muted-foreground">
                            Method: <span className="text-foreground">{METHOD_LABELS[a.serviceMethod] ?? a.serviceMethod}</span>
                          </span>
                        )}
                        {a.completedAt && (
                          <span className="ml-3 text-muted-foreground">
                            Completed: <span className="text-foreground">{new Date(a.completedAt).toLocaleString()}</span>
                          </span>
                        )}
                      </div>
                      {a.instructions && (
                        <div className="text-sm text-muted-foreground italic">"{a.instructions}"</div>
                      )}
                      {notice?.totalAmountCents ? (
                        <div className="text-sm text-muted-foreground">
                          Amount demanded: <span className="text-foreground font-medium">{formatCents(notice.totalAmountCents)}</span>
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEvidenceView(a)}
                        disabled={a.evidence.length === 0}
                        data-testid={`button-evidence-${a.id}`}
                      >
                        <Camera className="w-4 h-4 mr-2" />
                        Evidence ({a.evidence.length})
                      </Button>
                      {canManage && a.status !== "completed" && a.status !== "cancelled" && (
                        <Button variant="ghost" size="sm" onClick={() => handleCancel(a)} data-testid={`button-cancel-${a.id}`}>
                          <Ban className="w-4 h-4 mr-2" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Field Assignment</DialogTitle>
            <DialogDescription>
              Assign a notice to a process server. Push to field afterwards so it appears on their mobile app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Notice</label>
              <Select value={noticeId} onValueChange={setNoticeId}>
                <SelectTrigger data-testid="select-notice">
                  <SelectValue placeholder="Select a notice to serve" />
                </SelectTrigger>
                <SelectContent className="max-w-[min(var(--radix-select-content-available-width),28rem)]">
                  {eligibleNotices.map((n) => (
                    <SelectItem
                      key={n.id}
                      value={n.id}
                      className="[&>span:last-child]:block [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
                    >
                      {n.tenantNames.join(", ")} — {NOTICE_TYPE_LABELS[n.noticeType]} ({n.propertyAddress})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {eligibleNotices.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No eligible notices. Notices must be reviewed or finalized before field service.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Field agent</label>
              <Popover
                open={agentPickerOpen}
                onOpenChange={(open) => {
                  setAgentPickerOpen(open);
                  if (!open) setAgentQuery("");
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={agentPickerOpen}
                    className="w-full justify-between font-normal"
                    data-testid="input-assignee"
                  >
                    <span className={cn("truncate", !assigneeName && "text-muted-foreground")}>
                      {assigneeName || "Search or add a field agent…"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command>
                    <CommandInput
                      placeholder="Type a name to search or add…"
                      value={agentQuery}
                      onValueChange={setAgentQuery}
                      data-testid="input-assignee-search"
                    />
                    <CommandList>
                      <CommandEmpty>Type a name to add a new agent.</CommandEmpty>
                      {agentOptions.length > 0 && (
                        <CommandGroup heading="Known agents">
                          {agentOptions.map((name) => (
                            <CommandItem
                              key={name}
                              value={name}
                              onSelect={() => {
                                setAssigneeName(name);
                                setAgentPickerOpen(false);
                                setAgentQuery("");
                              }}
                              data-testid={`option-agent-${name.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              <Check
                                className={cn(
                                  "mr-2 h-4 w-4 shrink-0",
                                  assigneeName === name ? "opacity-100" : "opacity-0",
                                )}
                              />
                              <span className="truncate">{name}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      )}
                      {agentQuery.trim().length > 0 &&
                        !agentOptions.some(
                          (n) => n.toLowerCase() === agentQuery.trim().toLowerCase(),
                        ) && (
                          <CommandGroup heading="New agent">
                            <CommandItem
                              value={agentQuery}
                              onSelect={() => {
                                setAssigneeName(agentQuery.trim());
                                setAgentPickerOpen(false);
                                setAgentQuery("");
                              }}
                              data-testid="option-agent-custom"
                            >
                              <UserPlus className="mr-2 h-4 w-4 shrink-0" />
                              <span className="truncate">Use "{agentQuery.trim()}"</span>
                            </CommandItem>
                          </CommandGroup>
                        )}
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Instructions (optional)</label>
              <Textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Gate code, best time of day, safety notes…"
                data-testid="input-instructions"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!noticeId || !assigneeName.trim() || createAssignment.isPending}
              data-testid="button-create-assignment"
            >
              {createAssignment.isPending ? "Creating…" : "Create Assignment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={serveCandidates.length > 0}
        onOpenChange={(open) => {
          if (!open && !recordingService) setServeCandidates([]);
        }}
      >
        <DialogContent className="max-w-lg" data-testid="dialog-record-service">
          <DialogHeader>
            <DialogTitle>Record service from field?</DialogTitle>
            <DialogDescription>
              {serveCandidates.length === 1
                ? "A field agent completed this assignment. Record service on the notice so the compliance deadline starts counting."
                : `Field agents completed ${serveCandidates.length} assignments. Record service on these notices so compliance deadlines start counting.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 max-h-[50vh] overflow-y-auto py-2">
            {serveCandidates.map((c) => (
              <div key={c.assignmentId} className="border rounded-lg p-3 text-sm space-y-1" data-testid={`serve-candidate-${c.assignmentId}`}>
                <div className="font-medium">{c.tenantNames.join(", ")}</div>
                <div className="text-muted-foreground">
                  {c.propertyAddress}
                  {c.unit ? `, Unit ${c.unit}` : ""}
                </div>
                <div className="text-muted-foreground">
                  Served {new Date(c.completedAt).toLocaleString()} by{" "}
                  <span className="text-foreground">{c.assigneeName}</span>
                  {c.serviceMethod && (
                    <>
                      {" "}via <span className="text-foreground">{METHOD_LABELS[c.serviceMethod] ?? c.serviceMethod}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setServeCandidates([])}
              disabled={recordingService}
              data-testid="button-skip-record-service"
            >
              Not now
            </Button>
            <Button
              onClick={handleRecordServices}
              disabled={recordingService}
              data-testid="button-confirm-record-service"
            >
              {recordingService && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={evidenceView !== null} onOpenChange={(open) => !open && setEvidenceView(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Service Evidence</DialogTitle>
            <DialogDescription>
              Photos captured on-site by {evidenceView?.assigneeName}. GPS coordinates and timestamps are recorded at capture.
            </DialogDescription>
          </DialogHeader>
          {evidenceView && (
            <FieldEvidenceGallery
              evidence={evidenceView.evidence}
              className="max-h-[60vh] overflow-y-auto py-2"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
