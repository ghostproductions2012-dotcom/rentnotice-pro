// ---------------------------------------------------------------------------
// Communications-hub identity: the hub lives on the api-server and is scoped
// by the workspace's license key. This module registers the license-key
// getter with the shared API client (so every /api/comms/* call carries
// x-license-key) and exposes the caller's chat identity.
//
// Demo workspaces have no cloud company, so the getter returns null and the
// Communications page shows an activation prompt instead.
// ---------------------------------------------------------------------------

import { ApiError, setLicenseKeyGetter, setMemberTokenGetter } from "@workspace/api-client-react";
import { getServices } from "../api/services";
import { useSession, useWorkspaceState } from "../api/hooks";

let registered = false;

/** Idempotent; call once from any comms entry point before using the hooks. */
export function registerCommsLicenseKey(): void {
  if (registered) return;
  registered = true;
  setLicenseKeyGetter(async () => {
    try {
      const ws = await getServices().getWorkspaceState();
      return ws.mode === "activated" ? (ws.activation?.licenseKey ?? null) : null;
    } catch {
      return null;
    }
  });
  // The hub validates who is talking (not just which company) via a
  // per-member token minted at sign-in; attach it to every comms call.
  setMemberTokenGetter(async () => {
    try {
      const session = await getServices().getSession();
      return session.user?.chatToken ?? null;
    } catch {
      return null;
    }
  });
}

/**
 * True when a comms request failed because the server no longer accepts our
 * member token (expired, rotated away, or revoked). The graceful recovery is
 * to drop the cached token and show the sign-in guidance.
 */
export function isMemberTokenRejected(err: unknown): boolean {
  return (
    err instanceof ApiError &&
    err.status === 401 &&
    (err.data as { code?: string } | null)?.code === "member_token_required"
  );
}

export interface CommsIdentity {
  /** True when comms calls can succeed: activated, not blocked, signed in with a chat token. */
  ready: boolean;
  activated: boolean;
  licenseBlocked: boolean;
  /**
   * True when everything else is in place but this sign-in never obtained a
   * chat member token (e.g. the device was offline at sign-in). The fix is
   * to sign out and back in while online.
   */
  tokenMissing: boolean;
  /** Stable member key shared with the cloud directory (cloud user id). */
  memberKey: string | null;
  memberName: string;
  isAdmin: boolean;
}

export function useCommsIdentity(): CommsIdentity {
  const { data: workspace } = useWorkspaceState();
  const { data: session } = useSession();
  const user = session?.user ?? null;
  const activated = workspace?.mode === "activated" && !!workspace.activation;
  const licenseBlocked = workspace?.licenseBlocked ?? false;
  const memberKey = user ? (user.cloudUserId ?? user.id) : null;
  const hasToken = !!user?.chatToken;
  return {
    ready: activated && !licenseBlocked && !!memberKey && hasToken,
    activated,
    licenseBlocked,
    tokenMissing: activated && !licenseBlocked && !!memberKey && !hasToken,
    memberKey,
    memberName: user?.name ?? "",
    isAdmin: user?.role === "admin",
  };
}
