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

import { WorkOrderStatusBadge } from "@/components/WorkOrderStatusBadge";
import { fonts } from "@/constants/fonts";
import { useFieldSync } from "@/context/FieldSyncContext";
import { useColors } from "@/hooks/useColors";
import {
  WO_PRIORITY_LABELS,
  formatCoords,
  formatDeadline,
  formatTimestamp,
  workOrderCategoryLabel,
} from "@/lib/format";

const WEB_BOTTOM_INSET = Platform.OS === "web" ? 34 : 0;

function haptic(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(style);
  }
}

export default function WorkOrderDetailScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getWorkOrder, isHydrated, updateWorkOrder } = useFieldSync();

  const [completeModal, setCompleteModal] = useState(false);
  const [notes, setNotes] = useState("");

  const workOrder = getWorkOrder(id);

  if (!workOrder) {
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        {!isHydrated ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <Feather name="alert-circle" size={44} color={colors.mutedForeground} />
            <Text style={[styles.notFoundTitle, { color: colors.foreground }]}>
              Work order not found
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

  const startWork = () => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    updateWorkOrder(workOrder.id, { status: "in_progress" });
  };

  const putOnHold = () => {
    haptic(Haptics.ImpactFeedbackStyle.Light);
    updateWorkOrder(workOrder.id, { status: "on_hold" });
  };

  const resumeWork = () => {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    updateWorkOrder(workOrder.id, { status: "in_progress" });
  };

  const confirmComplete = () => {
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    updateWorkOrder(workOrder.id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      fieldNotes: notes.trim(),
    });
    setCompleteModal(false);
    setNotes("");
  };

  const canStart =
    workOrder.status === "new" || workOrder.status === "assigned";
  const canHold = workOrder.status === "in_progress";
  const canResume = workOrder.status === "on_hold";
  const canComplete =
    workOrder.status === "assigned" ||
    workOrder.status === "in_progress" ||
    workOrder.status === "on_hold";
  const isDone =
    workOrder.status === "completed" || workOrder.status === "cancelled";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: "Work Order" }} />
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
          <View style={styles.badgeRow}>
            <WorkOrderStatusBadge status={workOrder.status} />
            <View
              style={[
                styles.priorityTag,
                {
                  backgroundColor:
                    workOrder.priority === "emergency" ||
                    workOrder.priority === "high"
                      ? colors.destructive
                      : colors.muted,
                  borderRadius: colors.radius,
                },
              ]}
            >
              <Text
                style={[
                  styles.priorityTagText,
                  {
                    color:
                      workOrder.priority === "emergency" ||
                      workOrder.priority === "high"
                        ? colors.destructiveForeground
                        : colors.mutedForeground,
                  },
                ]}
              >
                {WO_PRIORITY_LABELS[workOrder.priority]}
              </Text>
            </View>
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {workOrder.title}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {workOrderCategoryLabel(workOrder.category)}
            {workOrder.tenantNames ? ` • ${workOrder.tenantNames}` : ""}
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
              workOrder.unit
                ? `${workOrder.propertyAddress}\nUnit ${workOrder.unit}`
                : workOrder.propertyAddress
            }
          />
          <Divider />
          <DetailRow
            icon="calendar"
            label="Due"
            value={formatDeadline(workOrder.dueDate)}
          />
          {workOrder.description.trim().length > 0 && (
            <>
              <Divider />
              <DetailRow
                icon="file-text"
                label="Description"
                value={workOrder.description}
              />
            </>
          )}
          {workOrder.vendorName.trim().length > 0 && (
            <>
              <Divider />
              <DetailRow
                icon="tool"
                label="Vendor"
                value={
                  workOrder.vendorContact
                    ? `${workOrder.vendorName}\n${workOrder.vendorContact}`
                    : workOrder.vendorName
                }
              />
            </>
          )}
        </View>

        {/* Completion summary */}
        {workOrder.status === "completed" && (
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
            {workOrder.completedAt && (
              <DetailRow
                icon="check-circle"
                label="Completed"
                value={formatTimestamp(workOrder.completedAt)}
              />
            )}
            {workOrder.fieldNotes.trim().length > 0 && (
              <>
                <Divider />
                <DetailRow
                  icon="edit-3"
                  label="Field notes"
                  value={workOrder.fieldNotes}
                />
              </>
            )}
          </View>
        )}

        {/* Photos section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
            Photos
          </Text>
          <Text style={[styles.sectionCount, { color: colors.mutedForeground }]}>
            {workOrder.photos.length}
          </Text>
        </View>

        {workOrder.photos.length === 0 ? (
          <View
            style={[
              styles.photosEmpty,
              { borderColor: colors.border, borderRadius: colors.radius * 1.5 },
            ]}
          >
            <Feather name="camera-off" size={30} color={colors.mutedForeground} />
            <Text
              style={[styles.photosEmptyText, { color: colors.mutedForeground }]}
            >
              No photos captured yet
            </Text>
          </View>
        ) : (
          <View style={styles.grid}>
            {workOrder.photos.map((p) => (
              <View
                key={p.id}
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
                  source={{ uri: p.photoDataUrl }}
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
                      {formatTimestamp(p.capturedAt)}
                    </Text>
                  </View>
                  <View style={styles.thumbMetaRow}>
                    <Feather name="map-pin" size={11} color={colors.mutedForeground} />
                    <Text
                      style={[styles.thumbMetaText, { color: colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {formatCoords(p.latitude, p.longitude)}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Bottom action bar */}
      {!isDone && (
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
            testID="capture-photo-button"
            onPress={() => {
              haptic(Haptics.ImpactFeedbackStyle.Light);
              router.push(
                `/assignment/capture?id=${workOrder.id}&kind=work-order`,
              );
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
              Photo
            </Text>
          </Pressable>

          {canStart && (
            <Pressable
              testID="start-work-button"
              onPress={startWork}
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
                Start work
              </Text>
            </Pressable>
          )}

          {canHold && (
            <Pressable
              testID="hold-work-button"
              onPress={putOnHold}
              style={({ pressed }) => [
                styles.primaryBtn,
                {
                  backgroundColor: colors.warning,
                  borderRadius: colors.radius,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <Feather name="pause" size={18} color={colors.warningForeground} />
              <Text style={[styles.primaryBtnText, { color: colors.warningForeground }]}>
                Hold
              </Text>
            </Pressable>
          )}

          {canResume && (
            <Pressable
              testID="resume-work-button"
              onPress={resumeWork}
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
                Resume
              </Text>
            </Pressable>
          )}

          {canComplete && (
            <Pressable
              testID="complete-work-button"
              onPress={() => {
                haptic(Haptics.ImpactFeedbackStyle.Light);
                setCompleteModal(true);
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
                Complete
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Complete modal */}
      <Modal
        visible={completeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setCompleteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setCompleteModal(false)}
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
              Mark work complete
            </Text>

            <TextInput
              testID="field-notes-input"
              value={notes}
              onChangeText={setNotes}
              placeholder="What was done? (optional)"
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
              testID="confirm-complete-button"
              onPress={confirmComplete}
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
                Confirm complete
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
      <View style={[styles.detailIcon, { backgroundColor: colors.secondary }]}>
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
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  priorityTag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  priorityTagText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  title: {
    fontFamily: fonts.bold,
    fontSize: 20,
    lineHeight: 26,
  },
  subtitle: {
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
  photosEmpty: {
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 32,
  },
  photosEmptyText: {
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 14,
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
  notesInput: {
    borderWidth: 1,
    minHeight: 72,
    padding: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlignVertical: "top",
  },
});
