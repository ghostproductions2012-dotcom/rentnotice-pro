import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { WorkOrderStatusBadge } from "@/components/WorkOrderStatusBadge";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import {
  WO_PRIORITY_LABELS,
  formatDeadline,
  workOrderCategoryLabel,
} from "@/lib/format";
import type { WorkOrderSync } from "@workspace/api-client-react";

export function WorkOrderCard({
  workOrder,
  onPress,
}: {
  workOrder: WorkOrderSync;
  onPress: () => void;
}) {
  const colors = useColors();
  const photoCount = workOrder.photos.length;
  const fullAddress = workOrder.unit
    ? `${workOrder.propertyAddress}, Unit ${workOrder.unit}`
    : workOrder.propertyAddress;
  const isEmergency = workOrder.priority === "emergency";
  const isHigh = workOrder.priority === "high";

  return (
    <Pressable
      testID={`work-order-card-${workOrder.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isEmergency ? colors.destructive : colors.border,
          borderRadius: colors.radius * 1.5,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          style={[styles.title, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {workOrder.title}
        </Text>
        <WorkOrderStatusBadge status={workOrder.status} size="sm" />
      </View>

      <View style={styles.metaRow}>
        <Feather name="map-pin" size={14} color={colors.mutedForeground} />
        <Text
          style={[styles.address, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {fullAddress}
        </Text>
      </View>

      <View style={styles.badgeRow}>
        <View
          style={[
            styles.tag,
            {
              backgroundColor:
                isEmergency || isHigh ? colors.destructive : colors.muted,
              borderRadius: colors.radius,
            },
          ]}
        >
          <Text
            style={[
              styles.tagText,
              {
                color:
                  isEmergency || isHigh
                    ? colors.destructiveForeground
                    : colors.mutedForeground,
              },
            ]}
          >
            {WO_PRIORITY_LABELS[workOrder.priority]}
          </Text>
        </View>
        <View
          style={[
            styles.tag,
            { backgroundColor: colors.muted, borderRadius: colors.radius },
          ]}
        >
          <Text style={[styles.tagText, { color: colors.mutedForeground }]}>
            {workOrderCategoryLabel(workOrder.category)}
          </Text>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.footerItem}>
          <Feather name="calendar" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            {formatDeadline(workOrder.dueDate)}
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="camera" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            {photoCount} {photoCount === 1 ? "photo" : "photos"}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
    gap: 10,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bold,
    fontSize: 16,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  address: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 13,
    lineHeight: 18,
  },
  badgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tag: {
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tagText: {
    fontFamily: fonts.semibold,
    fontSize: 11,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    paddingTop: 10,
    marginTop: 2,
  },
  footerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerText: {
    fontFamily: fonts.medium,
    fontSize: 12.5,
  },
});
