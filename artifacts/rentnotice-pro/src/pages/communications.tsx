// ---------------------------------------------------------------------------
// Communications hub: Slack-style team chat (synced through the company
// cloud relay) and tenant email messaging with announcement templates.
// Requires an activated workspace — demo workspaces have no cloud company.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTeamMembers,
  useListChatChannels,
  useCreateChatChannel,
  useSetChatChannelArchived,
  useOpenDirectMessage,
  useListChatMessages,
  useSendChatMessage,
  useMarkChatChannelRead,
  useListTenantCommunications,
  useSendTenantEmail,
  getListTeamMembersQueryKey,
  getListChatChannelsQueryKey,
  getListChatMessagesQueryKey,
  getListTenantCommunicationsQueryKey,
  type ChatChannelSync,
  type TenantCommunicationSync,
} from "@workspace/api-client-react";
import {
  isMemberTokenRejected,
  registerCommsLicenseKey,
  useCommsIdentity,
  type CommsIdentity,
} from "@/lib/comms/identity";
import {
  ANNOUNCEMENT_TEMPLATES,
  TENANT_MERGE_FIELDS,
  TENANT_MERGE_FIELD_DESCRIPTIONS,
  buildTenantMergeFields,
  propertyFullAddress,
  renderTenantMessage,
} from "@/lib/comms/announcements";
import {
  useClearChatToken,
  useCompanyProfile,
  useProperties,
  useRecordCommsAudit,
  useTenants,
} from "@/lib/api/hooks";
import { MergeFieldPicker, insertMergeField } from "@/components/merge-field-picker";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Archive,
  FileCheck,
  Hash,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Plus,
  Send,
  Wrench,
} from "lucide-react";

registerCommsLicenseKey();

/** Invalidate every cached /api/comms/* query (channels, messages, log). */
function useInvalidateComms() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/comms/"),
    });
}

