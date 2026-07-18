import { useTemplate, useUpdateTemplate, usePermissions, useUsers } from "@/lib/api/hooks";
import { useParams, Link } from "wouter";
import { todayIsoDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Pencil, ShieldCheck, History, Braces, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMemo, useRef, useState } from "react";
import { NOTICE_TYPE_LABELS } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { isKnownMergeField, replaceMergeField, unknownMergeFields } from "@/lib/documents/merge";
import { UnknownFieldsWarning } from "@/components/unknown-fields-warning";
import { MergeFieldPicker, insertMergeField } from "@/components/merge-field-picker";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function TemplateView() {
  const { id } = useParams<{ id: string }>();
  const { data: template, isLoading } = useTemplate(id);
  const { data: users } = useUsers();
  const { can } = usePermissions();
  const canManage = can("template.manage");
  const updateTemplate = useUpdateTemplate();
  const { toast } = useToast();

  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const editBodyRef = useRef<HTMLTextAreaElement>(null);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());

  const toggleVersion = (version: number) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(version)) next.delete(version);
      else next.add(version);
      return next;
    });
  };
  const [reviewerName, setReviewerName] = useState("");
  const [reviewDate, setReviewDate] = useState(todayIsoDate);

  const editUnknownFields = useMemo(() => unknownMergeFields(editBody), [editBody]);

  const userName = useMemo(() => {
    const map = new Map((users ?? []).map((u) => [u.id, u.name]));
    return (uid: string | null) => (uid ? map.get(uid) ?? "Unknown user" : "System");
  }, [users]);

  if (isLoading) return <div className="animate-pulse space-y-4"><div className="h-8 bg-muted w-1/3 rounded" /><div className="h-64 bg-muted rounded" /></div>;
  if (!template) return <div>Template not found</div>;

  const currentBody =
    template.versions.find((v) => v.version === template.currentVersion)?.body ??
    template.versions[template.versions.length - 1]?.body ??
    "";

  const sortedVersions = [...template.versions].sort((a, b) => b.version - a.version);

  const openEdit = () => {
    setEditBody(currentBody);
    setChangeNote("");
    setEditOpen(true);
  };

  const handleSaveBody = async () => {
    if (!editBody.trim()) {
      toast({ title: "Body text is required", variant: "destructive" });
      return;
    }
    try {
      const next = await updateTemplate.mutateAsync({
        id: template.id,
        patch: { body: editBody, changeNote: changeNote.trim() || undefined },
      });
      toast({ title: "Template updated", description: `Saved as version ${next.currentVersion}.` });
      setEditOpen(false);
    } catch (e) {
      toast({
        title: "Could not save template",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const handleToggleActive = async (active: boolean) => {
    try {
      await updateTemplate.mutateAsync({ id: template.id, patch: { active } });
      toast({ title: active ? "Template activated" : "Template deactivated" });
    } catch (e) {
      toast({
        title: "Could not update template",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const openReview = () => {
    setReviewerName("");
    setReviewDate(new Date().toISOString().slice(0, 10));
    setReviewOpen(true);
  };

  const handleMarkReviewed = async () => {
    if (!reviewerName.trim() || !reviewDate) return;
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        patch: { attorneyReviewed: true, reviewedBy: reviewerName.trim(), reviewDate },
      });
      toast({ title: "Marked attorney-reviewed" });
      setReviewOpen(false);
    } catch (e) {
      toast({
        title: "Could not update review status",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/templates">
            <ArrowLeft className="w-4 h-4" />
          </Link>
        </Button>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-serif font-bold tracking-tight" data-testid="text-template-name">{template.name}</h1>
            {template.builtIn && <Badge variant="secondary" data-testid="badge-built-in">Built-in</Badge>}
            {template.attorneyReviewed ? (
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10" data-testid="badge-reviewed">Attorney Reviewed</Badge>
            ) : (
              <Badge variant="destructive" data-testid="badge-requires-review">Requires Review</Badge>
            )}
            {!template.active && <Badge variant="outline" data-testid="badge-inactive">Inactive</Badge>}
          </div>
          <p className="text-muted-foreground mt-1">
            {template.jurisdiction}
            {template.locality ? ` • ${template.locality}` : ""} • {NOTICE_TYPE_LABELS[template.noticeType]} • v{template.currentVersion}
          </p>
        </div>
        {canManage && (
          <Button onClick={openEdit} data-testid="button-edit-template">
            <Pencil className="w-4 h-4 mr-2" />
            Edit Body
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-serif">Template Text (v{template.currentVersion})</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap font-mono text-sm bg-muted/30 border rounded-lg p-4 max-h-[32rem] overflow-y-auto" data-testid="text-template-body">
                {currentBody}
              </pre>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <History className="w-4 h-4" />
                Version History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {sortedVersions.map((v) => {
                  const expanded = expandedVersions.has(v.version);
                  return (
                    <div key={v.version} className="py-3 first:pt-0 last:pb-0" data-testid={`row-version-${v.version}`}>
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => toggleVersion(v.version)}
                        aria-expanded={expanded}
                        data-testid={`button-toggle-version-${v.version}`}
                      >
                        <div className="flex items-center justify-between gap-4">
                          <div className="flex items-center gap-2">
                            {expanded ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                            <span className="font-bold text-sm">v{v.version}</span>
                            {v.version === template.currentVersion && (
                              <Badge variant="outline" className="text-[10px]">Current</Badge>
                            )}
                          </div>
                          <span className="text-sm text-muted-foreground">{formatDateTime(v.changedAt)}</span>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1 pl-6">
                          By {userName(v.changedBy)}
                          {v.changeNote ? ` — ${v.changeNote}` : ""}
                        </div>
                      </button>
                      {expanded && (
                        <pre
                          className="whitespace-pre-wrap font-mono text-xs bg-muted/30 border rounded-lg p-3 mt-2 ml-6 max-h-72 overflow-y-auto"
                          data-testid={`text-version-body-${v.version}`}
                        >
                          {v.body}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <Braces className="w-4 h-4" />
                Merge Fields
              </CardTitle>
            </CardHeader>
            <CardContent>
              {template.mergeFields.length === 0 ? (
                <p className="text-sm text-muted-foreground">No merge fields in this template.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {template.mergeFields.map((f) =>
                      isKnownMergeField(f) ? (
                        <code key={f} className="px-2 py-1 bg-muted rounded text-xs font-mono" data-testid={`merge-field-${f}`}>
                          {"{{"}{f}{"}}"}
                        </code>
                      ) : (
                        <code
                          key={f}
                          className="px-2 py-1 rounded text-xs font-mono bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800"
                          title="Not produced by the merge pipeline — will appear unfilled on generated notices"
                          data-testid={`merge-field-unknown-${f}`}
                        >
                          {"{{"}{f}{"}}"} ⚠
                        </code>
                      ),
                    )}
                  </div>
                  {template.mergeFields.some((f) => !isKnownMergeField(f)) && (
                    <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="text-unknown-fields-note">
                      Highlighted fields are not recognized by the merge pipeline and will appear
                      unfilled on generated notices.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base font-serif flex items-center gap-2">
                <ShieldCheck className="w-4 h-4" />
                Review & Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-sm space-y-1">
                {template.attorneyReviewed ? (
                  <>
                    <p className="font-medium">Attorney reviewed</p>
                    {template.reviewedBy && <p className="text-muted-foreground">Reviewed by: {template.reviewedBy}</p>}
                    {template.reviewDate && <p className="text-muted-foreground">Review date: {template.reviewDate}</p>}
                  </>
                ) : (
                  <p className="text-muted-foreground">This template has not been marked as attorney-reviewed.</p>
                )}
              </div>
              {canManage && !template.attorneyReviewed && (
                <Button variant="outline" size="sm" onClick={openReview} data-testid="button-mark-reviewed">
                  Mark Attorney-Reviewed
                </Button>
              )}
              <div className="flex items-center justify-between pt-2 border-t">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Inactive templates are hidden from notice creation.</p>
                </div>
                <Switch
                  checked={template.active}
                  onCheckedChange={handleToggleActive}
                  disabled={!canManage || updateTemplate.isPending}
                  data-testid="switch-template-active"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Template Body</DialogTitle>
            <DialogDescription>
              Saving creates a new version (v{template.currentVersion + 1}). Previous versions are preserved in the history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-body">Body Text *</Label>
              <Textarea
                id="edit-body"
                ref={editBodyRef}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={16}
                className="font-mono text-sm"
                data-testid="input-edit-body"
              />
              <MergeFieldPicker
                onInsert={(f) => insertMergeField(editBodyRef.current, f, editBody, setEditBody)}
              />
              <UnknownFieldsWarning
                fields={editUnknownFields}
                onReplace={(from, to) => setEditBody((b) => replaceMergeField(b, from, to))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-note">Change Note (optional)</Label>
              <Input
                id="edit-note"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="Describe what changed and why"
                data-testid="input-change-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveBody} disabled={updateTemplate.isPending} data-testid="button-save-body">
              {updateTemplate.isPending ? "Saving..." : `Save as v${template.currentVersion + 1}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Attorney-Reviewed</DialogTitle>
            <DialogDescription>
              Record who reviewed this template and when.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reviewer-name">Reviewer Name *</Label>
              <Input
                id="reviewer-name"
                value={reviewerName}
                onChange={(e) => setReviewerName(e.target.value)}
                placeholder="e.g. Jane Smith, Esq."
                data-testid="input-reviewer-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="review-date">Review Date *</Label>
              <Input
                id="review-date"
                type="date"
                value={reviewDate}
                onChange={(e) => setReviewDate(e.target.value)}
                data-testid="input-review-date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
            <Button
              onClick={handleMarkReviewed}
              disabled={updateTemplate.isPending || !reviewerName.trim() || !reviewDate}
              data-testid="button-confirm-reviewed"
            >
              {updateTemplate.isPending ? "Saving..." : "Mark Reviewed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
