import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
} from "@expo-google-fonts/plus-jakarta-sans";
// QueryClient/Provider come from the API client lib so the provider and the
// generated hooks share the same react-query copy (pnpm installs duplicates
// when peer @types/react versions diverge).
import {
  QueryClient,
  QueryClientProvider,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { fonts } from "@/constants/fonts";
import { FieldSyncProvider } from "@/context/FieldSyncContext";
import { useColors } from "@/hooks/useColors";
import { getSyncToken } from "@/lib/syncToken";

// Expo bundles run outside the web proxy and need an absolute URL to reach the API.
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN}`);
// The sync relay requires a device access code; attach it as a bearer token.
setAuthTokenGetter(getSyncToken);

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerBackTitle: "Back",
        headerStyle: { backgroundColor: colors.card },
        headerTitleStyle: { fontFamily: fonts.bold, color: colors.foreground },
        headerTintColor: colors.primary,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Field Assignments" }} />
      <Stack.Screen name="settings" options={{ title: "Sync Settings" }} />
      <Stack.Screen name="assignment/[id]" options={{ title: "Assignment" }} />
      <Stack.Screen name="assignment/capture" options={{ title: "Capture evidence" }} />
      <Stack.Screen name="work-order/[id]" options={{ title: "Work Order" }} />
      <Stack.Screen name="chat" options={{ title: "Team Chat" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <FieldSyncProvider>
                <RootLayoutNav />
              </FieldSyncProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
