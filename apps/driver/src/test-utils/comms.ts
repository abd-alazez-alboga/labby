import type {
  ChatMessage,
  ChatThread,
  QuickReply,
} from "../api/comms-types";
import { RIDE_ID } from "./rides";

/** Contract-shaped fixtures for comms-v1.yaml (driver view). */

export const QUICK_REPLIES_ROUTE = "GET /api/v1/chat/quick-replies";
export const CHAT_THREAD = `GET /api/v1/rides/${RIDE_ID}/chat`;
export const CHAT_MESSAGES = `GET /api/v1/rides/${RIDE_ID}/chat/messages`;
export const CHAT_READ = `POST /api/v1/rides/${RIDE_ID}/chat/read`;
export const SHARE_LINK = `POST /api/v1/rides/${RIDE_ID}/share-links`;
export const SOS = `POST /api/v1/rides/${RIDE_ID}/sos`;

/** The driver catalog (audience driver + both), as the backend serves it. */
export function quickRepliesFixture(): QuickReply[] {
  return [
    { code: "on_my_way", textEn: "On my way", textAr: "أنا في الطريق" },
    { code: "arrived", textEn: "I've arrived", textAr: "لقد وصلت" },
    { code: "traffic", textEn: "Stuck in traffic", textAr: "في ازدحام سير" },
    { code: "cant_find", textEn: "I can't find you", textAr: "لا أجدك" },
  ];
}

export function threadFixture(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    rideId: RIDE_ID,
    windowState: "open",
    openedAt: "2026-10-13T08:00:00Z",
    closedAt: null,
    unreadCount: 0,
    lastReadMessageId: null,
    counterpartLastReadMessageId: null,
    counterpart: {
      role: "rider",
      firstName: "Rana",
      photoUrl: null,
      phone: "+963955555555",
    },
    ...overrides,
  };
}

export function chatMessageFixture(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    messageId: "aa000000-0000-4000-8000-000000000001",
    senderRole: "rider",
    kind: "text",
    body: "I'm at the pharmacy entrance",
    quickReply: null,
    sentAt: "2026-10-13T08:01:00Z",
    ...overrides,
  };
}

export function messagePage(
  items: ChatMessage[],
  nextCursor: string | null = null,
) {
  return { items, nextCursor };
}

/** A `chat.message` frame as the backend fans it out. */
export function chatMessageFrame(overrides: Record<string, unknown> = {}) {
  return {
    type: "chat.message",
    rideId: RIDE_ID,
    messageId: "aa000000-0000-4000-8000-000000000009",
    senderRole: "rider",
    kind: "text",
    body: "Blue jacket",
    sentAt: "2026-10-13T08:05:00Z",
    ...overrides,
  };
}
