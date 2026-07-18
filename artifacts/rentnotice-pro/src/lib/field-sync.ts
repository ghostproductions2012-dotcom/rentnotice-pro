import { useWorkspaceState } from "@/lib/api/hooks";

// Root-relative "/api/..." URLs only work when the app is served behind the
// same origin as the API (the web preview / hosted app). The packaged desktop
// build runs from a tauri:// origin where relative fetches cannot reach the
// server — WebKit rejects them with the cryptic "The string did not match the
// expected pattern" error. Standalone builds bake the hosted server base in
// via VITE_LICENSE_API_URL (same variable the licensing client uses); resolve
// every relay URL against it when present.
const configuredApiBase = (import.meta.env.VITE_LICENSE_API_URL as string | undefined) ?? "";
const RELAY_BASE = configuredApiBase.replace(/\/api\/?$/, "").replace(/\/+$/, "");

/** Absolute (desktop) or same-origin (web) URL for a sync-relay API path. */
export function relayUrl(path: string): string {
  return `${RELAY_BASE}${path}`;
}

// The field sync relay requires authentication: the desktop authenticates
// with its license key, mobile devices with access codes issued from
// Settings. This hook exposes the license credential (when the workspace is
// activated) plus the headers to attach to every relay request.
export function useFieldSyncAuth(): {
  licenseKey: string | null;
  syncHeaders: Record<string, string>;
} {
  const { data: workspace } = useWorkspaceState();
  const licenseKey =
    workspace?.mode === "activated" && workspace.activation
      ? workspace.activation.licenseKey
      : null;
  return {
    licenseKey,
    syncHeaders: licenseKey ? { "x-license-key": licenseKey } : {},
  };
}

export const FIELD_SYNC_AUTH_REQUIRED_MESSAGE =
  "Field sync requires an activated license. Activate this workspace in Settings first.";
