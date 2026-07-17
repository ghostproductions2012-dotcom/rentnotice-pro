import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import {
  useApproveNotice,
  useChangeNoticeStatus,
  useFinalizeNotice,
  useFieldAssignments,
  useGenerateDocuments,
  useNotice,
  useNoticeDocuments,
  useRecordService,
  useReviseNotice,
  usePermissions,
  useUpdateNotice,
  useValidation,
} from "@/lib/api/hooks";
import {
  DOCUMENT_KIND_LABELS,
  NOTICE_STATUS_LABELS,
  ELECTRONIC_SERVICE_METHODS,
  NOTICE_TYPE_LABELS,
  SERVICE_METHOD_LABELS,
  formatCents,
  type FieldAssignmentStatus,
  type ServiceMethod,
} from "@/lib/types";
import { PREREQUISITE_LABELS, getRulePack } from "@/lib/engine/rulepacks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldEvidenceGallery } from "@/components/field-evidence-gallery";
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
  BadgeCheck,
  Camera,
  CheckCircle,
  Download,
  Eye,
  FileText,
  Loader2,
  Lock,
  Scale,
  Send,
  Stamp,
  Truck,
} from "lucide-react";


function isElectronicMethod(method: ServiceMethod): boolean {
  return (ELECTRONIC_SERVICE_METHODS as readonly ServiceMethod[]).includes(method);
}

/** Map an app ServiceMethod onto the rule-pack service vocabulary. */
function toPackMethod(method: ServiceMethod): string {
  if (method === "substitute") return "substituted_and_mail";
  if (method === "post_and_mail") return "posting_and_mail";
  return method;
}

/** Service methods offered for a jurisdiction (verified allow list + Other). */
function allowedServiceMethods(jurisdiction: string): ServiceMethod[] {
  const all = Object.keys(SERVICE_METHOD_LABELS) as ServiceMethod[];
  const pack = getRulePack(jurisdiction);
  if (!pack || !pack.service.verified) return all;
  return all.filter(
    (m) => m === "other" || pack.service.allowedMethods.includes(toPackMethod(m) as never),
  );
}

