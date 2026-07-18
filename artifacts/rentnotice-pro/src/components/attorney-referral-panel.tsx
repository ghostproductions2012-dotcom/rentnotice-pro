import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getServices } from "@/lib/api/services";
import {
  useAttorneyContacts,
  useChangeNoticeStatus,
  useDeleteAttorneyContact,
  useGenerateDocuments,
  useNoticeDocuments,
  usePermissions,
  useSaveAttorneyContact,
} from "@/lib/api/hooks";
import { FIELD_SYNC_AUTH_REQUIRED_MESSAGE, useFieldSyncAuth } from "@/lib/field-sync";
import { bytesToBase64 } from "@/lib/db";
import { NOTICE_TYPE_LABELS, type Notice } from "@/lib/types";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Copy,
  Download,
  History,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  RefreshCw,
  Scale,
  ShieldOff,
  Trash2,
} from "lucide-react";

const REFERRALS_URL = "/api/attorney-referrals";

type ReferralEvent = { id: string; kind: string; detail: string; createdAt: string };
type ReferralReply = { id: string; body: string; createdAt: string };
type ReferralUploadMeta = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string;
  createdAt: string;
};

type Referral = {
  id: string;
  noticeId: string;
  attorneyName: string;
  attorneyEmail: string;
  message: string;
  status: "active" | "revoked";
  tokenSuffix: string;
  expiresAt: string;
  expired: boolean;
  packetFileName: string;
  packetSizeBytes: number;
  packetPageCount: number;
  courtDate: string | null;
  courtCaseNumber: string | null;
  courtNotes: string | null;
  downloadCount: number;
  lastDownloadedAt: string | null;
  events: ReferralEvent[];
  replies: ReferralReply[];
  uploads: ReferralUploadMeta[];
  createdAt: string;
  updatedAt: string;
};

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtDateOnly(iso: string): string {
  // Date-only strings (YYYY-MM-DD) are rendered without timezone shifts.
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const EVENT_LABELS: Record<string, string> = {
  sent: "Secure link sent",
  resent: "Fresh link sent",
  revoked: "Link revoked",
  viewed: "Case page opened",
  downloaded: "Packet downloaded",
  reply: "Reply received",
  upload: "Document uploaded",
  court_date: "Court date saved",
};

/** Human line for a timeline event; the first "viewed" is the first open. */
function eventLabel(e: ReferralEvent, sorted: ReferralEvent[], index: number): string {
  const base = EVENT_LABELS[e.kind] ?? e.kind;
  if (e.kind === "viewed") {
    const firstViewed = sorted.findIndex((x) => x.kind === "viewed");
    return firstViewed === index ? "First opened by the attorney" : base;
  }
  if (e.kind === "reply") {
    return e.detail ? `${base}: “${e.detail}”` : base;
  }
  // For sent/resent/upload/court_date the server detail is already a full
  // sentence ("Attorney uploaded X", "Court date set to …") — prefer it.
  return e.detail || base;
}

/** Notice statuses a secure link may be sent from (served/mailed flow). */
const SENDABLE_STATUSES = ["served", "mailed", "sent_to_attorney"];

function referralStatusBadge(r: Referral) {
  if (r.status === "revoked")
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
        Revoked
      </span>
    );
  if (r.expired)
    return (
      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
        Expired
      </span>
    );
  return (
    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
      Active
    </span>
  );
}

