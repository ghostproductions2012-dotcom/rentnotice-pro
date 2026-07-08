import { Feather } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { StatusBadge } from "@/components/StatusBadge";
import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { formatDeadline, noticeTypeLabel } from "@/lib/format";
import type { FieldAssignmentSync } from "@workspace/api-client-react";

export function AssignmentCard({
  assignment,
  onPress,
}: {
  assignment: FieldAssignmentSync;
  onPress: () => void;
}) {
  const colors = useColors();
  const evidenceCount = assignment.evidence.length;
  const tenants =
    assignment.tenantNames.length > 0
      ? assignment.tenantNames.join(", ")
      : "Unknown tenant";
  const fullAddress = assignment.unit
    ? `${assignment.propertyAddress}, Unit ${assignment.unit}`
    : assignment.propertyAddress;

  return (
    <Pressable
      testID={`assignment-card-${assignment.id}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius: colors.radius * 1.5,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.topRow}>
        <Text
          style={[styles.tenants, { color: colors.foreground }]}
          numberOfLines={1}
        >
          {tenants}
        </Text>
        <StatusBadge status={assignment.status} size="sm" />
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

      <Text
        style={[styles.noticeType, { color: colors.foreground }]}
        numberOfLines={2}
      >
        {noticeTypeLabel(assignment.noticeType)}
      </Text>

      <View
        style={[styles.footer, { borderTopColor: colors.border }]}
      >
        <View style={styles.footerItem}>
          <Feather name="calendar" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            {formatDeadline(assignment.deadlineDate)}
          </Text>
        </View>
        <View style={styles.footerItem}>
          <Feather name="camera" size={14} color={colors.mutedForeground} />
          <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
            {evidenceCount} {evidenceCount === 1 ? "photo" : "photos"}
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
  tenants: {
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
  noticeType: {
    fontFamily: fonts.medium,
    fontSize: 14,
    lineHeight: 19,
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
