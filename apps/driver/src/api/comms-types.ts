/**
 * Types mirroring the M10 comms contract (backend/docs/api/comms-v1.yaml) —
 * the DRIVER slice: the per-ride chat thread and its window states, chat
 * messages, the quick-reply catalog, trip-share links and SOS events.
 * Import-free so every layer can depend on them without cycles.
 */

/**
 * Window states on the wire. `none` never reaches the wire — it is the 404
 * on the thread endpoints (no thread exists before acceptance).
 */
export type ChatWindowState = "open" | "read_only" | "reopened";

/** One localized one-tap quick reply (both texts are always served). */
export interface QuickReply {
  code: string;
  textEn: string;
  textAr: string;
}

export type ChatRole = "rider" | "driver";

/** The other party, as `GET /rides/{rideId}/chat` serves it. */
export interface ChatCounterpart {
  role: ChatRole;
  firstName: string;
  /** Expiring url (drivers only). */
  photoUrl?: string | null;
  /** CALL-01 — non-null only while writes are allowed. */
  phone: string | null;
}

export interface ChatThread {
  rideId: string;
  windowState: ChatWindowState;
  openedAt: string;
  /** terminal + 24 h; null while the ride is live. */
  closedAt: string | null;
  /** Messages after the caller's read marker. */
  unreadCount: number;
  lastReadMessageId?: string | null;
  counterpartLastReadMessageId?: string | null;
  counterpart: ChatCounterpart;
}

export type ChatMessageKind = "text" | "quick_reply";

export interface ChatMessage {
  messageId: string;
  /** Echoed only to its sender. */
  clientMsgId?: string;
  senderRole: ChatRole;
  kind: ChatMessageKind;
  /** text messages only. */
  body?: string | null;
  /** quick replies only (REST history embeds both texts). */
  quickReply?: QuickReply | null;
  sentAt: string;
}

export interface ChatMessagePage {
  /** Oldest first within the page. */
  items: ChatMessage[];
  /** For `before` paging; null when exhausted. */
  nextCursor: string | null;
}

/** Contract `body.maxLength`. */
export const CHAT_BODY_MAX = 1000;

/** `POST /rides/{rideId}/sos` answer (the permanent event). */
export interface SosEvent {
  sosEventId: string;
  rideId: string;
  triggeredByRole: ChatRole;
  lat: number;
  lng: number;
  triggeredAt: string;
  createdAt: string;
}

// ------------------------------------------------- WebSocket chat frames

/** Client → server (on the existing realtime socket, realtime-v1.yaml). */
export type ChatClientFrame =
  | {
      type: "chat.send";
      rideId: string;
      /** Client-generated UUID — the dedup key (a resend never duplicates). */
      clientMsgId: string;
      kind: ChatMessageKind;
      body?: string;
      quickReplyCode?: string;
    }
  | { type: "chat.read"; rideId: string; lastReadMessageId: string };

/** Server → client chat frames (fanned out to BOTH parties). */
export type ChatServerFrame =
  | {
      type: "chat.message";
      rideId: string;
      messageId: string;
      /** Present only on the sender's own echo (the delivery ack). */
      clientMsgId?: string;
      senderRole: ChatRole;
      kind: ChatMessageKind;
      body?: string | null;
      quickReplyCode?: string | null;
      sentAt: string;
    }
  | {
      type: "chat.read";
      rideId: string;
      readerRole: ChatRole;
      lastReadMessageId: string;
    }
  /** `error` frames the chat owns (the socket stays open). */
  | { type: "chat.error"; code: ChatErrorCode; message?: string };

export type ChatErrorCode =
  | "chat_not_open"
  | "chat_closed"
  | "not_in_ride"
  | "invalid_message";

export const CHAT_ERROR_CODES: readonly ChatErrorCode[] = [
  "chat_not_open",
  "chat_closed",
  "not_in_ride",
  "invalid_message",
];