export function AttorneyReferralPanel({ notice }: { notice: Notice }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { can } = usePermissions();
  const { licenseKey, syncHeaders } = useFieldSyncAuth();
  const generateDocs = useGenerateDocuments();
  const changeStatus = useChangeNoticeStatus();
  const { data: documents } = useNoticeDocuments(notice.id);

  const [sendOpen, setSendOpen] = useState(false);
  const [attorneyName, setAttorneyName] = useState("");
  const [attorneyEmail, setAttorneyEmail] = useState("");
  const [message, setMessage] = useState("");
  const [saveContact, setSaveContact] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState("");

  const contactsQuery = useAttorneyContacts();
  const contacts = contactsQuery.data ?? [];
  const saveContactMut = useSaveAttorneyContact();
  const deleteContactMut = useDeleteAttorneyContact();

  const fail = (title: string) => (e: unknown) =>
    toast({
      title,
      description: e instanceof Error ? e.message : "Unknown error.",
      variant: "destructive",
    });

  const referralsQuery = useQuery({
    queryKey: ["attorneyReferrals", notice.id],
    enabled: !!licenseKey,
    refetchInterval: 60_000,
    queryFn: async () => {
      const res = await fetch(
        `${REFERRALS_URL}?noticeId=${encodeURIComponent(notice.id)}`,
        { headers: syncHeaders },
      );
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      return (await res.json()) as Referral[];
    },
  });

  const linksQuery = useQuery({
    queryKey: ["attorneyReferralLinks", notice.id],
    queryFn: () => getServices().getAttorneyReferralLinks(notice.id),
  });
  const localLinks = linksQuery.data ?? {};

  const refreshReferrals = () => {
    void qc.invalidateQueries({ queryKey: ["attorneyReferrals", notice.id] });
    void qc.invalidateQueries({ queryKey: ["attorneyReferralLinks", notice.id] });
  };

  const copyLink = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ title: "Secure link copied" });
    } catch {
      toast({
        title: "Could not copy automatically",
        description: link,
        variant: "destructive",
      });
    }
  };

  const send = useMutation({
    mutationFn: async (input: { name: string; email: string; message: string }) => {
      const docs = await generateDocs.mutateAsync({
        noticeId: notice.id,
        packetKind: "attorney_packet",
      });
      const packet = docs.find((d) => d.kind === "packet") ?? docs[0];
      if (!packet) throw new Error("Could not generate the attorney packet");
      const buf = await (await fetch(packet.blobUrl)).arrayBuffer();
      const res = await fetch(REFERRALS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...syncHeaders },
        body: JSON.stringify({
          noticeId: notice.id,
          attorneyName: input.name,
          attorneyEmail: input.email,
          message: input.message,
          tenantNames: notice.tenantNames,
          propertyAddress: notice.propertyAddress,
          unit: notice.unit,
          noticeType: NOTICE_TYPE_LABELS[notice.noticeType] ?? notice.noticeType,
          jurisdiction: notice.jurisdiction,
          deadlineDate: notice.deadlineDate ?? undefined,
          totalAmountCents: notice.totalAmountCents,
          packet: {
            fileName: packet.fileName,
            dataBase64: bytesToBase64(new Uint8Array(buf)),
            pageCount: packet.pageCount,
          },
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? `Sync server responded ${res.status}`);
      }
      return (await res.json()) as Referral & { link: string; emailSent: boolean };
    },
    onSuccess: async (created) => {
      if (saveContact && created.attorneyEmail) {
        saveContactMut.mutate({ name: created.attorneyName, email: created.attorneyEmail });
      }
      await getServices().saveAttorneyReferralLink({
        referralId: created.id,
        noticeId: notice.id,
        link: created.link,
      });
      refreshReferrals();
      if (notice.status === "served" || notice.status === "mailed") {
        changeStatus.mutate(
          {
            id: notice.id,
            toStatus: "sent_to_attorney",
            reason: `Secure case link sent to ${created.attorneyEmail}`,
          },
          { onError: fail("Referral sent, but the status update failed") },
        );
      }
      setSendOpen(false);
      setAttorneyName("");
      setAttorneyEmail("");
      setMessage("");
      if (created.emailSent) {
        toast({
          title: "Secure link emailed",
          description: `${created.attorneyEmail} received a link to view and download the packet.`,
        });
      } else {
        await copyLink(created.link);
        toast({
          title: "Link created — email could not be sent",
          description: "The secure link was copied to your clipboard. Share it manually.",
        });
      }
    },
    onError: fail("Could not send to attorney"),
  });

  const revoke = useMutation({
    mutationFn: async (referralId: string) => {
      const res = await fetch(`${REFERRALS_URL}/${referralId}/revoke`, {
        method: "POST",
        headers: syncHeaders,
      });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      return (await res.json()) as Referral;
    },
    onSuccess: () => {
      refreshReferrals();
      toast({ title: "Secure link revoked", description: "The attorney can no longer open the case page." });
    },
    onError: fail("Could not revoke the link"),
  });

  const resend = useMutation({
    mutationFn: async (referralId: string) => {
      const res = await fetch(`${REFERRALS_URL}/${referralId}/resend`, {
        method: "POST",
        headers: syncHeaders,
      });
      if (!res.ok) throw new Error(`Sync server responded ${res.status}`);
      return (await res.json()) as Referral & { link: string; emailSent: boolean };
    },
    onSuccess: async (updated) => {
      await getServices().saveAttorneyReferralLink({
        referralId: updated.id,
        noticeId: notice.id,
        link: updated.link,
      });
      refreshReferrals();
      if (updated.emailSent) {
        toast({
          title: "Fresh link emailed",
          description: "The previous link no longer works.",
        });
      } else {
        await copyLink(updated.link);
        toast({
          title: "Fresh link created — email could not be sent",
          description: "The new secure link was copied to your clipboard.",
        });
      }
    },
    onError: fail("Could not resend the link"),
  });

  // ------------------- auto-import attorney activity ------------------------
  // When the relay reports a court date or uploads we don't have locally,
  // pull them into the local database (court fields on the notice, uploads
  // as locked documents). Signature-guarded so each batch imports once.
  const importingRef = useRef(false);
  const lastSigRef = useRef("");
  const referrals = referralsQuery.data;

  useEffect(() => {
    if (!referrals || !documents || importingRef.current) return;
    const docIds = new Set(documents.map((d) => d.id));
    // Pick the referral whose court date was recorded most recently. The
    // referral's own updatedAt is bumped by downloads/replies/uploads too,
    // so sort by the latest court_date event timestamp instead.
    const courtStamp = (r: Referral) =>
      r.events
        .filter((e) => e.kind === "court_date")
        .map((e) => e.createdAt)
        .sort()
        .pop() ?? r.updatedAt;
    const withCourt =
      referrals
        .filter((r) => r.courtDate)
        .sort((a, b) => courtStamp(b).localeCompare(courtStamp(a)))[0] ?? null;
    const missing = referrals.flatMap((r) =>
      r.uploads.filter((u) => !docIds.has(u.id)).map((u) => ({ referralId: r.id, ...u })),
    );
    const courtChanged =
      !!withCourt &&
      (notice.courtDate !== withCourt.courtDate ||
        notice.courtCaseNumber !== (withCourt.courtCaseNumber ?? "") ||
        notice.courtNotes !== (withCourt.courtNotes ?? ""));
    if (!courtChanged && missing.length === 0) return;
    const sig = JSON.stringify([
      withCourt?.courtDate,
      withCourt?.courtCaseNumber,
      withCourt?.courtNotes,
      missing.map((m) => m.id),
    ]);
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;
    importingRef.current = true;

    (async () => {
      const uploads = [];
      for (const m of missing) {
        const res = await fetch(`${REFERRALS_URL}/${m.referralId}/uploads/${m.id}`, {
          headers: syncHeaders,
        });
        if (!res.ok) throw new Error(`Upload fetch failed (${res.status})`);
        const full = (await res.json()) as ReferralUploadMeta & { dataBase64: string };
        uploads.push({
          id: full.id,
          fileName: full.fileName,
          mimeType: full.mimeType,
          dataBase64: full.dataBase64,
          createdAt: full.createdAt,
        });
      }
      const result = await getServices().applyAttorneyActivity({
        noticeId: notice.id,
        courtDate: withCourt?.courtDate ?? null,
        courtCaseNumber: withCourt?.courtCaseNumber ?? "",
        courtNotes: withCourt?.courtNotes ?? "",
        uploads,
      });
      if (result.courtDateChanged || result.importedUploads > 0) {
        for (const root of ["notices", "notice", "documents", "audit", "dashboard"]) {
          void qc.invalidateQueries({ queryKey: [root] });
        }
        const parts = [];
        if (result.courtDateChanged && withCourt?.courtDate)
          parts.push(`court date ${fmtDateOnly(withCourt.courtDate)}`);
        if (result.importedUploads > 0)
          parts.push(
            `${result.importedUploads} document${result.importedUploads === 1 ? "" : "s"} imported`,
          );
        toast({ title: "Attorney activity synced", description: parts.join(" · ") });
      }
    })()
      .catch(() => {
        // Allow a retry on the next refetch.
        lastSigRef.current = "";
      })
      .finally(() => {
        importingRef.current = false;
      });
  }, [referrals, documents, notice, qc, syncHeaders, toast]);

  // ------------------------------- rendering --------------------------------

  const canSend = can("notice.generate") && can("notice.status");
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attorneyEmail.trim());
  const formValid = attorneyName.trim().length > 0 && emailValid;
  const sending = send.isPending || generateDocs.isPending;

  return (
    <Card data-testid="card-attorney-referral">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scale className="w-5 h-5 text-primary" />
          Attorney Secure Link
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!licenseKey ? (
          <p className="text-xs text-muted-foreground">{FIELD_SYNC_AUTH_REQUIRED_MESSAGE}</p>
        ) : (
          <>
            {SENDABLE_STATUSES.includes(notice.status) ? (
              <>
                <Button
                  className="w-full"
                  disabled={!canSend || sending}
                  onClick={() => setSendOpen(true)}
                  data-testid="button-send-attorney-link"
                >
                  {sending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Mail className="w-4 h-4 mr-2" />
                  )}
                  Email Secure Link to Attorney
                </Button>
                <p className="text-xs text-muted-foreground">
                  The attorney gets a private, no-account link to view and download the case
                  packet, reply, upload documents, and record the court date. Links expire
                  after 30 days.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="text-send-unavailable">
                Secure links are sent from served or mailed notices. Earlier referrals and
                their activity stay visible below.
              </p>
            )}

            {referralsQuery.isLoading && (
              <p className="text-xs text-muted-foreground">Checking for referrals…</p>
            )}
            {referralsQuery.isError && (
              <p className="text-xs text-destructive">
                Could not reach the sync server to load referrals.
              </p>
            )}

            {(referralsQuery.data ?? []).map((r) => (
              <div
                key={r.id}
                className="rounded-md border p-3 space-y-2"
                data-testid={`referral-${r.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.attorneyName}</p>
                    <p className="text-xs text-muted-foreground truncate">{r.attorneyEmail}</p>
                  </div>
                  {referralStatusBadge(r)}
                </div>

                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>
                    Sent {fmtDateTime(r.createdAt)} · link …{r.tokenSuffix} expires{" "}
                    {fmtDateTime(r.expiresAt)}
                  </p>
                  <p className="flex items-center gap-1" data-testid={`text-downloads-${r.id}`}>
                    <Download className="w-3 h-3" />
                    {r.downloadCount > 0
                      ? `Downloaded ${r.downloadCount}× · last ${fmtDateTime(r.lastDownloadedAt!)}`
                      : "Not downloaded yet"}
                  </p>
                </div>

                {r.events.length > 0 && (
                  <div className="space-y-0.5 pt-1" data-testid={`timeline-${r.id}`}>
                    <p className="text-xs font-medium flex items-center gap-1">
                      <History className="w-3 h-3" />
                      Activity
                    </p>
                    {[...r.events]
                      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                      .map((e, i, sorted) => (
                        <p
                          key={e.id}
                          className="text-xs text-muted-foreground"
                          data-testid={`event-${e.kind}-${e.id}`}
                        >
                          <span className="tabular-nums">{fmtDateTime(e.createdAt)}</span>
                          {" · "}
                          {eventLabel(e, sorted, i)}
                        </p>
                      ))}
                  </div>
                )}

                {r.courtDate && (
                  <div className="text-xs rounded bg-primary/5 p-2 space-y-0.5">
                    <p className="flex items-center gap-1 font-medium">
                      <CalendarDays className="w-3 h-3" />
                      Court date {fmtDateOnly(r.courtDate)}
                      {r.courtCaseNumber ? ` · Case ${r.courtCaseNumber}` : ""}
                    </p>
                    {r.courtNotes && <p className="text-muted-foreground">{r.courtNotes}</p>}
                  </div>
                )}

                {r.replies.length > 0 && (
                  <div className="space-y-1">
                    {r.replies.map((reply) => (
                      <div key={reply.id} className="text-xs rounded bg-muted/40 p-2">
                        <p className="flex items-center gap-1 text-muted-foreground">
                          <MessageSquare className="w-3 h-3" />
                          {fmtDateTime(reply.createdAt)}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{reply.body}</p>
                      </div>
                    ))}
                  </div>
                )}

                {r.uploads.length > 0 && (
                  <div className="space-y-1">
                    {r.uploads.map((u) => (
                      <p key={u.id} className="text-xs flex items-center gap-1">
                        <Paperclip className="w-3 h-3 shrink-0" />
                        <span className="truncate">{u.fileName}</span>
                        <span className="text-muted-foreground shrink-0">
                          {fmtSize(u.sizeBytes)}
                          {documents?.some((d) => d.id === u.id) ? " · in Documents" : ""}
                        </span>
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap gap-1.5 pt-1">
                  {localLinks[r.id] && r.status === "active" && !r.expired && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copyLink(localLinks[r.id]!)}
                      data-testid={`button-copy-link-${r.id}`}
                    >
                      <Copy className="w-3.5 h-3.5 mr-1.5" />
                      Copy link
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canSend || resend.isPending}
                    onClick={() => resend.mutate(r.id)}
                    data-testid={`button-resend-${r.id}`}
                  >
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                    {r.status === "active" && !r.expired ? "Send fresh link" : "Reactivate"}
                  </Button>
                  {r.status === "active" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={!canSend || revoke.isPending}
                      onClick={() => revoke.mutate(r.id)}
                      data-testid={`button-revoke-${r.id}`}
                    >
                      <ShieldOff className="w-3.5 h-3.5 mr-1.5" />
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>

      <Dialog
        open={sendOpen}
        onOpenChange={(open) => {
          setSendOpen(open);
          if (!open) setSelectedContactId("");
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email Secure Link to Attorney</DialogTitle>
            <DialogDescription>
              Generates the attorney packet and emails a private case link — no account
              needed. The attorney can download the packet, reply, upload documents, and
              record the court date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {contacts.length > 0 && (
              <div className="space-y-2">
                <Label>Saved attorneys</Label>
                <div className="flex gap-2">
                  <Select
                    value={selectedContactId}
                    onValueChange={(id) => {
                      setSelectedContactId(id);
                      const contact = contacts.find((c) => c.id === id);
                      if (contact) {
                        setAttorneyName(contact.name);
                        setAttorneyEmail(contact.email);
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1" data-testid="select-saved-attorney">
                      <SelectValue placeholder="Choose a saved attorney" />
                    </SelectTrigger>
                    <SelectContent>
                      {contacts.map((c) => (
                        <SelectItem
                          key={c.id}
                          value={c.id}
                          data-testid={`option-saved-attorney-${c.id}`}
                        >
                          {c.name ? `${c.name} — ${c.email}` : c.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={!selectedContactId || deleteContactMut.isPending}
                    aria-label="Remove saved attorney"
                    onClick={() => {
                      if (!selectedContactId) return;
                      deleteContactMut.mutate(selectedContactId);
                      setSelectedContactId("");
                    }}
                    data-testid="button-delete-saved-attorney"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="attorney-name">Attorney name</Label>
              <Input
                id="attorney-name"
                value={attorneyName}
                onChange={(e) => setAttorneyName(e.target.value)}
                placeholder="Jane Smith, Esq."
                data-testid="input-attorney-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attorney-email">Attorney email</Label>
              <Input
                id="attorney-email"
                type="email"
                value={attorneyEmail}
                onChange={(e) => setAttorneyEmail(e.target.value)}
                placeholder="jane@smithlaw.com"
                data-testid="input-attorney-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="attorney-message">Message (optional)</Label>
              <Textarea
                id="attorney-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Context for the attorney — tenant history, urgency, questions."
                rows={3}
                data-testid="textarea-attorney-message"
              />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="save-attorney-contact"
                checked={saveContact}
                onCheckedChange={(v) => setSaveContact(v === true)}
                data-testid="checkbox-save-attorney"
              />
              <Label htmlFor="save-attorney-contact" className="text-sm font-normal">
                Save this attorney for future notices
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setSendOpen(false);
                setSelectedContactId("");
              }}
              disabled={sending}
              data-testid="button-cancel-referral"
            >
              Cancel
            </Button>
            <Button
              disabled={!formValid || sending}
              onClick={() =>
                send.mutate({
                  name: attorneyName.trim(),
                  email: attorneyEmail.trim(),
                  message: message.trim(),
                })
              }
              data-testid="button-create-referral"
            >
              {sending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Generate Packet &amp; Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
