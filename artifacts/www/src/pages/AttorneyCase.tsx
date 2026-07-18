import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  CalendarDays,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Paperclip,
  Scale,
  Send,
  ShieldAlert,
  Upload,
} from "lucide-react";

type CaseReply = { id: string; body: string; createdAt: string };
type CaseUpload = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  note: string;
  createdAt: string;
};

type CasePayload = {
  attorneyName: string;
  companyName: string;
  message: string;
  caseSummary: {
    tenantNames: string[];
    propertyAddress: string;
    unit: string;
    noticeType: string;
    jurisdiction: string;
    deadlineDate: string | null;
    totalAmountCents: number | null;
  };
  packet: { fileName: string; sizeBytes: number; pageCount: number };
  courtDate: string | null;
  courtCaseNumber: string | null;
  courtNotes: string | null;
  replies: CaseReply[];
  uploads: CaseUpload[];
  sentAt: string;
  expiresAt: string;
};

class CaseError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

const ACCEPTED_TYPES = "application/pdf,image/jpeg,image/png,image/webp";
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

function fmtCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtDateOnly(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "long" });
}

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const idx = result.indexOf("base64,");
      if (idx === -1) {
        reject(new Error("Could not read the file"));
        return;
      }
      resolve(result.slice(idx + 7));
    };
    reader.onerror = () => reject(new Error("Could not read the file"));
    reader.readAsDataURL(file);
  });
}

