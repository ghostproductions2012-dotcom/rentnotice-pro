// ---------------------------------------------------------------------------
// State rules reference — a read-only browser over the 50-state (+ DC) rule
// packs. Pure static data from the engine; no per-notice state.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { todayIsoDate } from "@/lib/utils";
import {
  ALL_RULE_PACKS,
  PERIOD_UNIT_LABELS,
  PREREQUISITE_LABELS,
  PROOF_FIELD_LABELS,
  VERIFICATION_STATUS_LABELS,
  type StateRulePack,
} from "@/lib/engine/rulepacks";
import {
  useClearStateRuleReview,
  usePermissions,
  useSetStateRuleReview,
  useStateRuleReviews,
} from "@/lib/api/hooks";
import type { StateRuleReview } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { BadgeCheck, Scale } from "lucide-react";

const SERVICE_METHOD_TEXT: Record<string, string> = {
  personal: "Personal delivery",
  substituted_and_mail: "Substituted service + mail",
  posting_and_mail: "Posting + mail",
  leave_at_residence: "Leave at residence",
  certified_mail: "Certified mail",
  registered_mail: "Registered mail",
  first_class_mail: "First-class mail",
  email_if_agreed: "Email (if tenant agreed)",
  text_if_agreed: "Text message (if tenant agreed)",
  portal_if_agreed: "Online portal (if tenant agreed)",
  state_marshal: "State marshal",
  process_server: "Process server",
  sheriff: "Sheriff",
};

function periodText(pack: StateRulePack): string {
  const np = pack.nonpayment;
  if (np.periodLength == null || !np.periodUnit) {
    return "Not specified — attorney verification required";
  }
  return `${np.periodLength} ${PERIOD_UNIT_LABELS[np.periodUnit]}`;
}

