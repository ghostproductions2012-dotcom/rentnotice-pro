import { Feather } from "@expo/vector-icons";
import {
  getListChatChannelsQueryKey,
  getListChatMessagesQueryKey,
  getListTeamMembersQueryKey,
  issueChatToken,
  markChatChannelRead,
  openDirectMessage,
  useListChatChannels,
  useListChatMessages,
  useListTeamMembers,
  useQueryClient,
  type ChatChannelSync,
  type ChatMessageSync,
  type TeamMemberSync,
} from "@workspace/api-client-react";
import { Stack } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  clearCommsIdentity,
  flushOutbox,
  loadCommsIdentity,
  loadOutbox,
  registerFieldCommsCredentials,
  saveCommsIdentity,
  saveOutbox,
  type CommsIdentity,
  type OutboxEntry,
} from "@/lib/comms";
import { generateId } from "@/lib/format";

registerFieldCommsCredentials();

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}

export default function ChatScreen() {
  const [identity, setIdentity] = useState<CommsIdentity | null | undefined>(
    undefined,
  );
  const [expiredNotice, setExpiredNotice] = useState(false);

  useEffect(() => {
    void loadCommsIdentity().then(setIdentity);
  }, []);

  if (identity === undefined) {
    return (
      <CenteredFill>
        <ActivityIndicator size="large" />
      </CenteredFill>
    );
  }

  if (identity === null) {
    return (
      <SetupView
        notice={
          expiredNotice
            ? "Your chat sign-in expired. Sign in again to reconnect — any unsent messages will send after you're back in."
            : null
        }
        onDone={(next) => {
          setExpiredNotice(false);
          setIdentity(next);
        }}
      />
    );
  }

  return (
    <ChatView
      identity={identity}
      onReset={() => {
        void clearCommsIdentity();
        setIdentity(null);
      }}
      onAuthExpired={() => {
        // The server no longer accepts our member token (expired or
        // revoked). Drop the saved identity and show the sign-in screen;
        // the queued outbox is kept and flushes after the next sign-in.
        void clearCommsIdentity();
        setExpiredNotice(true);
        setIdentity(null);
      }}
    />
  );
}

