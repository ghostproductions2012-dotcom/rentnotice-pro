import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { StatusBadge } from "@/components/StatusBadge";
import { fonts } from "@/constants/fonts";
import { useFieldSync } from "@/context/FieldSyncContext";
import { useColors } from "@/hooks/useColors";
import {
  SERVICE_METHODS,
  SERVICE_METHOD_LABELS,
  formatCoords,
  formatDeadline,
  formatMoney,
  formatTimestamp,
  noticeTypeLabel,
} from "@/lib/format";
import type { FieldAssignmentSyncServiceMethod } from "@workspace/api-client-react";

const WEB_BOTTOM_INSET = Platform.OS === "web" ? 34 : 0;

function haptic(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(style);
  }
}

export default function AssignmentDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getAssignment, isHydrated, updateAssignment } = useFieldSync();

  const [serveModal, setServeModal] = useState(false);
  const [method, setMethod] =
    useState<NonNullable<FieldAssignmentSyncServiceMethod>>("personal");
  const [notes, setNotes] = useState("");

  const assignment = getAssignment(id);

  if (!assignment) {
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        {!isHydrated ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <Feather name="alert-circle" size={44} color={colors.mutedForeground} />
            <Text style={[styles.notFoundTitle, { color: colors.foreground }]}>
              Assignment not found
            </Text>
            <Pressable
              testID="back-to-list"
              onPress={() => router.back()}
              style={[
                styles.primaryBtn,
                { backgroundColor: colors.primary, borderRadius: colors.radius },
              ]}
            >
              <Text
                style={[styles.primaryBtnText, { color: colors.primaryForeground }]}
              >
                Go back
              </Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const tenants =
    assignment.tenantNames.length > 0
      ? assignment.tenantNames.join(", ")
      : "Unknown tenant";
  const money = formatMoney(assignment.totalAmountCents);

  const startService = () => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    updateAssignment(assignment.id, { status: "in_progress" });
  };

  const confirmServed = () => {
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    updateAssignment(assignment.id, {
      status: "completed",
      serviceMethod: method,
      completedAt: new Date().toISOString(),
      serverNotes: notes.trim(),
    });
    setServeModal(false);
    setNotes("");
  };

  const canStart = assignment.status === "assigned";
  const canServe =
    assignment.status === "assigned" || assignment.status === "in_progress";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Assignment" }} />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 + WEB_BOTTOM_INSET },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header card */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <StatusBadge status={assignment.status} />
          <Text style={[styles.noticeType, { color: colors.foreground }]}>
            {noticeTypeLabel(assignment.noticeType)}
          </Text>
          <Text style={[styles.tenants, { color: colors.mutedForeground }]}>
            {tenants}
          </Text>
        </View>

        {/* Details */}
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius: colors.radius * 1.5,
            },
          ]}
        >
          <DetailRow
            icon="map-pin"
            label="Property"
            value={
              assignment.unit
                ? `${assignment.propertyAddress}\nUnit ${assignment.unit}`
                : assignment.propertyAddress
            }
          />
          <Divider />
          <DetailRow
            icon="calendar"
            label="Deadline"
            value={formatDeadline(assignment.deadlineDate)}
          />
          {money && (
            <>
              <Divider />
              <DetailRow icon="dollar-sign" label="Amount due" value={money} />
            </>
          )}
          {assignment.instructions?.trim().length > 0 && (
            <>
              <Divider />
              <DetailRow
                icon="file-text"
                label="Instructions"
                value={assignment.instructions}
              />
            </>
          )}
        </View>

        {/* Completion summary */}
        {assignment.status === "completed" && (
          <View
            style={[
              styles.card,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius * 1.5,
              },
            ]}
          >
            <DetailRow
              icon="check-circle"
              label="Served via"
              value={
                assignment.serviceMethod
                  ? SERVICE_METHOD_LABELS[assignment.serviceMethod]
                  : "—"
              }
            />
            {assignment.completedAt && (
              <>
                <Divider />
                <DetailRow
                  icon="clock"
                  label="Completed"
                  value={formatTimestamp(assignment.completedAt)}
                />
              </>
            )}
            {assignment.serverNotes?.trim().length > 0 && (
              <>
                <Divider />
                <DetailRow
                  icon="edit-3"
                  label="Server notes"
                  value={assignment.serverNotes}
                />
              </>
            )}
          </View>
        )}

        {/* Evidence section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Evidence
          </Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
            {assignment.evidence.length}
          </Text>
        </View>

        {assignment.evidence.length === 0 ? (
          <View
            style={[
              styles.evidenceEmpty,
              { borderColor: colors.border, borderRadius: colors.radius * 1.5 },
            ]}
          >
            <Feather name="camera-off" size={30} color={colors.mutedForeground} />
            <Text
              style={[styles.evidenceEmptyText, { color: colors.mutedForeground }]}
            >
              No photos captured yet
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {assignment.evidence.map((ev) => (
              <View
                key={ev.id}
                style={[
                  styles.thumb,
                  {
                    backgroundColor: colors.card,
                    borderColor: colors.border,
                    borderRadius: colors.radius,
                  },
                ]}
              >
                <Image
                  source={{ uri: ev.photoDataUrl }}
                  style={styles.thumbImage}
                  contentFit="cover"
                  transition={150}
                />
                <View style={styles.thumbMeta}>
                  <View style={styles.thumbMetaRow}>
                    <Feather name="clock" size={11} color={colors.mutedForeground} />
                    <Text
                      style={[styles.thumbMetaText, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {formatTimestamp(ev.capturedAt)}
                    </Text>
                  </View>
                  <View style={styles.thumbMetaRow}>
                    <Feather name="map-pin" size={11} color={colors.mutedForeground} />
                    <Text
                      style={[styles.thumbMetaText, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {formatCoords(ev.latitude, ev.longitude)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, 12) + WEB_BOTTOM_INSET,
          },
        ]}
      >
        <Pressable
          testID="capture-evidence-button"
          onPress={() => {
            haptic(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/assignment/capture?id=${assignment.id}`);
          }}
          style={({ pressed }) => [
            styles.captureBtn,
            {
              backgroundColor: colors.accent,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
        >
          <Feather name="camera" size={19} color={colors.accentForeground} />
          <Text style={[styles.captureBtnText, { color: colors.accentForeground }]}>
            Capture evidence
          </Text>
        </Pressable>

        {canStart && (
          <Pressable
            testID="start-service-button"
            onPress={startService}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="play" size={18} color={colors.primaryForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.primaryForeground }]}>
              Start service
            </Text>
          </Pressable>
        )}

        {canServe && (
          <Pressable
            testID="mark-served-button"
            onPress={() => {
              haptic(Haptics.ImpactFeedbackStyle.Light);
              setServeModal(true);
            }}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: colors.success,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="check" size={19} color={colors.successForeground} />
            <Text style={[styles.primaryBtnText, { color: colors.successForeground }]}>
              Mark served
            </Text>
          </Pressable>
        )}
      </View>

      {/* Mark served modal */}
      <Modal
        visible={serveModal}
        transparent
        animationType="slide"
        onRequestClose={() => setServeModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setServeModal(false)}
          />
          <View
            style={[
              styles.modalSheet,
              {
                backgroundColor: colors.card,
                borderTopLeftRadius: colors.radius * 2,
                borderTopRightRadius: colors.radius * 2,
                paddingBottom: Math.max(insets.bottom, 16) + WEB_BOTTOM_INSET,
              },
            ]}
          >
            <View style={styles.modalHandleWrap}>
              <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            </View>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              How was it served?
            </Text>

            <View style={styles.methodList}>
              {SERVICE_METHODS.map((m) => {
                const active = method === m.value;
                return (
                  <Pressable
                    key={m.value}
                    testID={`method-${m.value}`}
                    onPress={() => setMethod(m.value)}
                    style={[
                      styles.methodItem,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.secondary : colors.card,
                        borderRadius: colors.radius,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.methodText,
                        {
                          color: colors.foreground,
                          fontFamily: active ? fonts.semibold : fonts.regular,
                        },
                      ]}
                    >
                      {m.label}
                    </Text>
                    {active && (
                      <Feather name="check" size={18} color={colors.primary} />
                    )}
                  </Pressable>
                );
              })}
            </View>

            <TextInput
              testID="server-notes-input"
              value={notes}
              onChangeText={setNotes}
              placeholder="Server notes (optional)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.notesInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  borderRadius: colors.radius,
                  backgroundColor: colors.background,
                },
              ]}
            />

            <Pressable
              testID="confirm-served-button"
              onPress={confirmServed}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: colors.success,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                  marginTop: 4,
                },
              ]}
            >
              <Feather name="check" size={19} color={colors.successForeground} />
              <Text
                style={[styles.primaryBtnText, { color: colors.successForeground }]}
              >
                Confirm served
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
}) {
  const colors = useColors();
  return (
    <View style={styles.detailRow}>
      <View
        style={[styles.detailIcon, { backgroundColor: colors.secondary }]}
      >
        <Feather name={icon} size={16} color={colors.foreground} />
      </View>
      <View style={styles.detailBody}>
        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>
          {label}
        </Text>
        <Text style={[styles.detailValue, { color: colors.foreground }]}>
          {value}
        </Text>
      </View>
    </View>
  );
}