export default function CommunicationsPage() {
  const identity = useCommsIdentity();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-page-title">
          Communications
        </h1>
        <p className="text-sm text-muted-foreground">
          Team chat for your company and email messages to tenants.
        </p>
      </div>

      {!identity.ready ? (
        <ActivationRequiredCard identity={identity} />
      ) : (
        <Tabs defaultValue="chat">
          <TabsList>
            <TabsTrigger value="chat" data-testid="tab-team-chat">
              Team Chat
            </TabsTrigger>
            <TabsTrigger value="tenant" data-testid="tab-tenant-messages">
              Tenant Messages
            </TabsTrigger>
          </TabsList>
          <TabsContent value="chat" className="mt-4">
            <TeamChat identity={identity} />
          </TabsContent>
          <TabsContent value="tenant" className="mt-4">
            <TenantMessages identity={identity} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function ActivationRequiredCard({ identity }: { identity: CommsIdentity }) {
  return (
    <Card>
      <CardContent className="py-10 flex flex-col items-center text-center gap-3">
        <MessageSquare className="w-10 h-10 text-muted-foreground" />
        <div className="space-y-1 max-w-md">
          <p className="font-medium" data-testid="text-comms-requires-activation">
            {identity.licenseBlocked
              ? "Communications is paused while your license is blocked"
              : identity.tokenMissing
                ? "Sign in again to connect to team chat"
                : "Communications requires an activated company license"}
          </p>
          <p className="text-sm text-muted-foreground">
            {identity.licenseBlocked
              ? "Resolve the license issue in Settings to reconnect team chat and tenant messaging."
              : identity.tokenMissing
                ? "Your chat sign-in has expired or couldn't be verified with the cloud — this also happens when you signed in while offline. Sign out and sign back in with an internet connection to reconnect."
                : "Team chat and tenant email messages sync through your company's cloud workspace. Activate this workspace with your license key in Settings to get started."}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------- chat ----------------------------------

function channelDisplayName(
  channel: ChatChannelSync,
  myKey: string,
  memberNameByKey: Map<string, string>,
): string {
  if (channel.kind !== "dm") return channel.name;
  const otherKey = channel.memberKeys.find((k) => k !== myKey);
  if (otherKey) {
    const live = memberNameByKey.get(otherKey);
    if (live) return live;
  }
  // Fall back to the stored "A & B" name minus our own name where possible.
  return channel.name;
}

function formatMessageTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

function TeamChat({ identity }: { identity: CommsIdentity }) {
  const memberKey = identity.memberKey as string;
  const { toast } = useToast();
  const invalidateComms = useInvalidateComms();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const lastMarkedRef = useRef<Record<string, string>>({});
  const autoCreatedRef = useRef(false);

  const channelsQuery = useListChatChannels(
    { memberKey },
    {
      query: {
        queryKey: getListChatChannelsQueryKey({ memberKey }),
        refetchInterval: 10_000,
      },
    },
  );
  const membersQuery = useListTeamMembers({
    query: { queryKey: getListTeamMembersQueryKey(), refetchInterval: 60_000 },
  });

  // Tokens expire (and rotate) server-side. When the polling queries come
  // back 401, drop the cached token so the page flips to the "sign in
  // again" guidance instead of surfacing raw request errors.
  //
  // Only act on settled errors: after signing back in, this component
  // remounts while the query cache still holds the pre-sign-in 401. The
  // remount refetch is already in flight with the fresh token — clearing on
  // that stale error would wipe the new token and lock chat out forever.
  const clearChatToken = useClearChatToken();
  useEffect(() => {
    if (channelsQuery.isFetching || membersQuery.isFetching) return;
    if (
      isMemberTokenRejected(channelsQuery.error) ||
      isMemberTokenRejected(membersQuery.error)
    ) {
      clearChatToken.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    channelsQuery.error,
    membersQuery.error,
    channelsQuery.isFetching,
    membersQuery.isFetching,
  ]);

  const allChannels = channelsQuery.data ?? [];
  const channels = allChannels.filter((c) => !c.archived && c.kind === "channel");
  const dms = allChannels.filter((c) => !c.archived && c.kind === "dm");
  const members = (membersQuery.data ?? []).filter((m) => m.active);
  const otherMembers = members.filter((m) => m.id !== memberKey);
  const memberNameByKey = useMemo(
    () => new Map(members.map((m) => [m.id, m.name])),
    [members],
  );

  const selected =
    allChannels.find((c) => c.id === selectedId && !c.archived) ?? null;

  const createChannel = useCreateChatChannel();
  const archiveChannel = useSetChatChannelArchived();
  const openDm = useOpenDirectMessage();
  const sendMessage = useSendChatMessage();
  const markRead = useMarkChatChannelRead();
  const recordAudit = useRecordCommsAudit();

  // Bootstrap #general the first time an admin opens an empty workspace chat.
  useEffect(() => {
    if (autoCreatedRef.current || !channelsQuery.data || !identity.isAdmin) return;
    const hasChannel = channelsQuery.data.some(
      (c) => c.kind === "channel" && !c.archived,
    );
    if (hasChannel) return;
    autoCreatedRef.current = true;
    createChannel.mutate(
      {
        data: {
          name: "general",
          createdByKey: memberKey,
          createdByName: identity.memberName,
        },
      },
      { onSuccess: () => invalidateComms() },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsQuery.data]);

  // Default selection: first channel once the list arrives.
  useEffect(() => {
    if (selectedId || channels.length === 0) return;
    setSelectedId(channels[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels.length, selectedId]);

  const messagesQuery = useListChatMessages(
    selected?.id ?? "",
    { limit: 300, memberKey },
    {
      query: {
        queryKey: getListChatMessagesQueryKey(selected?.id ?? "", {
          limit: 300,
          memberKey,
        }),
        enabled: !!selected,
        refetchInterval: 4_000,
      },
    },
  );
  const messages = messagesQuery.data ?? [];

  // Mark the open conversation read whenever its newest message changes.
  useEffect(() => {
    if (!selected || messages.length === 0) return;
    const lastAt = messages[messages.length - 1].createdAt;
    if (lastMarkedRef.current[selected.id] === lastAt) return;
    lastMarkedRef.current[selected.id] = lastAt;
    markRead.mutate(
      { id: selected.id, data: { memberKey, lastReadAt: lastAt } },
      { onSuccess: () => invalidateComms() },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, messages]);

  // Keep the view pinned to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [selected?.id, messages.length]);

  const handleCreateChannel = () => {
    const name = newChannelName.trim().replace(/^#/, "");
    if (!name) return;
    createChannel.mutate(
      {
        data: { name, createdByKey: memberKey, createdByName: identity.memberName },
      },
      {
        onSuccess: (channel) => {
          setNewChannelOpen(false);
          setNewChannelName("");
          setSelectedId(channel.id);
          invalidateComms();
          recordAudit.mutate({
            action: "chat_channel_created",
            entityId: channel.id,
            summary: `Created chat channel #${channel.name}`,
          });
        },
        onError: (err) =>
          toast({
            title: "Could not create channel",
            description: err instanceof Error ? err.message : "Try a different name.",
            variant: "destructive",
          }),
      },
    );
  };

  const handleStartDm = (other: { id: string; name: string }) => {
    openDm.mutate(
      {
        data: {
          memberKeys: [memberKey, other.id],
          memberNames: [identity.memberName, other.name],
          createdByKey: memberKey,
          createdByName: identity.memberName,
        },
      },
      {
        onSuccess: (channel) => {
          setSelectedId(channel.id);
          invalidateComms();
        },
        onError: (err) =>
          toast({
            title: "Could not open direct message",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          }),
      },
    );
  };

  const handleArchive = () => {
    if (!selected || selected.kind !== "channel") return;
    archiveChannel.mutate(
      { id: selected.id, data: { archived: true } },
      {
        onSuccess: () => {
          toast({ title: `#${selected.name} archived` });
          setSelectedId(null);
          invalidateComms();
          recordAudit.mutate({
            action: "chat_channel_archived",
            entityId: selected.id,
            summary: `Archived chat channel #${selected.name}`,
          });
        },
        onError: (err) =>
          toast({
            title: "Could not archive channel",
            description: err instanceof Error ? err.message : undefined,
            variant: "destructive",
          }),
      },
    );
  };

  const handleSend = () => {
    const body = draft.trim();
    if (!body || !selected || sendMessage.isPending) return;
    sendMessage.mutate(
      {
        id: selected.id,
        data: {
          id: crypto.randomUUID(),
          senderKey: memberKey,
          senderName: identity.memberName,
          body,
          createdAt: new Date().toISOString(),
        },
      },
      {
        onSuccess: () => {
          setDraft("");
          invalidateComms();
        },
        onError: (err) =>
          toast({
            title: "Message not sent",
            description: err instanceof Error ? err.message : "Check your connection.",
            variant: "destructive",
          }),
      },
    );
  };

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-[240px_1fr] h-[600px]">
        {/* ------------------------- conversation list ------------------------- */}
        <div className="border-r flex flex-col min-h-0">
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Channels
            </span>
            {identity.isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => setNewChannelOpen(true)}
                title="New channel"
                data-testid="button-new-channel"
              >
                <Plus className="w-4 h-4" />
              </Button>
            )}
          </div>
          <div className="px-1" data-testid="list-channels">
            {channelsQuery.isLoading && (
              <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>
            )}
            {!channelsQuery.isLoading && channels.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No channels yet.
              </div>
            )}
            {channels.map((c) => (
              <ConversationRow
                key={c.id}
                label={c.name}
                icon={<Hash className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />}
                active={selected?.id === c.id}
                unread={c.unreadCount}
                onClick={() => setSelectedId(c.id)}
                testId={`row-channel-${c.name}`}
              />
            ))}
          </div>

          <div className="flex items-center justify-between px-3 pt-4 pb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Direct messages
            </span>
            {otherMembers.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Start a direct message"
                    data-testid="button-start-dm"
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {otherMembers.map((m) => (
                    <DropdownMenuItem
                      key={m.id}
                      onClick={() => handleStartDm(m)}
                      data-testid={`menu-dm-${m.id}`}
                    >
                      {m.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          <div className="px-1 flex-1 overflow-y-auto" data-testid="list-dms">
            {dms.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">
                No direct messages yet.
              </div>
            )}
            {dms.map((c) => (
              <ConversationRow
                key={c.id}
                label={channelDisplayName(c, memberKey, memberNameByKey)}
                icon={
                  <MessageSquare className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                }
                active={selected?.id === c.id}
                unread={c.unreadCount}
                onClick={() => setSelectedId(c.id)}
                testId={`row-dm-${c.id}`}
              />
            ))}
          </div>
        </div>

        {/* --------------------------- message pane ---------------------------- */}
        <div className="flex flex-col min-h-0">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {channelsQuery.isLoading
                ? "Loading conversations…"
                : "Select a conversation to start chatting."}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 border-b px-4 py-2.5">
                {selected.kind === "channel" ? (
                  <Hash className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                )}
                <span className="font-medium text-sm" data-testid="text-conversation-name">
                  {channelDisplayName(selected, memberKey, memberNameByKey)}
                </span>
                {selected.kind === "channel" && identity.isAdmin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto text-muted-foreground"
                    onClick={handleArchive}
                    disabled={archiveChannel.isPending}
                    data-testid="button-archive-channel"
                  >
                    <Archive className="w-4 h-4 mr-1.5" />
                    Archive
                  </Button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-testid="list-chat-messages">
                {messagesQuery.isLoading && (
                  <div className="flex justify-center py-6">
                    <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!messagesQuery.isLoading && messages.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No messages yet — say hello.
                  </p>
                )}
                {messages.map((m) => {
                  const mine = m.senderKey === memberKey;
                  return (
                    <div key={m.id} className="flex gap-2.5" data-testid={`message-${m.id}`}>
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 mt-0.5 ${
                          mine ? "bg-primary text-primary-foreground" : "bg-muted"
                        }`}
                      >
                        {m.senderName
                          .split(/\s+/)
                          .map((p) => p[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">{m.senderName}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {formatMessageTime(m.createdAt)}
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                      </div>
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              <div className="border-t p-3 flex items-end gap-2">
                <Textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={`Message ${
                    selected.kind === "channel"
                      ? `#${selected.name}`
                      : channelDisplayName(selected, memberKey, memberNameByKey)
                  }`}
                  className="min-h-[40px] max-h-32 resize-none"
                  rows={1}
                  data-testid="input-chat-message"
                />
                <Button
                  onClick={handleSend}
                  disabled={!draft.trim() || sendMessage.isPending}
                  size="icon"
                  data-testid="button-send-message"
                >
                  {sendMessage.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>

      <Dialog open={newChannelOpen} onOpenChange={setNewChannelOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>New channel</DialogTitle>
            <DialogDescription>
              Channels are visible to everyone in your company.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="new-channel-name">Channel name</Label>
            <Input
              id="new-channel-name"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreateChannel()}
              placeholder="e.g. maintenance"
              data-testid="input-new-channel-name"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewChannelOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateChannel}
              disabled={!newChannelName.trim() || createChannel.isPending}
              data-testid="button-create-channel"
            >
              Create channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ConversationRow({
  label,
  icon,
  active,
  unread,
  onClick,
  testId,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  unread: number;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left ${
        active ? "bg-muted font-medium" : "hover:bg-muted/60"
      }`}
      data-testid={testId}
    >
      {icon}
      <span className="truncate flex-1">{label}</span>
      {unread > 0 && (
        <Badge className="h-5 min-w-5 px-1.5 justify-center" data-testid={`badge-unread-${testId}`}>
          {unread > 99 ? "99+" : unread}
        </Badge>
      )}
    </button>
  );
}

// ------------------------------ tenant messages -----------------------------

const KIND_META: Record<
  TenantCommunicationSync["kind"],
  { label: string; icon: React.ReactNode }
> = {
  email: { label: "Email", icon: <Mail className="w-3.5 h-3.5" /> },
  announcement: { label: "Announcement", icon: <Megaphone className="w-3.5 h-3.5" /> },
  notice_served: { label: "Notice served", icon: <FileCheck className="w-3.5 h-3.5" /> },
  work_order: { label: "Work order", icon: <Wrench className="w-3.5 h-3.5" /> },
};

function statusVariant(
  status: TenantCommunicationSync["status"],
): "default" | "destructive" | "secondary" {
  if (status === "failed") return "destructive";
  if (status === "logged") return "secondary";
  return "default";
}

function TenantMessages({ identity }: { identity: CommsIdentity }) {
  const { toast } = useToast();
  const invalidateComms = useInvalidateComms();

  const { data: tenants } = useTenants();
  const { data: properties } = useProperties();
  const { data: company } = useCompanyProfile();

  const historyQuery = useListTenantCommunications(
    { limit: 100 },
    {
      query: {
        queryKey: getListTenantCommunicationsQueryKey({ limit: 100 }),
        refetchInterval: 15_000,
      },
    },
  );
  const sendEmail = useSendTenantEmail();

  const [recipientMode, setRecipientMode] = useState<"tenant" | "property">("tenant");
  const [tenantId, setTenantId] = useState<string>("");
  const [propertyId, setPropertyId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("blank");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const activeTenants = useMemo(
    () => (tenants ?? []).filter((t) => !t.archived),
    [tenants],
  );
  const propertyById = useMemo(
    () => new Map((properties ?? []).map((p) => [p.id, p])),
    [properties],
  );

  const recipients = useMemo(() => {
    if (recipientMode === "tenant") {
      const t = activeTenants.find((t) => t.id === tenantId);
      return t ? [t] : [];
    }
    if (!propertyId) return [];
    return activeTenants.filter((t) => t.propertyId === propertyId);
  }, [recipientMode, tenantId, propertyId, activeTenants]);

  const recipientsWithEmail = recipients.filter((t) => t.email.trim() !== "");

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const template = ANNOUNCEMENT_TEMPLATES.find((t) => t.id === id);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  const previewTenant = recipientsWithEmail[0] ?? recipients[0] ?? null;
  const preview = useMemo(() => {
    if (!previewTenant || (!subject.trim() && !body.trim())) return null;
    const fields = buildTenantMergeFields(
      previewTenant,
      previewTenant.propertyId ? propertyById.get(previewTenant.propertyId) : null,
      company?.name ?? "",
    );
    return {
      subject: renderTenantMessage(subject, fields),
      body: renderTenantMessage(body, fields),
    };
  }, [previewTenant, subject, body, propertyById, company?.name]);

  const handleSend = async () => {
    if (!subject.trim() || !body.trim()) {
      toast({
        title: "Add a subject and a message",
        variant: "destructive",
      });
      return;
    }
    if (recipientsWithEmail.length === 0) {
      toast({
        title: "No recipients with an email address",
        description:
          recipients.length > 0
            ? "The selected tenant(s) have no email on file."
            : "Choose a tenant or a property first.",
        variant: "destructive",
      });
      return;
    }

    setSending(true);
    let sent = 0;
    let failed = 0;
    for (const t of recipientsWithEmail) {
      const property = t.propertyId ? propertyById.get(t.propertyId) : null;
      const fields = buildTenantMergeFields(t, property, company?.name ?? "");
      try {
        await sendEmail.mutateAsync({
          data: {
            tenantId: t.id,
            tenantName: t.names.join(", "),
            tenantEmail: t.email.trim(),
            propertyAddress: propertyFullAddress(property),
            subject: renderTenantMessage(subject, fields),
            bodyText: renderTenantMessage(body, fields),
            createdByKey: identity.memberKey ?? undefined,
            createdByName: identity.memberName || undefined,
          },
        });
        sent += 1;
      } catch {
        failed += 1;
      }
    }
    setSending(false);
    invalidateComms();

    const skipped = recipients.length - recipientsWithEmail.length;
    const parts = [`${sent} sent`];
    if (failed > 0) parts.push(`${failed} failed`);
    if (skipped > 0) parts.push(`${skipped} skipped (no email)`);
    toast({
      title: failed > 0 ? "Some messages did not send" : "Message sent",
      description: parts.join(" · "),
      variant: failed > 0 ? "destructive" : undefined,
    });
    if (failed === 0 && sent > 0) {
      setSubject("");
      setBody("");
      setTemplateId("blank");
    }
  };

  const history = historyQuery.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-2 items-start">
      {/* ------------------------------ composer ------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Send a message</CardTitle>
          <CardDescription>
            Emails are sent from your company workspace and logged per tenant. These
            are courtesy messages, not legal notices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Send to</Label>
              <Select
                value={recipientMode}
                onValueChange={(v) => setRecipientMode(v as "tenant" | "property")}
              >
                <SelectTrigger data-testid="select-recipient-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tenant">One tenant</SelectItem>
                  <SelectItem value="property">Everyone at a property</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{recipientMode === "tenant" ? "Tenant" : "Property"}</Label>
              {recipientMode === "tenant" ? (
                <Select value={tenantId} onValueChange={setTenantId}>
                  <SelectTrigger data-testid="select-tenant">
                    <SelectValue placeholder="Choose a tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeTenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.names.join(", ")}
                        {t.email.trim() === "" ? " (no email)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger data-testid="select-property">
                    <SelectValue placeholder="Choose a property" />
                  </SelectTrigger>
                  <SelectContent>
                    {(properties ?? []).map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nickname || p.addressLine1}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {recipients.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid="text-recipient-summary">
              {recipientsWithEmail.length} recipient
              {recipientsWithEmail.length === 1 ? "" : "s"} with email
              {recipients.length !== recipientsWithEmail.length &&
                ` · ${recipients.length - recipientsWithEmail.length} without email will be skipped`}
            </p>
          )}

          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId} onValueChange={applyTemplate}>
              <SelectTrigger data-testid="select-announcement-template">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="blank">Blank message</SelectItem>
                {ANNOUNCEMENT_TEMPLATES.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-msg-subject">Subject</Label>
            <Input
              id="tenant-msg-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              data-testid="input-message-subject"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="tenant-msg-body">Message</Label>
            <Textarea
              id="tenant-msg-body"
              ref={bodyRef}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Write your message…"
              data-testid="input-message-body"
            />
            <MergeFieldPicker
              fields={TENANT_MERGE_FIELDS}
              descriptions={TENANT_MERGE_FIELD_DESCRIPTIONS}
              onInsert={(field) =>
                insertMergeField(bodyRef.current, field, body, setBody)
              }
            />
          </div>

          {preview && (
            <div className="border rounded-lg p-3 bg-muted/20 space-y-1" data-testid="panel-message-preview">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Preview{previewTenant ? ` — ${previewTenant.names.join(", ")}` : ""}
              </p>
              <p className="text-sm font-medium">{preview.subject}</p>
              <p className="text-xs whitespace-pre-wrap text-muted-foreground line-clamp-6">
                {preview.body}
              </p>
            </div>
          )}

          <Button
            onClick={handleSend}
            disabled={sending}
            className="w-full"
            data-testid="button-send-tenant-message"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Send className="w-4 h-4 mr-2" />
            )}
            {recipientsWithEmail.length > 1
              ? `Send to ${recipientsWithEmail.length} tenants`
              : "Send message"}
          </Button>
        </CardContent>
      </Card>

      {/* ------------------------------- history ------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent communications</CardTitle>
          <CardDescription>
            Everything sent or logged for your tenants, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {historyQuery.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-communications">
              No tenant communications yet.
            </p>
          ) : (
            <div className="divide-y max-h-[560px] overflow-y-auto" data-testid="list-tenant-communications">
              {history.map((c) => (
                <div key={c.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className="gap-1 font-normal">
                      {KIND_META[c.kind]?.icon}
                      {KIND_META[c.kind]?.label ?? c.kind}
                    </Badge>
                    <span className="text-sm font-medium truncate">{c.tenantName}</span>
                    <Badge variant={statusVariant(c.status)} className="ml-auto">
                      {c.status}
                    </Badge>
                  </div>
                  {c.subject && <p className="text-sm truncate">{c.subject}</p>}
                  <p className="text-xs text-muted-foreground">
                    {formatMessageTime(c.createdAt)}
                    {c.createdByName ? ` · by ${c.createdByName}` : ""}
                    {c.propertyAddress ? ` · ${c.propertyAddress}` : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
