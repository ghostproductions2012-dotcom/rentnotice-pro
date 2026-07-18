import { StyleSheet, Text, View } from "react-native";

import { fonts } from "@/constants/fonts";
import { useColors } from "@/hooks/useColors";
import { WO_STATUS_LABELS } from "@/lib/format";
import type { WorkOrderSyncStatus } from "@workspace/api-client-react";

export function WorkOrderStatusBadge({
  status,
  size = "md",
}: {
  status: WorkOrderSyncStatus;
  size?: "sm" | "md";
}) {
  const colors = useColors();

  const palette: Record<WorkOrderSyncStatus, { bg: string; fg: string }> = {
    new: { bg: colors.secondary, fg: colors.foreground },
    assigned: { bg: colors.accent, fg: colors.accentForeground },
    in_progress: { bg: colors.primary, fg: colors.primaryForeground },
    on_hold: { bg: colors.warning, fg: colors.warningForeground },
    completed: { bg: colors.success, fg: colors.successForeground },
    cancelled: { bg: colors.muted, fg: colors.mutedForeground },
  };

  const { bg, fg } = palette[status];
  const isSm = size === "sm";

  return (
    <View
      style={[
        styles.badge,
        {
          backgroundColor: bg,
          borderRadius: colors.radius * 2,
          paddingHorizontal: isSm ? 8 : 10,
          paddingVertical: isSm ? 3 : 5,
        },
      ]}
    >
      <Text
        style={[styles.text, { color: fg, fontSize: isSm ? 11 : 12 }]}
        numberOfLines={1}
      >
        {WO_STATUS_LABELS[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
  },
  text: {
    fontFamily: fonts.semibold,
    letterSpacing: 0.2,
  },
});
