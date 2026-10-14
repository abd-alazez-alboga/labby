import { ApiError, authFetch } from "./client";
import type {
  ChatMessagePage,
  ChatThread,
  QuickReply,
  SosEvent,
} from "./comms-types";

/**
 * Client slice of comms-v1.yaml for the driver (Chat, Share, Sos —
 * UC-S-13..16). The WS half of the chat transport lives in
 * realtime/chat-frames + the chat facade; this is the REST half.
 */

/**
 * `GET /rides/{rideId}/chat` — the thread: window state, counterpart,
 * unread count. 404 while the window state is `none` (no thread yet);
 * callers turn that into "no entry point".
 */
export function getChatThread(rideId: string): Promise<ChatThread> {
  return authFetch<ChatThread>(`/api/v1/rides/${rideId}/chat`);
}

/**
 * `GET /rides/{rideId}/chat/messages` — history page / reconnect backfill.
 * `before` pages history backwards (scrolling); `after` returns everything
 * NEWER than a message id, oldest first (lossless reconnect). At most one
 * of the two.
 */
export function getChatMessages(
  rideId: string,
  options: { before?: string; after?: string; size?: number } = {},
): Promise<ChatMessagePage> {
  const params = new URLSearchParams();
  if (options.before) params.set("before", options.before);
  if (options.after) params.set("after", options.after);
  if (options.size) params.set("size", String(options.size));
  const query = params.toString();
  return authFetch<ChatMessagePage>(
    `/api/v1/rides/${rideId}/chat/messages${query ? `?${query}` : ""}`,
  );
}

/** `POST /rides/{rideId}/chat/read` — REST fallback for the `chat.read` frame. */
export async function postChatRead(
  rideId: string,
  lastReadMessageId: string,
): Promise<void> {
  await authFetch<null>(`/api/v1/rides/${rideId}/chat/read`, {
    method: "POST",
    body: { lastReadMessageId },
  });
}

/**
 * `GET /chat/quick-replies` — the localized one-tap catalog for the
 * caller's role (audience driver + both), in sort order, both languages
 * served. Cacheable per session.
 */
export function getQuickReplies(): Promise<QuickReply[]> {
  return authFetch<QuickReply[]>("/api/v1/chat/quick-replies");
}

/**
 * `POST /rides/{rideId}/share-links` — 201 is the ONLY time the raw url is
 * served (one link per user per ride); a repeat call is 409 `already_shared`
 * and the app reuses the url it stored from the first call.
 */
export function createShareLink(
  rideId: string,
): Promise<{ url: string; createdAt: string }> {
  return authFetch<{ url: string; createdAt: string }>(
    `/api/v1/rides/${rideId}/share-links`,
    { method: "POST" },
  );
}

/**
 * `POST /rides/{rideId}/sos` — records the permanent event and alerts
 * support (SAFE-01). Fired silently alongside the client-side dialer;
 * repeat taps create repeat events (escalation is signal).
 */
export function postSos(
  rideId: string,
  body: { lat: number; lng: number; recordedAt: string },
): Promise<SosEvent> {
  return authFetch<SosEvent>(`/api/v1/rides/${rideId}/sos`, {
    method: "POST",
    body,
  });
}

/** The machine `code` of a comms error body, or null. */
export function commsErrorCode(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  const body = (error.body ?? {}) as { code?: unknown };
  return typeof body.code === "string" ? body.code : null;
}

/**
 * A client-generated UUID v4 for `clientMsgId` (the dedup key). Hermes may
 * lack `crypto.randomUUID`; the fallback is RFC-4122-shaped from
 * Math.random — uniqueness per thread + sender is all the server needs.
 */
export function newClientMsgId(): string {
  const webCrypto = globalThis.crypto as
    | { randomUUID?: () => string }
    | undefined;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === "x" ? r : (r % 4) + 8;
    return v.toString(16);
  });
}
