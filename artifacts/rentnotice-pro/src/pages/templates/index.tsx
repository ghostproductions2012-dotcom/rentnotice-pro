import { useTemplates, usePermissions, useCreateTemplate } from "@/lib/api/hooks";
import { Card, CardContent } from "@/components/ui/card";
import { Scale, Search, Plus, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Link, useLocation } from "wouter";
import { useMemo, useRef, useState } from "react";
import { NOTICE_TYPE_LABELS, type NoticeType } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { replaceMergeField, unknownMergeFields } from "@/lib/documents/merge";
import { UnknownFieldsWarning } from "@/components/unknown-fields-warning";
import { MergeFieldPicker, insertMergeField } from "@/components/merge-field-picker";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC",
];

function NewTemplateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createTemplate = useCreateTemplate();
  const [name, setName] = useState("");
  const [noticeType, setNoticeType] = useState<NoticeType | "">("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [locality, setLocality] = useState("");
  const [body, setBody] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const bodyUnknownFields = useMemo(() => unknownMergeFields(body), [body]);

  const reset = () => {
    setName("");
    setNoticeType("");
    setJurisdiction("");
    setLocality("");
    setBody("");
    setShowErrors(false);
  };

  const handleCreate = async () => {
    if (!name.trim() || !noticeType || !jurisdiction || !body.trim()) {
      setShowErrors(true);
      return;
    }
    try {
      const created = await createTemplate.mutateAsync({
        name: name.trim(),
        noticeType,
        jurisdiction,
        locality: locality.trim() ? locality.trim() : null,
        body,
      });
      toast({ title: "Template created", description: `"${created.name}" was created as version 1.` });
      onOpenChange(false);
      reset();
      navigate(`/templates/${created.id}`);
    } catch (e) {
      toast({
        title: "Could not create template",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Template</DialogTitle>
          <DialogDescription>
            Create a custom notice template. Use {"{{merge_field}}"} placeholders for values filled in when a notice is generated.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-name">Name *</Label>
            <Input
              id="tpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Texas 3-Day Notice to Vacate"
              data-testid="input-template-name"
            />
            {showErrors && !name.trim() && <p className="text-sm text-destructive">Name is required.</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Notice Type *</Label>
              <Select value={noticeType} onValueChange={(v) => setNoticeType(v as NoticeType)}>
                <SelectTrigger data-testid="select-template-notice-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(NOTICE_TYPE_LABELS) as NoticeType[]).map((t) => (
                    <SelectItem key={t} value={t}>{NOTICE_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showErrors && !noticeType && <p className="text-sm text-destructive">Notice type is required.</p>}
            </div>
            <div className="space-y-2">
              <Label>Jurisdiction *</Label>
              <Select value={jurisdiction} onValueChange={setJurisdiction}>
                <SelectTrigger data-testid="select-template-jurisdiction">
                  <SelectValue placeholder="State" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showErrors && !jurisdiction && <p className="text-sm text-destructive">Jurisdiction is required.</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="tpl-locality">Locality (optional)</Label>
              <Input
                id="tpl-locality"
                value={locality}
                onChange={(e) => setLocality(e.target.value)}
                placeholder="e.g. los_angeles"
                data-testid="input-template-locality"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-body">Body Text *</Label>
            <Textarea
              id="tpl-body"
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              placeholder={"NOTICE TO ...\n\nTO: {{tenant_names}}\n..."}
              data-testid="input-template-body"
            />
            {showErrors && !body.trim() && <p className="text-sm text-destructive">Body text is required.</p>}
            <MergeFieldPicker
              onInsert={(f) => insertMergeField(bodyRef.current, f, body, setBody)}
            />
            <UnknownFieldsWarning
              fields={bodyUnknownFields}
              onReplace={(from, to) => setBody((b) => replaceMergeField(b, from, to))}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createTemplate.isPending} data-testid="button-create-template">
            {createTemplate.isPending ? "Creating..." : "Create Template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function TemplatesList() {
  const { data: templates, isLoading } = useTemplates();
  const { can } = usePermissions();
  const canManage = can("template.manage");
  const [search, setSearch] = useState("");
  const [jurisdictionFilter, setJurisdictionFilter] = useState("all");
  const [newOpen, setNewOpen] = useState(false);

  const jurisdictions = useMemo(
    () => Array.from(new Set((templates ?? []).map((t) => t.jurisdiction))).sort(),
    [templates],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templates ?? []).filter(
      (t) =>
        (!q || t.name.toLowerCase().includes(q)) &&
        (jurisdictionFilter === "all" || t.jurisdiction === jurisdictionFilter),
    );
  }, [templates, search, jurisdictionFilter]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold tracking-tight">Legal Templates</h1>
          <p className="text-muted-foreground mt-1">Manage standard language for notices across jurisdictions.</p>
        </div>
        {canManage && (
          <Button onClick={() => setNewOpen(true)} data-testid="button-new-template">
            <Plus className="w-4 h-4 mr-2" />
            New Template
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search templates..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-template-search"
          />
        </div>
        <Select value={jurisdictionFilter} onValueChange={setJurisdictionFilter}>
          <SelectTrigger className="w-full sm:w-48" data-testid="select-jurisdiction-filter">
            <SelectValue placeholder="Jurisdiction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All jurisdictions</SelectItem>
            {jurisdictions.map((j) => (
              <SelectItem key={j} value={j}>{j}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed bg-muted/20">
          <CardContent className="p-12 text-center">
            <Scale className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium">No templates found</h3>
            <p className="text-muted-foreground">
              {templates?.length ? "Try adjusting your search or filter." : "Get started by creating a template."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {filtered.map(template => (
            <Link key={template.id} href={`/templates/${template.id}`}>
              <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full" data-testid={`card-template-${template.id}`}>
                <CardContent className="p-6">
                  <div className="flex items-start justify-between mb-4">
                    <h3 className="font-bold font-serif text-lg leading-tight pr-4">{template.name}</h3>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {template.attorneyReviewed ? (
                        <span className="px-2 py-1 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider rounded">Reviewed</span>
                      ) : (
                        <span className="px-2 py-1 bg-destructive/10 text-destructive text-[10px] font-bold uppercase tracking-wider rounded">Requires Review</span>
                      )}
                      {template.builtIn && (
                        <span className="px-2 py-1 bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-wider rounded">Built-in</span>
                      )}
                      {!template.active && (
                        <span className="px-2 py-1 bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-wider rounded">Inactive</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      {template.jurisdiction}
                    </div>
                    <div className="px-1.5 border-l">{NOTICE_TYPE_LABELS[template.noticeType]}</div>
                    <div className="px-1.5 border-l">v{template.currentVersion}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <NewTemplateDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}
