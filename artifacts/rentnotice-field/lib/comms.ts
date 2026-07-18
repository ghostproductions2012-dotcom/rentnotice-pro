import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  sendChatMessage,
  setLicenseKeyGetter,
  setMemberTokenGetter,
  type SendChatMessageRequest,
} from "@workspace/api-client-react";

const IDENTITY_KEY = "rnf.comms.identity.v1";
const OUTBOX_KEY = "rnf.comms.outbox.v1";

export interface CommsIdentity {
  licenseKey: string;
  memberKey: string;
  memberName: string;
  /** Server-issued token proving this member's identity to chat routes. */
  memberToken: string;
}

let cachedIdentity: CommsIdentity | null | undefined;

export async function loadCommsIdentity(): Promise<CommsIdentity | null> {
  if (cachedIdentity !== undefined) return cachedIdentity;
  try {
    const raw = await AsyncStorage.getItem(IDENTITY_KEY);
    const parsed = raw ? (JSON.parse(raw) as CommsIdentity) : null;
    // Identities saved before member tokens existed can no longer talk to
    // the chat routes; force the setup screen so the user signs in properly.
    cachedIdentity = parsed && parsed.memberToken ? parsed : null;
  } catch {
    cachedIdentity = null;
  }
  return cachedIdentity;
}

export async function saveCommsIdentity(identity: CommsIdentity): Promise<void> {
  cachedIdentity = identity;
  await AsyncStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export async function clearCommsIdentity(): Promise<void> {
  cachedIdentity = null;
  await AsyncStorage.removeItem(IDENTITY_KEY);
}

/**
 * Attach the saved workspace license key (as `x-license-key`) and the chat
 * member token (as `x-member-token`) to every API request. Comms routes
 * require both; other field routes ignore the headers, so this stays out of
 * the way of the field-sync auth story.
 */
export function registerFieldCommsCredentials(): void {
  setLicenseKeyGetter(async () => {
    const identity = await loadCommsIdentity();
    return identity?.licenseKey ?? null;
  });
  setMemberTokenGetter(async () => {
    const identity = await loadCommsIdentity();
    return identity?.memberToken ?? null;
  });
}

// ---------------------------------------------------------------------------
// Offline-tolerant outbox. Sends are idempotent server-side (client ids), so
// retrying a queued message after a network failure can never duplicate it.
// ---------------------------------------------------------------------------

export interface OutboxEntry {
  channelId: string;
  payload: SendChatMessageRequest;
}

export async function loadOutbox(): Promise<OutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(OUTBOX_KEY);
    return raw ? (JSON.parse(raw) as OutboxEntry[]) : [];
  } catch {
    return [];
  }
}

export async function saveOutbox(entries: OutboxEntry[]): Promise<void> {
  await AsyncStorage.setItem(OUTBOX_KEY, JSON.stringify(entries));
}

/**
 * Attempt to deliver queued messages in order. Stops at the first network
 * failure (entry is kept for a later retry); drops entries the server
 * permanently rejects (4xx) so one bad message can't wedge the queue.
 * A 401 means our member token expired or was revoked: the queue is kept
 * intact and `authExpired` tells the caller to send the user back through
 * chat sign-in — the messages flush after they reconnect.
 */
export async function flushOutbox(
  entries: OutboxEntry[],
): Promise<{ remaining: OutboxEntry[]; sentAny: boolean; authExpired: boolean }> {
  let remaining = [...entries];
  let sentAny = false;
  let authExpired = false;
  while (remaining.length > 0) {
    const entry = remaining[0];
    try {
      await sendChatMessage(entry.channelId, entry.payload);
      remaining = remaining.slice(1);
      sentAny = true;
      await saveOutbox(remaining);
    } catch (err) {
      const status = (err as { status?: number } | undefined)?.status;
      if (status === 401) {
        authExpired = true;
        break;
      }
      if (status !== undefined && status >= 400 && status < 500) {
        remaining = remaining.slice(1);
        await saveOutbox(remaining);
        continue;
      }
      break;
    }
  }
  return { remaining, sentAny, authExpired };
}