function Divider() {
  const colors = useColors();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    padding: 16,
    gap: 16,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 24,
  },
  notFoundTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
  },
  card: {
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  noticeType: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
  },
  tenants: {
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  detailRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  detailIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  detailBody: {
    flex: 1,
    gap: 2,
  },
  detailLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  detailValue: {
    fontFamily: fonts.medium,
    fontSize: 15,
    lineHeight: 21,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontFamily: fonts.bold,
    fontSize: 17,
  },
  sectionCount: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  evidenceEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 32,
  },
  evidenceEmptyText: {
    fontFamily: fonts.medium,
    fontSize: 14,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  thumb: {
    width: "47%",
    flexGrow: 1,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbImage: {
    width: "100%",
    aspectRatio: 1,
    backgroundColor: "transparent",
  },
  thumbMeta: {
    padding: 8,
    gap: 4,
  },
  thumbMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  thumbMetaText: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 11.5,
  },
  actionBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  captureBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  captureBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalSheet: {
    padding: 20,
    gap: 14,
  },
  modalHandleWrap: {
    alignItems: "center",
    marginBottom: 2,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalTitle: {
    fontFamily: fonts.bold,
    fontSize: 19,
  },
  methodList: {
    gap: 8,
  },
  methodItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  methodText: {
    fontSize: 15,
  },
  notesInput: {
    borderWidth: 1,
    minHeight: 72,
    padding: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlignVertical: "top",
  },
});
