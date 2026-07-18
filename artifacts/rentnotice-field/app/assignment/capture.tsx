import { Feather } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
import { useFieldSync } from "@/context/FieldSyncContext";
import { useColors } from "@/hooks/useColors";
import { formatCoords, generateId } from "@/lib/format";

const WEB_TOP_INSET = Platform.OS === "web" ? 67 : 0;
const WEB_BOTTOM_INSET = Platform.OS === "web" ? 34 : 0;

interface Captured {
  photoDataUrl: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
}

function haptic(style: Haptics.ImpactFeedbackStyle) {
  if (Platform.OS !== "web") {
    void Haptics.impactAsync(style);
  }
}

async function getWebLocation(): Promise<{
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
}> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ latitude: null, longitude: null, accuracyMeters: null });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy ?? null,
        }),
      () => resolve({ latitude: null, longitude: null, accuracyMeters: null }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

async function processPhoto(uri: string): Promise<string> {
  const context = ImageManipulator.manipulate(uri);
  context.resize({ width: 1280 });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({
    compress: 0.6,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return `data:image/jpeg;base64,${result.base64 ?? ""}`;
}

export default function CaptureScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id, kind } = useLocalSearchParams<{ id: string; kind?: string }>();
  const { addEvidence, addWorkOrderPhoto } = useFieldSync();
  const isWorkOrder = kind === "work-order";

  const [camPerm, requestCamPerm] = useCameraPermissions();
  const [locPerm, requestLocPerm] = Location.useForegroundPermissions();

  const cameraRef = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [captured, setCaptured] = useState<Captured | null>(null);
  const [note, setNote] = useState("");

  const grabLocation = useCallback(async (): Promise<Captured> => {
    if (Platform.OS === "web") {
      const web = await getWebLocation();
      return { photoDataUrl: "", ...web };
    }
    let latitude: number | null = null;
    let longitude: number | null = null;
    let accuracyMeters: number | null = null;
    try {
      let granted = locPerm?.granted ?? false;
      if (!granted) {
        const res = await requestLocPerm();
        granted = res.granted;
      }
      if (granted) {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        latitude = loc.coords.latitude;
        longitude = loc.coords.longitude;
        accuracyMeters = loc.coords.accuracy ?? null;
      }
    } catch {
      // ignore — evidence can be saved without a GPS fix
    }
    return { photoDataUrl: "", latitude, longitude, accuracyMeters };
  }, [locPerm, requestLocPerm]);

  const takePhotoNative = useCallback(async () => {
    if (!cameraRef.current || busy) return;
    setBusy(true);
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      if (!photo?.uri) return;
      const [dataUrl, loc] = await Promise.all([
        processPhoto(photo.uri),
        grabLocation(),
      ]);
      setCaptured({ ...loc, photoDataUrl: dataUrl });
    } catch {
      // ignore capture failure
    } finally {
      setBusy(false);
    }
  }, [busy, grabLocation]);

  const pickPhotoWeb = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled || !result.assets[0]?.uri) return;
      const [dataUrl, loc] = await Promise.all([
        processPhoto(result.assets[0].uri),
        grabLocation(),
      ]);
      setCaptured({ ...loc, photoDataUrl: dataUrl });
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }, [busy, grabLocation]);

  const save = useCallback(() => {
    if (!captured || !id) return;
    haptic(Haptics.ImpactFeedbackStyle.Heavy);
    const payload = {
      id: generateId(),
      photoDataUrl: captured.photoDataUrl,
      latitude: captured.latitude,
      longitude: captured.longitude,
      accuracyMeters: captured.accuracyMeters,
      capturedAt: new Date().toISOString(),
      note: note.trim(),
    };
    if (isWorkOrder) {
      addWorkOrderPhoto(id, payload);
    } else {
      addEvidence(id, payload);
    }
    router.back();
  }, [captured, id, note, isWorkOrder, addEvidence, addWorkOrderPhoto, router]);

  // ---- Confirm view (photo preview + note + save) ----
  if (captured) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Confirm evidence" }} />
        <ScrollView
          contentContainerStyle={[
            styles.confirmContent,
            { paddingBottom: 32 + WEB_BOTTOM_INSET },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Image
            source={{ uri: captured.photoDataUrl }}
            style={[styles.preview, { borderRadius: colors.radius * 1.5 }]}
            contentFit="cover"
            transition={150}
          />

          <View
            style={[
              styles.gpsCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: colors.radius * 1.5,
              },
            ]}
          >
            <Feather
              name={captured.latitude != null ? "map-pin" : "alert-triangle"}
              size={18}
              color={
                captured.latitude != null ? colors.success : colors.warning
              }
            />
            <View style={styles.gpsBody}>
              <Text style={[styles.gpsLabel, { color: colors.mutedForeground }]}>
                GPS location
              </Text>
              <Text style={[styles.gpsValue, { color: colors.foreground }]}>
                {formatCoords(captured.latitude, captured.longitude)}
              </Text>
              {captured.accuracyMeters != null && (
                <Text
                  style={[styles.gpsAccuracy, { color: colors.mutedForeground }]}
                >
                  ±{Math.round(captured.accuracyMeters)}m accuracy
                </Text>
              )}
            </View>
          </View>

          <TextInput
            testID="evidence-note-input"
            value={note}
            onChangeText={setNote}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.noteInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                borderRadius: colors.radius,
                backgroundColor: colors.card,
              },
            ]}
          />
        </ScrollView>

        <View
          style={[
            styles.confirmBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12) + WEB_BOTTOM_INSET,
            },
          ]}
        >
          <Pressable
            testID="retake-button"
            onPress={() => {
              setCaptured(null);
              setNote("");
            }}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                borderRadius: colors.radius,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Feather name="rotate-ccw" size={18} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground }]}>
              Retake
            </Text>
          </Pressable>
          <Pressable
            testID="save-evidence-button"
            onPress={save}
            style={({ pressed }) => [
              styles.saveBtn,
              {
                backgroundColor: colors.primary,
                borderRadius: colors.radius,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Feather name="check" size={19} color={colors.primaryForeground} />
            <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
              Save
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ---- Web capture (image picker) ----
  if (Platform.OS === "web") {
    return (
      <View
        style={[
          styles.centerFill,
          { backgroundColor: colors.background, paddingTop: WEB_TOP_INSET },
        ]}
      >
        <Stack.Screen options={{ title: "Capture evidence" }} />
        <Feather name="camera" size={48} color={colors.mutedForeground} />
        <Text style={[styles.permTitle, { color: colors.foreground }]}>
          Capture evidence
        </Text>
        <Text style={[styles.permText, { color: colors.mutedForeground }]}>
          Select a photo from your device. GPS coordinates are captured from your
          browser location.
        </Text>
        <Pressable
          testID="web-pick-photo"
          onPress={pickPhotoWeb}
          disabled={busy}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed || busy ? 0.7 : 1,
              paddingHorizontal: 24,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="image" size={18} color={colors.primaryForeground} />
              <Text
                style={[styles.saveBtnText, { color: colors.primaryForeground }]}
              >
                Choose photo
              </Text>
            </>
          )}
        </Pressable>
      </View>
    );
  }

  // ---- Native camera permission gating ----
  if (!camPerm) {
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!camPerm.granted) {
    const blocked = camPerm.status === "denied" && !camPerm.canAskAgain;
    return (
      <View style={[styles.centerFill, { backgroundColor: colors.background }]}>
        <Stack.Screen options={{ title: "Camera access" }} />
        <Feather name="camera-off" size={48} color={colors.mutedForeground} />
        <Text style={[styles.permTitle, { color: colors.foreground }]}>
          Camera access needed
        </Text>
        <Text style={[styles.permText, { color: colors.mutedForeground }]}>
          RentNotice Field uses your camera to capture photo evidence of service
          at the property.
        </Text>
        <Pressable
          testID="request-camera-permission"
          onPress={() => {
            if (blocked) {
              void Linking.openSettings().catch(() => {});
            } else {
              void requestCamPerm();
            }
          }}
          style={({ pressed }) => [
            styles.saveBtn,
            {
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              opacity: pressed ? 0.85 : 1,
              paddingHorizontal: 24,
            },
          ]}
        >
          <Text style={[styles.saveBtnText, { color: colors.primaryForeground }]}>
            {blocked ? "Open Settings" : "Grant access"}
          </Text>
        </Pressable>
      </View>
    );
  }

  // ---- Native camera view ----
  return (
    <View style={styles.cameraContainer}>
      <Stack.Screen options={{ title: "Capture evidence" }} />
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
      <View
        style={[
          styles.cameraControls,
          { paddingBottom: Math.max(insets.bottom, 24) },
        ]}
      >
        <Pressable
          testID="shutter-button"
          onPress={takePhotoNative}
          disabled={busy}
          style={styles.shutterOuter}
        >
          {busy ? (
            <ActivityIndicator color="#0f1729" />
          ) : (
            <View style={styles.shutterInner} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
  },
  permTitle: {
    fontFamily: fonts.bold,
    fontSize: 20,
    textAlign: "center",
  },
  permText: {
    fontFamily: fonts.regular,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 8,
  },
  cameraContainer: {
    flex: 1,
    backgroundColor: "#000000",
  },
  cameraControls: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingTop: 24,
  },
  shutterOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.25)",
  },
  shutterInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "#ffffff",
  },
  confirmContent: {
    padding: 16,
    gap: 16,
  },
  preview: {
    width: "100%",
    aspectRatio: 3 / 4,
    backgroundColor: "transparent",
  },
  gpsCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    padding: 14,
  },
  gpsBody: {
    flex: 1,
    gap: 2,
  },
  gpsLabel: {
    fontFamily: fonts.medium,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  gpsValue: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  gpsAccuracy: {
    fontFamily: fonts.regular,
    fontSize: 12.5,
  },
  noteInput: {
    borderWidth: 1,
    minHeight: 80,
    padding: 12,
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlignVertical: "top",
  },
  confirmBar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
  },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: 1,
  },
  secondaryBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
  saveBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
  },
  saveBtnText: {
    fontFamily: fonts.semibold,
    fontSize: 15,
  },
});