const FIELD_STATUS_LABELS: Record<FieldAssignmentStatus, string> = {
  assigned: "Assigned",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

export default function NoticeView() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: notice, isLoading } = useNotice(id);
  const { data: validation } = useValidation(id);
  const { data: documents } = useNoticeDocuments(id);
  const { data: fieldAssignments } = useFieldAssignments(id);

  const changeStatus = useChangeNoticeStatus();
  const approve = useApproveNotice();
  const finalize = useFinalizeNotice();
  const revise = useReviseNotice();
  const recordService = useRecordService();
  const generateDocs = useGenerateDocuments();
  const updateNotice = useUpdateNotice();
  const { can } = usePermissions();

  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [warningReasons, setWarningReasons] = useState<Record<string, string>>({});
  const [attested, setAttested] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseReason, setReviseReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [serviceOpen, setServiceOpen] = useState(false);
  const [svc, setSvc] = useState({
    dateServed: "",
    timeServed: "",
    method: "personal" as ServiceMethod,
    servedBy: "",
    serverNotes: "",
    mailedDate: "",
    electronicConsent: false,
  });

  const warnings = useMemo(
    () => (validation?.issues ?? []).filter((i) => i.level === "warning"),
    [validation],
  );

  if (isLoading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-muted w-1/3 rounded" />
        <div className="h-64 bg-muted rounded" />
      </div>
    );
  if (!notice) return <div>Notice not found</div>;

  const demandsMoney = notice.totalAmountCents > 0 || notice.months.length > 0;
  const allWarningsAcked = warnings.every((w) => (warningReasons[w.code] ?? "").trim().length > 0);
  const canFinalize =
    (validation?.passed ?? false) && allWarningsAcked && (!demandsMoney || attested);

  const fail = (title: string) => (e: unknown) =>
    toast({
      title,
      description: e instanceof Error ? e.message : "Unknown error.",
      variant: "destructive",
    });

  const doPreviewDraft = () =>
    generateDocs.mutate(
      { noticeId: notice.id, packetKind: "draft" },
      {
        onSuccess: (docs) => {
          const packet = docs.find((d) => d.kind === "packet") ?? docs[0];
          if (packet) window.open(packet.blobUrl, "_blank");
          toast({ title: "Draft preview generated", description: "Watermarked draft packet opened in a new tab." });
        },
        onError: fail("Could not generate draft"),
      },
    );

  const doFinalize = () =>
    finalize.mutate(
      {
        id: notice.id,
        acknowledgedWarnings: warnings.map((w) => ({
          code: w.code,
          reason: (warningReasons[w.code] ?? "").trim(),
        })),
        attestation: { rentOnlyConfirmed: attested },
      },
      {
        onSuccess: () => {
          setFinalizeOpen(false);
          generateDocs.mutate(
            { noticeId: notice.id, packetKind: "final" },
            {
              onSuccess: () =>
                toast({
                  title: "Notice finalized",
                  description: "The final service packet has been generated and locked.",
                }),
              onError: fail("Finalized, but document generation failed"),
            },
          );
        },
        onError: fail("Could not finalize"),
      },
    );

  const doRevise = () =>
    revise.mutate(
      { id: notice.id, reason: reviseReason.trim() },
      {
        onSuccess: (copy) => {
          setReviseOpen(false);
          setReviseReason("");
          toast({ title: "Revision created", description: `Draft v${copy.version} is ready for edits.` });
          navigate(`/notices/${copy.id}`);
        },
        onError: fail("Could not create revision"),
      },
    );

  const doRecordService = () =>
    recordService.mutate(
      {
        id: notice.id,
        electronicConsent: isElectronicMethod(svc.method) ? svc.electronicConsent : undefined,
        service: {
          dateServed: svc.dateServed || null,
          timeServed: svc.timeServed || null,
          method: svc.method,
          servedBy: svc.servedBy.trim(),
          serverNotes: svc.serverNotes.trim(),
          mailedDate: svc.method === "post_and_mail" ? svc.mailedDate || null : null,
        },
      },
      {
        onSuccess: (n) => {
          setServiceOpen(false);
          toast({
            title: "Service recorded",
            description: n.deadlineDate
              ? `Compliance deadline computed: ${n.deadlineDate}.`
              : "Service details saved.",
          });
        },
        onError: fail("Could not record service"),
      },
    );

  const statusAction = (
    toStatus: Parameters<typeof changeStatus.mutate>[0]["toStatus"],
    successTitle: string,
    reason?: string,
  ) =>
    changeStatus.mutate(
      { id: notice.id, toStatus, reason },
      { onSuccess: () => toast({ title: successTitle }), onError: fail("Status change failed") },
    );

  const busy =
    changeStatus.isPending ||
    approve.isPending ||
    finalize.isPending ||
    revise.isPending ||
    recordService.isPending ||
    generateDocs.isPending;

  const cancellable = ["draft", "needs_review", "reviewed"].includes(notice.status);
  const revisable = ["finalized", "served", "mailed", "expired"].includes(notice.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/notices">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-serif font-bold tracking-tight">Notice Workroom</h1>
            <span
              className="px-3 py-1 bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider rounded-md"
              data-testid="text-status"
            >
              {NOTICE_STATUS_LABELS[notice.status]}
            </span>
            {notice.version > 1 && (
              <span className="px-2 py-1 bg-muted text-xs font-medium rounded-md">
                v{notice.version}
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-1">
            {notice.tenantNames.join(" & ")} • {notice.propertyAddress}
            {notice.unit ? `, Unit ${notice.unit}` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <Card>
            <CardHeader className="border-b pb-4">
              <CardTitle>Notice Details</CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Type</dt>
                  <dd className="mt-1">{NOTICE_TYPE_LABELS[notice.noticeType]}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Jurisdiction</dt>
                  <dd className="mt-1">{notice.jurisdiction}</dd>
                </div>
                {demandsMoney && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Total Demanded</dt>
                    <dd className="mt-1 font-serif text-xl font-bold" data-testid="text-total">
                      {formatCents(notice.totalAmountCents)}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm font-medium text-muted-foreground">Prepared On</dt>
                  <dd className="mt-1">{new Date(notice.createdAt).toLocaleDateString()}</dd>
                </div>
                {notice.deadlineDate && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Compliance Deadline</dt>
                    <dd className="mt-1 font-medium">{notice.deadlineDate}</dd>
                  </div>
                )}
                {notice.finalizedAt && (
                  <div>
                    <dt className="text-sm font-medium text-muted-foreground">Finalized</dt>
                    <dd className="mt-1">{new Date(notice.finalizedAt).toLocaleString()}</dd>
                  </div>
                )}
                {notice.rentOnlyAttestedAt && (
                  <div className="col-span-2">
                    <dt className="text-sm font-medium text-muted-foreground">Rent-Only Attestation</dt>
                    <dd className="mt-1 flex items-center gap-2 text-sm">
                      <BadgeCheck className="w-4 h-4 text-primary" />
                      Preparer certified the demand contains scheduled rent only —{" "}
                      {new Date(notice.rentOnlyAttestedAt).toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          {notice.months.length > 0 && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle>Demand Breakdown</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Month</TableHead>
                      <TableHead className="text-right">Rent charged</TableHead>
                      <TableHead className="text-right">Payments</TableHead>
                      <TableHead className="text-right">Credits</TableHead>
                      <TableHead className="text-right">Demanded</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {notice.months.map((m) => (
                      <TableRow key={m.month}>
                        <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                        <TableCell className="text-right">{formatCents(m.rentChargedCents)}</TableCell>
                        <TableCell className="text-right">{formatCents(m.paymentsAppliedCents)}</TableCell>
                        <TableCell className="text-right">{formatCents(m.creditsAppliedCents)}</TableCell>
                        <TableCell className="text-right font-serif font-bold">
                          {formatCents(m.selectedAmountCents)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {(() => {
            const pack = getRulePack(notice.jurisdiction);
            if (!pack || notice.noticeType !== "pay_or_quit_3day") return null;
            const prereqs = pack.nonpayment.prerequisites;
            const showPrereqs = prereqs.length > 0;
            const showRuleCards = pack.leaseSensitive && pack.ruleCards.length > 0;
            if (!showPrereqs && !showRuleCards) return null;
            const editable = notice.status === "draft" || notice.status === "needs_review" || notice.status === "reviewed";
            return (
              <Card data-testid="card-state-requirements">
                <CardHeader className="border-b pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Scale className="w-5 h-5 text-primary" />
                    {pack.stateName} State Requirements
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-6 space-y-6">
                  {showPrereqs && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Pre-filing prerequisites</p>
                      {prereqs.map((p) => (
                        <div key={p} className="flex items-start gap-3">
                          <Checkbox
                            id={`prereq-${p}`}
                            checked={notice.prereqCompleted[p] === true}
                            disabled={!editable || updateNotice.isPending}
                            onCheckedChange={(v) =>
                              updateNotice.mutate(
                                {
                                  id: notice.id,
                                  patch: {
                                    prereqCompleted: {
                                      ...notice.prereqCompleted,
                                      [p]: v === true,
                                    },
                                  },
                                },
                                { onError: fail("Could not update prerequisite") },
                              )
                            }
                            data-testid={`checkbox-prereq-${p}`}
                          />
                          <Label
                            htmlFor={`prereq-${p}`}
                            className="text-sm font-normal leading-snug"
                          >
                            {PREREQUISITE_LABELS[p]}
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                  {showRuleCards && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Rule card</p>
                      <p className="text-xs text-muted-foreground">
                        {pack.stateName} has no single statewide nonpayment period — pick the
                        rule card that matches this tenancy, then verify the lease/statute with
                        counsel.
                      </p>
                      <Select
                        value={notice.ruleCardKey ?? ""}
                        disabled={!editable || updateNotice.isPending}
                        onValueChange={(v) =>
                          updateNotice.mutate(
                            { id: notice.id, patch: { ruleCardKey: v || null } },
                            { onError: fail("Could not set rule card") },
                          )
                        }
                      >
                        <SelectTrigger data-testid="select-rule-card">
                          <SelectValue placeholder="Select the applicable rule card" />
                        </SelectTrigger>
                        <SelectContent>
                          {pack.ruleCards.map((rc) => (
                            <SelectItem key={rc.key} value={rc.key}>
                              {rc.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {notice.ruleCardKey && (
                        <p className="text-xs text-muted-foreground">
                          {pack.ruleCards.find((rc) => rc.key === notice.ruleCardKey)?.description}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {validation && (
            <Card className={validation.passed ? "border-primary/20" : "border-destructive/30"}>
              <CardHeader className={`pb-4 ${validation.passed ? "bg-primary/5" : "bg-destructive/5"}`}>
                <CardTitle className="flex items-center gap-2">
                  {validation.passed ? (
                    <CheckCircle className="w-5 h-5 text-primary" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-destructive" />
                  )}
                  Compliance Validation
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {validation.issues.length === 0 ? (
                  <p className="text-muted-foreground">All compliance checks passed.</p>
                ) : (
                  <ul className="space-y-3">
                    {validation.issues.map((issue, idx) => (
                      <li key={idx} className="flex gap-3 text-sm">
                        <AlertTriangle
                          className={`w-4 h-4 shrink-0 ${issue.level === "blocker" ? "text-destructive" : "text-accent"}`}
                        />
                        <div>
                          <span className="font-medium">
                            {issue.level === "blocker" ? "Blocker: " : "Warning: "}
                          </span>
                          {issue.message}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {notice.service.dateServed && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Truck className="w-5 h-5 text-primary" />
                  Service of Notice
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <dt className="font-medium text-muted-foreground">Method</dt>
                    <dd className="mt-1">
                      {notice.service.method ? SERVICE_METHOD_LABELS[notice.service.method] : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Served on</dt>
                    <dd className="mt-1">
                      {notice.service.dateServed}
                      {notice.service.timeServed ? ` at ${notice.service.timeServed}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-medium text-muted-foreground">Served by</dt>
                    <dd className="mt-1">{notice.service.servedBy || "—"}</dd>
                  </div>
                  {notice.service.mailedDate && (
                    <div>
                      <dt className="font-medium text-muted-foreground">Mailed on</dt>
                      <dd className="mt-1">{notice.service.mailedDate}</dd>
                    </div>
                  )}
                  {notice.service.serverNotes && (
                    <div className="col-span-2">
                      <dt className="font-medium text-muted-foreground">Notes</dt>
                      <dd className="mt-1">{notice.service.serverNotes}</dd>
                    </div>
                  )}
                </dl>
              </CardContent>
            </Card>
          )}

          {(fieldAssignments?.length ?? 0) > 0 && (
            <Card>
              <CardHeader className="border-b pb-4">
                <CardTitle className="flex items-center gap-2">
                  <Camera className="w-5 h-5 text-primary" />
                  Field Service Evidence
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-6">
                {fieldAssignments?.map((a) => (
                  <div key={a.id} className="space-y-3" data-testid={`field-assignment-${a.id}`}>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">{a.assigneeName || "Unnamed server"}</span>
                      <span className="px-2 py-0.5 bg-muted text-xs font-medium rounded-md">
                        {FIELD_STATUS_LABELS[a.status]}
                      </span>
                      {a.serviceMethod && (
                        <span className="text-muted-foreground">
                          {SERVICE_METHOD_LABELS[a.serviceMethod]}
                        </span>
                      )}
                      {a.completedAt && (
                        <span className="text-muted-foreground">
                          Completed {new Date(a.completedAt).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {a.evidence.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No evidence captured yet for this assignment.
                      </p>
                    ) : (
                      <FieldEvidenceGallery evidence={a.evidence} />
                    )}
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  Evidence photos are added to generated packets as a Service Evidence Exhibit with
                  capture time, GPS coordinates, server name, and method.
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Workflow Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notice.status === "draft" && (
                <Button
                  className="w-full"
                  disabled={busy || !can("notice.status")}
                  onClick={() => statusAction("needs_review", "Submitted for review")}
                  data-testid="button-submit-review"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Submit for Review
                </Button>
              )}
              {notice.status === "needs_review" && (
                <>
                  <Button
                    className="w-full"
                    disabled={busy || !can("notice.approve")}
                    onClick={() =>
                      approve.mutate(notice.id, {
                        onSuccess: () => toast({ title: "Notice approved" }),
                        onError: fail("Approval failed"),
                      })
                    }
                    data-testid="button-approve"
                  >
                    <Stamp className="w-4 h-4 mr-2" />
                    Approve Notice
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={busy || !can("notice.status")}
                    onClick={() => setReviseOpen(true)}
                    data-testid="button-request-revision"
                  >
                    Request Revision
                  </Button>
                </>
              )}
              {notice.status === "reviewed" && (
                <Button
                  className="w-full"
                  disabled={busy || !can("notice.finalize")}
                  onClick={() => {
                    setWarningReasons({});
                    setAttested(false);
                    setFinalizeOpen(true);
                  }}
                  data-testid="button-finalize"
                >
                  <Lock className="w-4 h-4 mr-2" />
                  Finalize &amp; Generate
                </Button>
              )}
              {notice.status === "finalized" && (
                <Button
                  className="w-full"
                  disabled={busy || !can("notice.status")}
                  onClick={() => setServiceOpen(true)}
                  data-testid="button-record-service"
                >
                  <Truck className="w-4 h-4 mr-2" />
                  Record Service
                </Button>
              )}
              {(notice.status === "served" || notice.status === "mailed") && (
                <>
                  <Button
                    className="w-full"
                    disabled={busy || !can("notice.status")}
                    onClick={() => statusAction("paid", "Marked as paid")}
                    data-testid="button-mark-paid"
                  >
                    <BadgeCheck className="w-4 h-4 mr-2" />
                    Mark as Paid
                  </Button>
                  <Button
                    className="w-full"
                    variant="outline"
                    disabled={busy || !can("notice.status")}
                    onClick={() => statusAction("sent_to_attorney", "Flagged for attorney")}
                    data-testid="button-send-attorney"
                  >
                    Send to Attorney
                  </Button>
                </>
              )}
              {revisable && (
                <Button
                  className="w-full"
                  variant="outline"
                  disabled={busy || !can("notice.status")}
                  onClick={() => setReviseOpen(true)}
                  data-testid="button-revise"
                >
                  Create Revision
                </Button>
              )}
              {cancellable && (
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={busy || !can("notice.status")}
                  onClick={() => setCancelOpen(true)}
                  data-testid="button-cancel-notice"
                >
                  Cancel Notice
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start"
                disabled={generateDocs.isPending || !can("notice.generate")}
                onClick={doPreviewDraft}
                data-testid="button-preview-draft"
              >
                {generateDocs.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Eye className="w-4 h-4 mr-2 text-primary" />
                )}
                Preview Draft (watermarked)
              </Button>
              {(documents?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No documents generated yet. Finalizing produces the locked service packet.
                </p>
              ) : (
                <div className="space-y-1.5 pt-1">
                  {documents?.map((d) => (
                    <a
                      key={d.id}
                      href={d.blobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-2 text-sm p-2 rounded-md hover:bg-muted/40 transition-colors"
                      data-testid={`link-document-${d.id}`}
                    >
                      {d.kind === "packet" ? (
                        <Download className="w-4 h-4 text-primary shrink-0" />
                      ) : (
                        <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      )}
                      <span className="flex-1 truncate">
                        {d.kind === "packet"
                          ? `${d.packetKind === "draft" ? "Draft" : "Final"} packet`
                          : DOCUMENT_KIND_LABELS[d.kind]}
                        {d.watermarked ? " (draft)" : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">{d.pageCount}p</span>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Finalize dialog: warning acknowledgements + rent-only attestation */}
      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" />
              Finalize Notice
            </DialogTitle>
            <DialogDescription>
              Finalizing locks the notice and generates the final service packet. This cannot be
              undone — later changes require a revision.
            </DialogDescription>
          </DialogHeader>

          {!validation?.passed && (
            <p className="text-sm text-destructive flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {validation?.blockers ?? 0} blocking issue(s) must be resolved before finalizing.
            </p>
          )}

          {warnings.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium">
                Acknowledge each warning with a reason to continue:
              </p>
              {warnings.map((w) => (
                <div key={w.code} className="space-y-1.5 rounded-lg border p-3">
                  <p className="text-sm flex gap-2">
                    <AlertTriangle className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                    {w.message}
                  </p>
                  <Input
                    placeholder="Reason for proceeding despite this warning…"
                    value={warningReasons[w.code] ?? ""}
                    onChange={(e) =>
                      setWarningReasons((r) => ({ ...r, [w.code]: e.target.value }))
                    }
                    data-testid={`input-ack-${w.code}`}
                  />
                </div>
              ))}
            </div>
          )}

          {demandsMoney && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
              <Checkbox
                id="attest"
                checked={attested}
                onCheckedChange={(c) => setAttested(c === true)}
                className="mt-0.5"
                data-testid="checkbox-attestation"
              />
              <Label htmlFor="attest" className="font-normal text-sm leading-snug">
                I certify that the amounts demanded in this notice consist of scheduled rent only
                and include no late fees, utilities, deposits, or other non-rent charges.
              </Label>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!canFinalize || finalize.isPending || generateDocs.isPending}
              onClick={doFinalize}
              data-testid="button-confirm-finalize"
            >
              {(finalize.isPending || generateDocs.isPending) && (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              )}
              Finalize &amp; Generate Packet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revision dialog */}
      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Revision</DialogTitle>
            <DialogDescription>
              This marks the current version as revised and creates a fresh editable draft (v
              {notice.version + 1}). A reason is required for the audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reviseReason}
            onChange={(e) => setReviseReason(e.target.value)}
            placeholder="What needs to change and why…"
            data-testid="input-revise-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={reviseReason.trim().length === 0 || revise.isPending}
              onClick={doRevise}
              data-testid="button-confirm-revise"
            >
              {revise.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Revision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel dialog */}
      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Cancel Notice</DialogTitle>
            <DialogDescription>
              Cancelling removes this notice from the active pipeline. A reason is required for the
              audit log.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Reason for cancellation…"
            data-testid="input-cancel-reason"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Keep Notice
            </Button>
            <Button
              variant="destructive"
              disabled={cancelReason.trim().length === 0 || changeStatus.isPending}
              onClick={() => {
                setCancelOpen(false);
                statusAction("cancelled", "Notice cancelled", cancelReason.trim());
                setCancelReason("");
              }}
              data-testid="button-confirm-cancel"
            >
              Cancel Notice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record service dialog */}
      <Dialog open={serviceOpen} onOpenChange={setServiceOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="w-5 h-5 text-primary" />
              Record Service
            </DialogTitle>
            <DialogDescription>
              Recording service computes the legal compliance deadline (court days, weekends, and
              holidays accounted for).
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Service method *</Label>
              <Select
                value={svc.method}
                onValueChange={(v) => setSvc((s) => ({ ...s, method: v as ServiceMethod }))}
              >
                <SelectTrigger data-testid="select-service-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedServiceMethods(notice.jurisdiction).map((m) => (
                    <SelectItem key={m} value={m}>
                      {SERVICE_METHOD_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Served by *</Label>
              <Input
                value={svc.servedBy}
                onChange={(e) => setSvc((s) => ({ ...s, servedBy: e.target.value }))}
                placeholder="Name of server"
                data-testid="input-served-by"
              />
            </div>
            <div className="space-y-2">
              <Label>Date served *</Label>
              <Input
                type="date"
                value={svc.dateServed}
                onChange={(e) => setSvc((s) => ({ ...s, dateServed: e.target.value }))}
                data-testid="input-date-served"
              />
            </div>
            <div className="space-y-2">
              <Label>Time served</Label>
              <Input
                type="time"
                value={svc.timeServed}
                onChange={(e) => setSvc((s) => ({ ...s, timeServed: e.target.value }))}
                data-testid="input-time-served"
              />
            </div>
            {svc.method === "post_and_mail" && (
              <div className="space-y-2">
                <Label>Mailed date *</Label>
                <Input
                  type="date"
                  value={svc.mailedDate}
                  onChange={(e) => setSvc((s) => ({ ...s, mailedDate: e.target.value }))}
                  data-testid="input-mailed-date"
                />
              </div>
            )}
            {isElectronicMethod(svc.method) && (
              <div className="col-span-2 flex items-start gap-3 rounded-md border border-accent/50 bg-accent/10 p-3">
                <Checkbox
                  id="electronic-consent"
                  checked={svc.electronicConsent}
                  onCheckedChange={(v) =>
                    setSvc((s) => ({ ...s, electronicConsent: v === true }))
                  }
                  data-testid="checkbox-electronic-consent"
                />
                <Label htmlFor="electronic-consent" className="text-sm font-normal leading-snug">
                  The tenant agreed (in the lease or in writing) to receive notices
                  electronically by this method. Keep a copy of that agreement — electronic
                  service is only valid where the tenant consented.
                </Label>
              </div>
            )}
            <div className="space-y-2 col-span-2">
              <Label>Server notes</Label>
              <Textarea
                value={svc.serverNotes}
                onChange={(e) => setSvc((s) => ({ ...s, serverNotes: e.target.value }))}
                placeholder="e.g. Posted on front door at 10:15 AM, photo taken…"
                data-testid="input-server-notes"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setServiceOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={
                !svc.dateServed ||
                svc.servedBy.trim().length === 0 ||
                (svc.method === "post_and_mail" && !svc.mailedDate) ||
                (isElectronicMethod(svc.method) && !svc.electronicConsent) ||
                recordService.isPending
              }
              onClick={doRecordService}
              data-testid="button-confirm-service"
            >
              {recordService.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Record Service
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