function ApprovalDialog({
  pack,
  existing,
  open,
  onOpenChange,
}: {
  pack: StateRulePack;
  existing: StateRuleReview | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const setReview = useSetStateRuleReview();
  const [reviewerName, setReviewerName] = useState(existing?.reviewerName ?? "");
  const [reviewedAt, setReviewedAt] = useState(existing?.reviewedAt ?? todayIsoDate());
  const [notes, setNotes] = useState(existing?.notes ?? "");

  const save = () => {
    setReview.mutate(
      { state: pack.state, reviewerName, reviewedAt, notes },
      {
        onSuccess: () => {
          toast({
            title: "Attorney approval recorded",
            description: `${pack.stateName} marked attorney-approved (${reviewerName.trim()}, ${reviewedAt}).`,
          });
          onOpenChange(false);
        },
        onError: (e) =>
          toast({
            title: "Could not save approval",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="dialog-attorney-approval">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Update attorney approval" : "Mark attorney-approved"} — {pack.stateName} ({pack.state})
          </DialogTitle>
          <DialogDescription>
            Record that a licensed attorney in {pack.stateName} reviewed and approved this
            state's rule pack. The approval is stored locally and referenced by notice
            validation for this jurisdiction.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="approval-reviewer">Reviewing attorney</Label>
            <Input
              id="approval-reviewer"
              placeholder="e.g. Jane Doe, Esq."
              value={reviewerName}
              onChange={(e) => setReviewerName(e.target.value)}
              data-testid="input-approval-reviewer"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="approval-date">Review date</Label>
            <Input
              id="approval-date"
              type="date"
              max={todayIsoDate()}
              value={reviewedAt}
              onChange={(e) => setReviewedAt(e.target.value)}
              data-testid="input-approval-date"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="approval-notes">Notes (optional)</Label>
            <Textarea
              id="approval-notes"
              placeholder="Scope of the review, caveats, engagement reference…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              data-testid="input-approval-notes"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-approval-cancel">
            Cancel
          </Button>
          <Button
            onClick={save}
            disabled={!reviewerName.trim() || !reviewedAt || setReview.isPending}
            data-testid="button-approval-save"
          >
            {setReview.isPending ? "Saving…" : "Save approval"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function StateRulesPage() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string>("");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const { can } = usePermissions();
  const canManage = can("settings.manage");
  const { toast } = useToast();
  const { data: reviews } = useStateRuleReviews();
  const clearReview = useClearStateRuleReview();

  const reviewByState = useMemo(() => {
    const map = new Map<string, StateRuleReview>();
    for (const r of reviews ?? []) map.set(r.state, r);
    return map;
  }, [reviews]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ALL_RULE_PACKS;
    return ALL_RULE_PACKS.filter(
      (p) => p.stateName.toLowerCase().includes(q) || p.state.toLowerCase() === q,
    );
  }, [search]);

  const pack = useMemo(
    () => ALL_RULE_PACKS.find((p) => p.state === selected) ?? null,
    [selected],
  );
  const packReview = pack ? reviewByState.get(pack.state) ?? null : null;

  const removeApproval = (p: StateRulePack) => {
    clearReview.mutate(p.state, {
      onSuccess: () =>
        toast({
          title: "Approval removed",
          description: `The recorded attorney approval for ${p.stateName} was removed.`,
        }),
      onError: (e) =>
        toast({
          title: "Could not remove approval",
          description: e instanceof Error ? e.message : String(e),
          variant: "destructive",
        }),
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
          <Scale className="w-6 h-6 text-primary" />
          State Rules Reference
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Nonpayment notice rules for all 50 states and DC, as recorded in the app's rule
          packs (research dated {ALL_RULE_PACKS[0]?.versionDate}). Reference only — not
          legal advice. Verify with a licensed attorney in the property's state.
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <Input
          className="max-w-xs"
          placeholder="Search states…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-state-search"
        />
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger className="w-64" data-testid="select-state">
            <SelectValue placeholder="Jump to a state" />
          </SelectTrigger>
          <SelectContent>
            {ALL_RULE_PACKS.map((p) => (
              <SelectItem key={p.state} value={p.state}>
                {p.stateName} ({p.state})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {pack && approvalOpen && (
        <ApprovalDialog
          key={pack.state}
          pack={pack}
          existing={packReview}
          open={approvalOpen}
          onOpenChange={setApprovalOpen}
        />
      )}

      {pack && (
        <Card data-testid="card-state-detail">
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex flex-wrap items-center gap-2">
              {pack.stateName} ({pack.state})
              <Badge variant="secondary">
                {VERIFICATION_STATUS_LABELS[pack.verificationStatus]}
              </Badge>
              {packReview && (
                <Badge
                  variant="outline"
                  className="border-green-600/40 text-green-700 dark:text-green-400"
                  data-testid="badge-attorney-approved"
                >
                  <BadgeCheck className="w-3.5 h-3.5 mr-1" />
                  Attorney-approved
                </Badge>
              )}
              {pack.leaseSensitive && <Badge variant="outline">Lease-sensitive</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4 text-sm">
            <div
              className="rounded-md border p-4 space-y-2"
              data-testid="section-attorney-approval"
            >
              <p className="font-medium flex items-center gap-1.5">
                <BadgeCheck className="w-4 h-4 text-primary" />
                Attorney review
              </p>
              {packReview ? (
                <div className="text-muted-foreground space-y-1">
                  <p data-testid="text-approval-summary">
                    Reviewed and approved by <span className="font-medium text-foreground">{packReview.reviewerName}</span> on {packReview.reviewedAt}.
                    {packReview.recordedBy ? ` Recorded by ${packReview.recordedBy}.` : ""}
                  </p>
                  {packReview.notes && (
                    <p className="whitespace-pre-wrap" data-testid="text-approval-notes">
                      {packReview.notes}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground" data-testid="text-approval-none">
                  No attorney review is recorded for {pack.stateName}. Notices in this
                  jurisdiction will carry attorney-review warnings until an approval is
                  recorded here.
                </p>
              )}
              {canManage && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    size="sm"
                    variant={packReview ? "outline" : "default"}
                    onClick={() => setApprovalOpen(true)}
                    data-testid="button-mark-approved"
                  >
                    {packReview ? "Update approval" : "Mark attorney-approved"}
                  </Button>
                  {packReview && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => removeApproval(pack)}
                      disabled={clearReview.isPending}
                      data-testid="button-remove-approval"
                    >
                      Remove approval
                    </Button>
                  )}
                </div>
              )}
            </div>
            <div>
              <p className="font-medium">Nonpayment notice period</p>
              <p className="text-muted-foreground">
                {periodText(pack)} — {pack.nonpayment.summary}
              </p>
            </div>
            <div>
              <p className="font-medium">Counting</p>
              <ul className="list-disc pl-5 text-muted-foreground">
                <li>
                  Count starts {pack.dateCount.countStartsDayAfterService ? "the day after" : "on the day of"}{" "}
                  service.
                </li>
                <li>
                  {pack.dateCount.movesToNextOpenCourtDayIfDeadlineClosed
                    ? "Deadline rolls forward if it lands on a closed court day."
                    : "No roll-forward rule recorded."}
                </li>
                {pack.nonpayment.countingBasis.excludeWeekends && <li>Weekends excluded.</li>}
                {pack.nonpayment.countingBasis.excludeStateHolidays && (
                  <li>State holidays excluded.</li>
                )}
                {pack.nonpayment.countingBasis.excludeCourtHolidays && (
                  <li>Court holidays excluded.</li>
                )}
                {pack.nonpayment.countingBasis.mailExtensionDays > 0 && (
                  <li>
                    +{pack.nonpayment.countingBasis.mailExtensionDays} days when served by:{" "}
                    {pack.nonpayment.countingBasis.mailExtensionMethods
                      .map((m) => SERVICE_METHOD_TEXT[m] ?? m)
                      .join(", ")}
                    .
                  </li>
                )}
              </ul>
            </div>
            <div>
              <p className="font-medium">Rent-only enforcement</p>
              <p className="text-muted-foreground">
                {pack.nonpayment.rentOnlyEnforcement === "hard_block"
                  ? "Strict — a demand that includes non-rent charges is blocked from finalization."
                  : "Attestation — the rent-only default applies with preparer attestation."}
              </p>
            </div>
            {pack.nonpayment.prerequisites.length > 0 && (
              <div>
                <p className="font-medium">Pre-filing prerequisites</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {pack.nonpayment.prerequisites.map((p) => (
                    <li key={p}>{PREREQUISITE_LABELS[p]}</li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="font-medium">Allowed service methods</p>
              <p className="text-muted-foreground">
                {pack.service.verified && pack.service.allowedMethods.length > 0
                  ? pack.service.allowedMethods
                      .map((m) => SERVICE_METHOD_TEXT[m] ?? m)
                      .join(", ")
                  : "Not verified — confirm the pre-suit service rule before serving."}
              </p>
            </div>
            {pack.service.proofRequired.length > 0 && (
              <div>
                <p className="font-medium">Proof of service must include</p>
                <p className="text-muted-foreground">
                  {pack.service.proofRequired.map((f) => PROOF_FIELD_LABELS[f]).join(", ")}
                </p>
              </div>
            )}
            {pack.localOverlays.length > 0 && (
              <div>
                <p className="font-medium">Local overlays</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {pack.localOverlays.map((o) => (
                    <li key={o.jurisdiction}>
                      {o.jurisdiction}
                      {o.features.length > 0 ? ` — ${o.features.join("; ")}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pack.staleStatuteWarning && (
              <p className="text-destructive">{pack.staleStatuteWarning}</p>
            )}
            {pack.citations.length > 0 && (
              <div>
                <p className="font-medium">Citations</p>
                <ul className="list-disc pl-5 text-muted-foreground">
                  {pack.citations.map((c) => (
                    <li key={c.cite}>
                      {c.cite}
                      {c.note ? ` — ${c.note}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {pack.notes && <p className="text-xs text-muted-foreground">{pack.notes}</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>All jurisdictions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3 font-medium">State</th>
                <th className="p-3 font-medium">Nonpayment period</th>
                <th className="p-3 font-medium">Rent-only</th>
                <th className="p-3 font-medium">Prereqs</th>
                <th className="p-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr
                  key={p.state}
                  className="border-b last:border-0 cursor-pointer hover-elevate"
                  onClick={() => setSelected(p.state)}
                  data-testid={`row-state-${p.state}`}
                >
                  <td className="p-3 font-medium">
                    {p.stateName} ({p.state})
                    {p.leaseSensitive && (
                      <Badge variant="outline" className="ml-2">
                        Lease-sensitive
                      </Badge>
                    )}
                  </td>
                  <td className="p-3">{periodText(p)}</td>
                  <td className="p-3">
                    {p.nonpayment.rentOnlyEnforcement === "hard_block" ? "Strict" : "Attest"}
                  </td>
                  <td className="p-3">{p.nonpayment.prerequisites.length || "—"}</td>
                  <td className="p-3 text-muted-foreground">
                    {reviewByState.has(p.state) ? (
                      <span
                        className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"
                        data-testid={`status-approved-${p.state}`}
                      >
                        <BadgeCheck className="w-3.5 h-3.5" />
                        Attorney-approved {reviewByState.get(p.state)!.reviewedAt}
                      </span>
                    ) : (
                      VERIFICATION_STATUS_LABELS[p.verificationStatus]
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
