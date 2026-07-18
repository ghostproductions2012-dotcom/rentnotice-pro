import AsyncStorage from "@react-native-async-storage/async-storage";

// Device access code for the field sync relay. Issued from the RentNotice
// Pro desktop app (Settings → Mobile Field Sync) and typed in here once.
// Sent as a bearer token on every sync request.

const TOKEN_KEY = "rnf.sync.token.v1";

let cached: string | null = null;
let loaded = false;

export async function getSyncToken(): Promise<string | null> {
  if (!loaded) {
    try {
      cached = await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      cached = null;
    }
    loaded = true;
  }
  return cached;
}

export async function setSyncToken(token: string): Promise<void> {
  const normalized = token.trim().toUpperCase();
  cached = normalized || null;
  loaded = true;
  if (normalized) {
    await AsyncStorage.setItem(TOKEN_KEY, normalized);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}
