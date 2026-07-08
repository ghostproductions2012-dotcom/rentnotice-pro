import { Feather } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { AssignmentCard } from "@/components/AssignmentCard";
import { fonts } from "@/constants/fonts";
import { useFieldSync } from "@/context/FieldSyncContext";
import { useColors } from "@/hooks/useColors";
import type { FieldAssignmentSyncStatus } from "@workspace/api-client-react";

const WEB_BOTTOM_INSET = Platform.OS === "web" ? 34 : 0;

type FilterValue = FieldAssignmentSyncStatus | "all";

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "assigned", label: "Assigned" },
  { value: "in_progress", label: "Active" },
  { value: "completed", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

function HeaderSyncButton() {
  const colors = useColors();
  const { isOffline, isSyncing, pendingCount, syncNow } = useFieldSync();

  const iconColor = isOffline
    ? colors.warning
    : pendingCount > 0
      ? colors.accent
      : colors.mutedForeground;

  return (
    <Pressable
      testID="header-sync-button"
      onPress={() => void syncNow()}
      disabled={isSyncing}
      hitSlop={10}
      style={styles.headerButton}
    >
      {isSyncing ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather
          name={isOffline ? "cloud-off" : "refresh-cw"}
          size={20}
          color={iconColor}
        />
      )}
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const router = useRouter();
  const {
    assignments,
    isOffline,
    isSyncing,
    isHydrated,
    pendingCount,
    syncNow,
  } = useFieldSync();
  const [filter, setFilter] = useState<FilterValue>("all");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: assignments.length };
    for (const a of assignments) c[a.status] = (c[a.status] ?? 0) + 1;
    return c;
  }, [assignments]);

  const filtered = useMemo(() => {
    const list =
      filter === "all"
        ? assignments
        : assignments.filter((a) => a.status === filter);
    return [...list].sort((a, b) => {
      const da = a.deadlineDate ? new Date(a.deadlineDate).getTime() : Infinity;
      const db = b.deadlineDate ? new Date(b.deadlineDate).getTime() : Infinity;
      return da - db;
    });
  }, [assignments, filter]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ headerRight: () => <HeaderSyncButton /> }} />

      {isOffline && (
        <View
          testID="offline-banner"
          style={[styles.banner, { backgroundColor: colors.warning }]}
        >
          <Feather name="cloud-off" size={15} color={colors.warningForeground} />
          <Text
            style={[styles.bannerText, { color: colors.warningForeground }]}
          >
            Offline — showing saved data
          </Text>
        </View>
      )}

      {pendingCount > 0 && (
        <View
          testID="sync-queue-indicator"
          style={[
            styles.syncBar,
            { backgroundColor: colors.card, borderBottomColor: colors.border },
          ]}
        >
          <View style={styles.syncBarLeft}>
            <Feather name="upload-cloud" size={16} color={colors.accent} />
            <Text style={[styles.syncBarText, { color: colors.foreground }]}>
              {pendingCount} {pendingCount === 1 ? "change" : "changes"} pending
            </Text>
          </View>
          <Pressable
            testID="sync-now-button"
            onPress={() => void syncNow()}
            disabled={isSyncing}
            style={({ pressed }) => [
              styles.syncNowBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed || isSyncing ? 0.7 : 1,
              },
            ]}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Text
                style={[
                  styles.syncNowText,
                  { color: colors.primaryForeground },
                ]}
              >
                Sync now
              </Text>
            )}
          </Pressable>
        </View>
      )}

      <View style={styles.filterWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTERS.map((f) => {
            const active = filter === f.value;
            const count = counts[f.value] ?? 0;
            return (
              <Pressable
                key={f.value}
                testID={`filter-${f.value}`}
                onPress={() => setFilter(f.value)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    borderRadius: colors.radius * 2,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color: active
                        ? colors.primaryForeground
                        : colors.mutedForeground,
                    },
                  ]}
                >
                  {f.label}
                  {count > 0 ? `  ${count}` : ""}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {!isHydrated ? (
        <View style={styles.centerFill}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <AssignmentCard
              assignment={item}
              onPress={() => router.push(`/assignment/${item.id}`)}
            />
          )}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: 32 + WEB_BOTTOM_INSET },
            filtered.length === 0 && styles.listEmpty,
          ]}
          scrollEnabled={filtered.length > 0}
          refreshControl={
            <RefreshControl
              refreshing={isSyncing}
              onRefresh={() => void syncNow()}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Feather
                name="clipboard"
                size={44}
                color={colors.mutedForeground}
              />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                No assignments
              </Text>
              <Text
                style={[styles.emptyText, { color: colors.mutedForeground }]}
              >
                {filter === "all"
                  ? "Pull down to sync your assigned notice-service jobs."
                  : "No assignments match this filter."}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerButton: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 8,
  },
  bannerText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  syncBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  syncBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  syncBarText: {
    fontFamily: fonts.medium,
    fontSize: 13.5,
  },
  syncNowBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    minWidth: 84,
    alignItems: "center",
    justifyContent: "center",
  },
  syncNowText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  filterWrap: {
    paddingVertical: 12,
  },
  filterRow: {
    paddingHorizontal: 16,
    gap: 8,
  },
  chip: {
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipText: {
    fontFamily: fonts.semibold,
    fontSize: 13,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingHorizontal: 16,
  },
  listEmpty: {
    flexGrow: 1,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 40,
    paddingVertical: 80,
  },
  emptyTitle: {
    fontFamily: fonts.bold,
    fontSize: 18,
  },
  emptyText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
  },
});