export default function AttorneyCase() {
  const { token = "" } = useParams<{ token: string }>();
  const qc = useQueryClient();
  const { toast } = useToast();
  const caseUrl = `/api/attorney/case/${encodeURIComponent(token)}`;

  const caseQuery = useQuery({
    queryKey: ["attorneyCase", token],
    retry: false,
    queryFn: async () => {
      const res = await fetch(caseUrl);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { message?: string; code?: string }
          | null;
        throw new CaseError(
          body?.message ?? "This case could not be loaded.",
          body?.code ?? "error",
        );
      }
      return (await res.json()) as CasePayload;
    },
  });
  const data = caseQuery.data;

  const [replyBody, setReplyBody] = useState("");
  const [courtDate, setCourtDate] = useState("");
  const [courtCaseNumber, setCourtCaseNumber] = useState("");
  const [courtNotes, setCourtNotes] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNote, setUploadNote] = useState("");

  useEffect(() => {
    if (!data) return;
    setCourtDate(data.courtDate ?? "");
    setCourtCaseNumber(data.courtCaseNumber ?? "");
    setCourtNotes(data.courtNotes ?? "");
  }, [data]);

  const fail = (title: string) => (e: unknown) =>
    toast({
      title,
      description: e instanceof Error ? e.message : "Unknown error.",
      variant: "destructive",
    });

  const refresh = () => void qc.invalidateQueries({ queryKey: ["attorneyCase", token] });

  const sendReply = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`${caseUrl}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as CaseReply;
    },
    onSuccess: () => {
      setReplyBody("");
      refresh();
      toast({ title: "Reply sent", description: "The sender will see it on their desktop." });
    },
    onError: fail("Could not send the reply"),
  });

  const saveCourtDate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${caseUrl}/court-date`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courtDate,
          courtCaseNumber,
          courtNotes,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as {
        courtDate: string;
        courtCaseNumber: string;
        courtNotes: string;
      };
    },
    onSuccess: () => {
      refresh();
      toast({
        title: "Court date saved",
        description: "It will appear on the sender's deadline calendar.",
      });
    },
    onError: fail("Could not save the court date"),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error("File exceeds the 15 MB limit");
      const dataBase64 = await fileToBase64(file);
      const res = await fetch(`${caseUrl}/uploads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/pdf",
          dataBase64,
          note: uploadNote.trim(),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(err?.message ?? `Request failed (${res.status})`);
      }
      return (await res.json()) as CaseUpload;
    },
    onSuccess: () => {
      setUploadFile(null);
      setUploadNote("");
      refresh();
      toast({
        title: "Document uploaded",
        description: "It will be imported into the sender's case file.",
      });
    },
    onError: fail("Could not upload the document"),
  });

  if (caseQuery.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-muted/30 py-12 px-4">
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (caseQuery.isError || !data) {
    const err = caseQuery.error;
    const message =
      err instanceof CaseError ? err.message : "This case could not be loaded.";
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-muted/30 py-12 px-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="pt-8 pb-8 space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-serif" data-testid="text-case-error">
              Case unavailable
            </h1>
            <p className="text-muted-foreground">{message}</p>
            <p className="text-xs text-muted-foreground">
              If you believe this is a mistake, contact the person who sent you this link.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const s = data.caseSummary;

  return (
    <div className="min-h-[100dvh] bg-muted/30 py-10 px-4">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-primary/10 text-primary">
            <Scale className="w-7 h-7" />
          </div>
          <h1 className="text-3xl font-serif" data-testid="text-case-title">
            Attorney Case Review
          </h1>
          <p className="text-muted-foreground">
            {data.companyName} shared this eviction case with you
            {data.attorneyName ? `, ${data.attorneyName}` : ""}. No account is required.
          </p>
          <p className="text-xs text-muted-foreground">
            Sent {fmtDateTime(data.sentAt)} · link expires {fmtDateTime(data.expiresAt)}
          </p>
        </div>

        {data.message && (
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm whitespace-pre-wrap" data-testid="text-sender-message">
                {data.message}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>Case Summary</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="font-medium text-muted-foreground">Tenant(s)</dt>
                <dd className="mt-0.5" data-testid="text-tenants">
                  {s.tenantNames.length > 0 ? s.tenantNames.join(", ") : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Property</dt>
                <dd className="mt-0.5">
                  {s.propertyAddress || "—"}
                  {s.unit ? ` · Unit ${s.unit}` : ""}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Notice</dt>
                <dd className="mt-0.5">
                  {s.noticeType ? s.noticeType.replace(/_/g, " ").toUpperCase() : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-muted-foreground">Jurisdiction</dt>
                <dd className="mt-0.5">{s.jurisdiction ? s.jurisdiction.toUpperCase() : "—"}</dd>
              </div>
              {s.deadlineDate && (
                <div>
                  <dt className="font-medium text-muted-foreground">Compliance Deadline</dt>
                  <dd className="mt-0.5">{fmtDateOnly(s.deadlineDate)}</dd>
                </div>
              )}
              {typeof s.totalAmountCents === "number" && s.totalAmountCents > 0 && (
                <div>
                  <dt className="font-medium text-muted-foreground">Amount Demanded</dt>
                  <dd className="mt-0.5 font-semibold">{fmtCents(s.totalAmountCents)}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle>Case Packet</CardTitle>
            <CardDescription>
              The complete notice packet prepared by {data.companyName}.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <FileText className="w-8 h-8 text-primary shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{data.packet.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.packet.pageCount} page{data.packet.pageCount === 1 ? "" : "s"} ·{" "}
                    {fmtSize(data.packet.sizeBytes)}
                  </p>
                </div>
              </div>
              <Button asChild data-testid="button-download-packet">
                <a href={`${caseUrl}/packet`} download>
                  <Download className="w-4 h-4 mr-2" />
                  Download Packet
                </a>
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Downloads are recorded so the sender knows you received the packet.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              Court Date
            </CardTitle>
            <CardDescription>
              Recording the hearing date puts it on the sender's deadline calendar
              automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="court-date">Hearing date</Label>
                <Input
                  id="court-date"
                  type="date"
                  value={courtDate}
                  onChange={(e) => setCourtDate(e.target.value)}
                  data-testid="input-court-date"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="case-number">Case number (optional)</Label>
                <Input
                  id="case-number"
                  value={courtCaseNumber}
                  onChange={(e) => setCourtCaseNumber(e.target.value)}
                  placeholder="e.g. 26STUD01234"
                  data-testid="input-case-number"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="court-notes">Notes (optional)</Label>
              <Textarea
                id="court-notes"
                value={courtNotes}
                onChange={(e) => setCourtNotes(e.target.value)}
                placeholder="Courtroom, department, appearance instructions…"
                rows={2}
                data-testid="textarea-court-notes"
              />
            </div>
            <Button
              disabled={!courtDate || saveCourtDate.isPending}
              onClick={() => saveCourtDate.mutate()}
              data-testid="button-save-court-date"
            >
              {saveCourtDate.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Save Court Date
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-primary" />
              Reply to {data.companyName}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {data.replies.length > 0 && (
              <div className="space-y-2">
                {data.replies.map((r) => (
                  <div key={r.id} className="rounded-md bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}</p>
                    <p className="mt-1 text-sm whitespace-pre-wrap">{r.body}</p>
                  </div>
                ))}
              </div>
            )}
            <Textarea
              value={replyBody}
              onChange={(e) => setReplyBody(e.target.value)}
              placeholder="Questions, requests, or advice for the sender…"
              rows={3}
              data-testid="textarea-reply"
            />
            <Button
              disabled={!replyBody.trim() || sendReply.isPending}
              onClick={() => sendReply.mutate(replyBody.trim())}
              data-testid="button-send-reply"
            >
              {sendReply.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Send className="w-4 h-4 mr-2" />
              )}
              Send Reply
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="border-b pb-4">
            <CardTitle className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-primary" />
              Upload a Document
            </CardTitle>
            <CardDescription>
              Filed complaints, court forms, or correspondence — PDF, JPEG, PNG or WebP up to
              15 MB. Uploads sync back to the sender's case file.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            {data.uploads.length > 0 && (
              <div className="space-y-1.5">
                {data.uploads.map((u) => (
                  <p key={u.id} className="text-sm flex items-center gap-2">
                    <Paperclip className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="truncate">{u.fileName}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtSize(u.sizeBytes)} · {fmtDateTime(u.createdAt)}
                    </span>
                  </p>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Input
                type="file"
                accept={ACCEPTED_TYPES}
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                data-testid="input-upload-file"
              />
              <Input
                value={uploadNote}
                onChange={(e) => setUploadNote(e.target.value)}
                placeholder="Note about this document (optional)"
                data-testid="input-upload-note"
              />
            </div>
            <Button
              disabled={!uploadFile || upload.isPending}
              onClick={() => uploadFile && upload.mutate(uploadFile)}
              data-testid="button-upload"
            >
              {upload.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              Upload Document
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground pb-6">
          Secure link powered by RentNotice Pro. This page provides document exchange only and
          is not legal advice.
        </p>
      </div>
    </div>
  );
}
