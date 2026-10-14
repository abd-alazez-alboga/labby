import { apiFetch } from "./http-client";

/**
 * Client slice of the comms & safety contract for the rider app
 * (backend/docs/api/comms-v1.yaml, M10): the per-ride chat thread +
 * history + read marker, the localized quick-reply catalog, trip-share
 * links (SHARE-01) and the SOS event (SAFE-01). Types mirror the contract
 * schemas 1:1; screens never call fetch themselves.
 */

// --------------------------------------------------------------- schemas

/** `none` never reaches the wire — it is the 404 on the thread endpoints. */
export type ChatWindowState = "open" | "read_only" | "reopened";

export type ChatParty = "rider" | "driver";

export interface QuickReply {
  code: string;
  textEn: string;
  textAr: string;
}

export interface ChatCounterpart {
  role: ChatParty;
  firstName: string;
  photoUrl?: string | null;
  /** CALL-01 — non-null only while writes are allowed. */
  phone: string | null;
}

export interface ChatThread {
  rideId: string;
  windowState: ChatWindowState;
  openedAt: string;
  /** Terminal + 24 h; null while the ride is live. */
  closedAt: string | null;
  /** Messages after the caller's read marker. */
  unreadCount: number;
  lastReadMessageId?: string | null;
  counterpartLastReadMessageId?: string | null;
  counterpart: ChatCounterpart;
}

export interface ChatMessage {
  messageId: string;
  /** Echoed only to its sender. */
  clientMsgId?: string | null;
  senderRole: ChatParty;
  kind: "text" | "quick_reply";
  /** Text messages only. */
  body?: string | null;
  /** Quick replies only. */
  quickReply?: QuickReply | null;
  sentAt: string;
}

export interface ChatMessagePage {
  /** Oldest first within the page. */
  items: ChatMessage[];
  /** For `before` paging; null when exhausted. */
  nextCursor: string | null;
}

export interface ShareLink {
  /** Absolute public page url — served exactly once (SHARE-01). */
  url: string;
  createdAt: string;
}

export interface SosEvent {
  sosEventId: string;
  rideId: string;
  triggeredByRole: ChatParty;
  lat: number;
  lng: number;
  triggeredAt: string;
  createdAt: string;
}

// ------------------------------------------------------------------ chat

/** The ride's thread — 404 while the window state is `none`. */
export function getChatThread(rideId: string): Promise<ChatThread> {
  return apiFetch<ChatThread>(`/api/v1/rides/${rideId}/chat`, { auth: true });
}

/**
 * History page / reconnect backfill: `before` pages backwards for
 * scrolling, `after` returns everything newer than a message id (at most
 * one of the two).
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
  return apiFetch<ChatMessagePage>(
    `/api/v1/rides/${rideId}/chat/messages${query ? `?${query}` : ""}`,
    { auth: true },
  );
}

/** REST fallback for the `chat.read` frame (idempotent on the server). */
export function postChatRead(
  rideId: string,
  lastReadMessageId: string,
): Promise<void> {
  return apiFetch<void>(`/api/v1/rides/${rideId}/chat/read`, {
    method: "POST",
    auth: true,
    body: JSON.stringify({ lastReadMessageId }),
  });
}

let quickRepliesCache: Promise<QuickReply[]> | null = null;

/**
 * The localized one-tap catalog, cached per session (both languages are
 * served, so a language switch re-renders without refetching).
 */
export function getQuickReplies(): Promise<QuickReply[]> {
  if (!quickRepliesCache) {
    quickRepliesCache = apiFetch<QuickReply[]>("/api/v1/chat/quick-replies", {
      auth: true,
    }).catch((error) => {
      quickRepliesCache = null;
      throw error;
    });
  }
  return quickRepliesCache;
}

/** Test seam: forgets the session cache. */
export function resetQuickRepliesCache(): void {
  quickRepliesCache = null;
}

// ----------------------------------------------------------- share & SOS

/**
 * Creates the caller's one trip-share link (SHARE-01). The raw url is
 * served ONLY here; a repeat call is 409 `already_shared` — the app keeps
 * the url from its first call for the ride's lifetime.
 */
export function createShareLink(rideId: string): Promise<ShareLink> {
  return apiFetch<ShareLink>(`/api/v1/rides/${rideId}/share-links`, {
    method: "POST",
    auth: true,
  });
}

/**
 * Records the SOS event and alerts support (SAFE-01) — fired silently
 * alongside the client-side dialer, never blocking it.
 */
export function sendSos(
  rideId: string,
  event: { lat: number; lng: number; recordedAt: string },
): Promise<SosEvent> {
  return apiFetch<SosEvent>(`/api/v1/rides/${rideId}/sos`, {
    method: "POST",
    auth: true,
    body: JSON.stringify(event),
  });
}
