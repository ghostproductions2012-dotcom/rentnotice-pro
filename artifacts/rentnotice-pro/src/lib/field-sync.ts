import { useWorkspaceState } from "@/lib/api/hooks";

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