function CenteredFill({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  return (
    <View
      style={[styles.centerFill, { backgroundColor: colors.background }]}
    >
      {children}
    </View>
  );
}

// ---------------------------------------------------------------------------
// One-time setup: license key + the member's own sign-in credentials. The
// server validates them and issues a member token — chat identity is proven,
// never picked from a list.
// ---------------------------------------------------------------------------

function SetupView({
  onDone,
  notice,
}: {
  onDone: (identity: CommsIdentity) => void;
  notice?: string | null;
}) {
  const colors = useColors();
  const [licenseKey, setLicenseKey] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedKey = licenseKey.trim().toUpperCase();
  const canSubmit = !!normalizedKey && !!identifier.trim() && !!password && !busy;

  const connect = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const result = await issueChatToken(
        { identifier: identifier.trim(), secret: password },
        { headers: { "x-license-key": normalizedKey } },
      );
      const next: CommsIdentity = {
        licenseKey: normalizedKey,
        memberKey: result.memberKey,
        memberName: result.memberName,
        memberToken: result.token,
      };
      await saveCommsIdentity(next);
      onDone(next);
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      setError(
        status === 401
          ? "Those credentials weren't recognized. Use the same email (or username) and password as the desktop app."
          : status === 403
            ? "That license key wasn't accepted. Check it with your office admin."
            : "Couldn't reach the server. Check your connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.setupContent}
      keyboardShouldPersistTaps="handled"
    >
      <Feather name="message-circle" size={40} color={colors.primary} />
      <Text style={[styles.setupTitle, { color: colors.foreground }]}>
        Connect to Team Chat
      </Text>
      {notice && (
        <Text
          testID="text-chat-signin-expired"
          style={[styles.setupError, { color: colors.warning }]}
        >
          {notice}
        </Text>
      )}
      <Text style={[styles.setupText, { color: colors.mutedForeground }]}>
        Enter your company's RentNotice Pro license key and sign in with the
        same email (or username) and password you use in the desktop app.
      </Text>

      <TextInput
        testID="input-license-key"
        value={licenseKey}
        onChangeText={setLicenseKey}
        placeholder="RNP-XXXX-XXXX-XXXX-XXXX"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="characters"
        autoCorrect={false}
        editable={!busy}
        style={[
          styles.setupInput,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
            color: colors.foreground,
          },
        ]}
      />
      <TextInput
        testID="input-chat-identifier"
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="Email or username"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        editable={!busy}
        style={[
          styles.setupInput,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
            color: colors.foreground,
          },
        ]}
      />
      <TextInput
        testID="input-chat-password"
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={colors.mutedForeground}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        editable={!busy}
        onSubmitEditing={() => void connect()}
        style={[
          styles.setupInput,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: colors.radius,
            color: colors.foreground,
          },
        ]}
      />

      {error && (
        <Text style={[styles.setupError, { color: colors.warning }]}>{error}</Text>
      )}

      <Pressable
        testID="button-connect-chat"
        onPress={() => void connect()}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.setupButton,
          {
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            opacity: pressed || !canSubmit ? 0.7 : 1,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.primaryForeground} />
        ) : (
          <Text style={[styles.setupButtonText, { color: colors.primaryForeground }]}>
            Sign In to Chat
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Main chat: conversation list + message pane
// ---------------------------------------------------------------------------

function ChatView({
  identity,
  onReset,
  onAuthExpired,
}: {
  identity: CommsIdentity;
  onReset: () => void;
  onAuthExpired: () => void;
}) {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { memberKey, memberName } = identity;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outbox, setOutbox] = useState<OutboxEntry[]>([]);
  const flushingRef = useRef(false);
  const outboxRef = useRef<OutboxEntry[]>([]);

  const invalidateComms = useCallback(() => {
    void queryClient.invalidateQueries({
      predicate: (q) =>
        typeof q.queryKey[0] === "string" &&
        (q.queryKey[0] as string).startsWith("/api/comms/"),
    });
  }, [queryClient]);

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

  const allChannels = channelsQuery.data ?? [];
  const channels = allChannels.filter((c) => !c.archived && c.kind === "channel");
  const dms = allChannels.filter(
    (c) => !c.archived && c.kind === "dm" && c.memberKeys.includes(memberKey),
  );
  const members = (membersQuery.data ?? []).filter((m) => m.active);
  const selected = allChannels.find((c) => c.id === selectedId) ?? null;

  const memberNameByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members) map.set(m.id, m.name);
    return map;
  }, [members]);

  const dmTitle = useCallback(
    (dm: ChatChannelSync) => {
      const otherKey = dm.memberKeys.find((k) => k !== memberKey);
      return (otherKey && memberNameByKey.get(otherKey)) || dm.name;
    },
    [memberKey, memberNameByKey],
  );

  // Hydrate + flush the offline outbox.
  useEffect(() => {
    void loadOutbox().then((entries) => {
      outboxRef.current = entries;
      setOutbox(entries);
    });
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current || outboxRef.current.length === 0) return;
    flushingRef.current = true;
    try {
      const { remaining, sentAny, authExpired } = await flushOutbox(
        outboxRef.current,
      );
      outboxRef.current = remaining;
      setOutbox(remaining);
      if (sentAny) invalidateComms();
      if (authExpired) onAuthExpired();
    } finally {
      flushingRef.current = false;
    }
  }, [invalidateComms, onAuthExpired]);

  // Retry queued sends whenever a poll succeeds (i.e. we're back online).
  useEffect(() => {
    if (channelsQuery.dataUpdatedAt) void flush();
  }, [channelsQuery.dataUpdatedAt, flush]);

  // Tokens expire (and rotate) server-side: when polling comes back 401,
  // the saved sign-in is no longer valid — return to the sign-in screen.
  //
  // Only act on settled errors: after re-signing in, this view remounts
  // while the query cache still holds the pre-sign-in 401. The remount
  // refetch is already running with the fresh token — reacting to the stale
  // error would immediately bounce the user back to the sign-in screen.
  const channelsError = channelsQuery.error;
  const membersError = membersQuery.error;
  const anyFetching = channelsQuery.isFetching || membersQuery.isFetching;
  useEffect(() => {
    if (anyFetching) return;
    const status =
      (channelsError as { status?: number } | null)?.status ??
      (membersError as { status?: number } | null)?.status;
    if (status === 401) onAuthExpired();
  }, [channelsError, membersError, anyFetching, onAuthExpired]);

  const send = useCallback(
    (channelId: string, body: string) => {
      const entry: OutboxEntry = {
        channelId,
        payload: {
          id: generateId(),
          senderKey: memberKey,
          senderName: memberName,
          body,
          createdAt: new Date().toISOString(),
        },
      };
      const next = [...outboxRef.current, entry];
      outboxRef.current = next;
      setOutbox(next);
      void saveOutbox(next);
      void flush();
    },
    [memberKey, memberName, flush],
  );

  const openDm = useCallback(
    async (other: TeamMemberSync) => {
      try {
        const channel = await openDirectMessage({
          memberKeys: [memberKey, other.id],
          memberNames: [memberName, other.name],
          createdByKey: memberKey,
          createdByName: memberName,
        });
        invalidateComms();
        setSelectedId(channel.id);
      } catch {
        // Silently keep the list; the user can retry.
      }
    },
    [memberKey, memberName, invalidateComms],
  );

  if (selected) {
    return (
      <MessagePane
        channel={selected}
        title={selected.kind === "dm" ? dmTitle(selected) : `#${selected.name}`}
        memberKey={memberKey}
        outbox={outbox}
        onBack={() => setSelectedId(null)}
        onSend={(body) => send(selected.id, body)}
        invalidateComms={invalidateComms}
      />
    );
  }

  const pendingCount = outbox.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Team Chat" }} />
      <ScrollView contentContainerStyle={styles.listContent}>
        {pendingCount > 0 && (
          <View
            style={[
              styles.pendingBar,
              { backgroundColor: colors.card, borderColor: colors.border, borderRadius: colors.radius },
            ]}
          >
            <Feather name="upload-cloud" size={15} color={colors.accent} />
            <Text style={[styles.pendingText, { color: colors.foreground }]}>
              {pendingCount} {pendingCount === 1 ? "message" : "messages"} waiting to send
            </Text>
          </View>
        )}

        {channelsQuery.isLoading ? (
          <View style={styles.centerPad}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <>
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              CHANNELS
            </Text>
            {channels.length === 0 && (
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No channels yet. An admin can create one from the desktop app.
              </Text>
            )}
            {channels.map((c) => (
              <ConversationRow
                key={c.id}
                icon="hash"
                title={c.name}
                channel={c}
                onPress={() => setSelectedId(c.id)}
              />
            ))}

            <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>
              DIRECT MESSAGES
            </Text>
            {dms.map((c) => (
              <ConversationRow
                key={c.id}
                icon="user"
                title={dmTitle(c)}
                channel={c}
                onPress={() => setSelectedId(c.id)}
              />
            ))}
            {members
              .filter(
                (m) =>
                  m.id !== memberKey &&
                  !dms.some((d) => d.memberKeys.includes(m.id)),
              )
              .map((m) => (
                <Pressable
                  key={m.id}
                  testID={`start-dm-${m.id}`}
                  onPress={() => void openDm(m)}
                  style={({ pressed }) => [
                    styles.convRow,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderRadius: colors.radius,
                      opacity: pressed ? 0.7 : 1,
                    },
                  ]}
                >
                  <Feather name="user-plus" size={17} color={colors.mutedForeground} />
                  <Text style={[styles.convTitle, { color: colors.mutedForeground }]}>
                    {m.name}
                  </Text>
                </Pressable>
              ))}

            <Pressable onPress={onReset} hitSlop={8} testID="button-switch-chat-user">
              <Text style={[styles.setupSwitchLink, { color: colors.mutedForeground }]}>
                Signed in to chat as {memberName} · Switch
              </Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ConversationRow({
  icon,
  title,
  channel,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  title: string;
  channel: ChatChannelSync;
  onPress: () => void;
}) {
  const colors = useColors();
  return (
    <Pressable
      testID={`conversation-${channel.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.convRow,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Feather name={icon} size={17} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.convTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
        {channel.lastMessagePreview && (
          <Text
            style={[styles.convPreview, { color: colors.mutedForeground }]}
            numberOfLines={1}
          >
            {channel.lastMessagePreview}
          </Text>
        )}
      </View>
      {channel.unreadCount > 0 && (
        <View
          testID={`unread-badge-${channel.id}`}
          style={[styles.unreadBadge, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.unreadText, { color: colors.primaryForeground }]}>
            {channel.unreadCount > 99 ? "99+" : channel.unreadCount}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

function MessagePane({
  channel,
  title,
  memberKey,
  outbox,
  onBack,
  onSend,
  invalidateComms,
}: {
  channel: ChatChannelSync;
  title: string;
  memberKey: string;
  outbox: OutboxEntry[];
  onBack: () => void;
  onSend: (body: string) => void;
  invalidateComms: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState("");
  const lastMarkedRef = useRef<string | null>(null);

  const messagesQuery = useListChatMessages(
    channel.id,
    { limit: 200, memberKey },
    {
      query: {
        queryKey: getListChatMessagesQueryKey(channel.id, { limit: 200, memberKey }),
        refetchInterval: 4_000,
      },
    },
  );
  const serverMessages = messagesQuery.data ?? [];

  const pendingHere = useMemo(
    () =>
      outbox
        .filter(
          (e) =>
            e.channelId === channel.id &&
            !serverMessages.some((m) => m.id === e.payload.id),
        )
        .map((e) => ({
          id: e.payload.id,
          channelId: e.channelId,
          senderKey: e.payload.senderKey,
          senderName: e.payload.senderName,
          body: e.payload.body,
          createdAt: e.payload.createdAt,
          pending: true as const,
        })),
    [outbox, channel.id, serverMessages],
  );

  type Row = (ChatMessageSync & { pending?: boolean });
  const rows: Row[] = useMemo(
    () => [...serverMessages, ...pendingHere],
    [serverMessages, pendingHere],
  );
  const inverted = useMemo(() => [...rows].reverse(), [rows]);

  // Mark read when the newest server message changes while this pane is open.
  useEffect(() => {
    const newest = serverMessages[serverMessages.length - 1];
    const marker = newest ? newest.id : "empty";
    if (lastMarkedRef.current === marker) return;
    lastMarkedRef.current = marker;
    void markChatChannelRead(channel.id, {
      memberKey,
      lastReadAt: new Date().toISOString(),
    })
      .then(() => invalidateComms())
      .catch(() => {
        // Offline — unread counts will settle on the next successful poll.
        lastMarkedRef.current = null;
      });
  }, [serverMessages, channel.id, memberKey, invalidateComms]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    setDraft("");
    onSend(body);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <Stack.Screen options={{ title }} />
      <View
        style={[
          styles.paneHeader,
          { borderBottomColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Pressable onPress={onBack} hitSlop={10} testID="button-chat-back">
          <Feather name="arrow-left" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.paneTitle, { color: colors.foreground }]} numberOfLines={1}>
          {title}
        </Text>
      </View>

      {messagesQuery.isLoading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={inverted}
          inverted
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messageList}
          renderItem={({ item }) => {
            const own = item.senderKey === memberKey;
            return (
              <View
                style={[styles.msgRow, own ? styles.msgRowOwn : styles.msgRowOther]}
              >
                <View
                  style={[
                    styles.bubble,
                    {
                      backgroundColor: own ? colors.primary : colors.card,
                      borderRadius: colors.radius * 1.5,
                      borderColor: colors.border,
                      borderWidth: own ? 0 : 1,
                      opacity: item.pending ? 0.6 : 1,
                    },
                  ]}
                >
                  {!own && (
                    <Text style={[styles.msgSender, { color: colors.primary }]}>
                      {item.senderName}
                    </Text>
                  )}
                  <Text
                    style={[
                      styles.msgBody,
                      { color: own ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {item.body}
                  </Text>
                  <Text
                    style={[
                      styles.msgTime,
                      {
                        color: own
                          ? colors.primaryForeground
                          : colors.mutedForeground,
                        opacity: 0.75,
                      },
                    ]}
                  >
                    {item.pending ? "Sending…" : formatTime(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyPane}>
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No messages yet. Say hello!
              </Text>
            </View>
          }
        />
      )}

      <View
        style={[
          styles.composer,
          {
            borderTopColor: colors.border,
            backgroundColor: colors.card,
            paddingBottom: Math.max(insets.bottom, 10),
          },
        ]}
      >
        <TextInput
          testID="input-chat-message"
          value={draft}
          onChangeText={setDraft}
          placeholder="Message"
          placeholderTextColor={colors.mutedForeground}
          multiline
          style={[
            styles.composerInput,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
              color: colors.foreground,
            },
          ]}
        />
        <Pressable
          testID="button-send-message"
          onPress={submit}
          disabled={!draft.trim()}
          style={({ pressed }) => [
            styles.sendBtn,
            {
              backgroundColor: colors.primary,
              opacity: pressed || !draft.trim() ? 0.6 : 1,
            },
          ]}
        >
          <Feather name="send" size={17} color={colors.primaryForeground} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  centerPad: { paddingVertical: 60, alignItems: "center" },
  setupContent: {
    padding: 24,
    gap: 12,
    alignItems: "center",
  },
  setupTitle: { fontFamily: fonts.bold, fontSize: 20, marginTop: 4 },
  setupText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
  setupInput: {
    alignSelf: "stretch",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.medium,
    fontSize: 15,
    textAlign: "center",
  },
  setupError: { fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  setupButton: {
    alignSelf: "stretch",
    alignItems: "center",
    paddingVertical: 13,
  },
  setupButtonText: { fontFamily: fonts.semibold, fontSize: 15 },
  setupSwitchLink: {
    fontFamily: fonts.medium,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 14,
  },
  listContent: { padding: 16, gap: 8, paddingBottom: 40 },
  pendingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  pendingText: { fontFamily: fonts.medium, fontSize: 13 },
  sectionLabel: {
    fontFamily: fonts.bold,
    fontSize: 11.5,
    letterSpacing: 0.8,
    marginTop: 10,
    marginBottom: 2,
  },
  convRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  convTitle: { fontFamily: fonts.semibold, fontSize: 15 },
  convPreview: { fontFamily: fonts.regular, fontSize: 12.5, marginTop: 1 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  unreadText: { fontFamily: fonts.bold, fontSize: 11.5 },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 13.5,
    lineHeight: 19,
  },
  paneHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  paneTitle: { fontFamily: fonts.bold, fontSize: 16, flex: 1 },
  messageList: { paddingHorizontal: 14, paddingVertical: 12, gap: 6 },
  msgRow: { flexDirection: "row", marginVertical: 2 },
  msgRowOwn: { justifyContent: "flex-end" },
  msgRowOther: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  msgSender: { fontFamily: fonts.semibold, fontSize: 12 },
  msgBody: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 20 },
  msgTime: { fontFamily: fonts.regular, fontSize: 10.5, alignSelf: "flex-end" },
  emptyPane: {
    // Inverted FlatList flips children; flip back for the empty state.
    transform: [{ scaleY: -1 }],
    paddingVertical: 60,
    alignItems: "center",
  },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  composerInput: {
    flex: 1,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    fontFamily: fonts.regular,
    fontSize: 14.5,
    maxHeight: 110,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
