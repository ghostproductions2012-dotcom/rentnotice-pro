import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { fonts } from "@/constants/fonts";
import { useFieldSync } from "@/context/FieldSyncContext";
import { useColors } from "@/hooks/useColors";
import { getSyncToken, setSyncToken } from "@/lib/syncToken";

export default function SyncSettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { syncNow } = useFieldSync();
  const [token, setToken] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getSyncToken().then((t) => {
      setToken(t ?? "");
      setLoaded(true);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await setSyncToken(token);
      await syncNow();
      if (router.canGoBack()) router.back();
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.container}>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.titleRow}>
            <Feather name="key" size={18} color={colors.primary} />
            <Text style={[styles.title, { color: colors.foreground }]}>
              Device access code
            </Text>
          </View>
          <Text style={[styles.help, { color: colors.mutedForeground }]}>
            Syncing requires an access code issued from RentNotice Pro on the
            desktop (Settings → Mobile Field Sync). Ask your administrator for
            this device's code and enter it once below.
          </Text>
          <TextInput
            testID="input-sync-token"
            style={[
              styles.input,
              {
                borderColor: colors.border,
                color: colors.foreground,
                backgroundColor: colors.background,
              },
            ]}
            placeholder="RNF-XXXX-XXXX-XXXX"
            placeholderTextColor={colors.mutedForeground}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={loaded && !saving}
            value={token}
            onChangeText={setToken}
          />
          <Pressable
            testID="button-save-token"
            onPress={() => void handleSave()}
            disabled={!loaded || saving}
            style={({ pressed }) => [
              styles.button,
              {
                backgroundColor: colors.primary,
                opacity: pressed || saving ? 0.7 : 1,
              },
            ]}
          >
            <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
              {saving ? "Saving…" : "Save & sync"}
            </Text>
          </Pressable>
          <Text style={[styles.footnote, { color: colors.mutedForeground }]}>
            If your code stops working it may have been revoked — request a new
            one from your administrator.
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 17 },
  help: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: fonts.semibold,
    fontSize: 16,
    letterSpacing: 1,
  },
  button: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 15 },
  footnote: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
