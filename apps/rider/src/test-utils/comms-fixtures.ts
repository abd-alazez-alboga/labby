/**
 * Contract-shaped fixtures for comms-v1.yaml (M10): the rider's chat
 * thread, history pages, the quick-reply catalog (V15 seed copy), share
 * links and SOS events.
 */
import type {
  ChatMessage,
  ChatMessagePage,
  ChatThread,
  QuickReply,
  ShareLink,
  SosEvent,
} from "../api/comms";
import { RIDE_ID } from "./ride-fixtures";

export const MSG_1 = "aaaaaaa1-1111-4111-8111-111111111111";
export const MSG_2 = "aaaaaaa2-2222-4222-8222-222222222222";
export const MSG_3 = "aaaaaaa3-3333-4333-8333-333333333333";

/** The rider-visible slice of the V15 seed (audience rider/both). */
export const quickReplies: QuickReply[] = [
  { code: "rider_coming", textEn: "I'm coming", textAr: "أنا قادم" },
  {
    code: "rider_where_are_you",
    textEn: "Where are you now?",
    textAr: "أين وصلت؟",
  },
  {
    code: "rider_wait_please",
    textEn: "One minute, please",
    textAr: "دقيقة من فضلك",
  },
  { code: "both_okay", textEn: "Okay", textAr: "تمام" },
  { code: "both_thanks", textEn: "Thank you", textAr: "شكراً" },
];

export function chatThread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    rideId: RIDE_ID,
    windowState: "open",
    openedAt: "2026-10-13T09:29:20Z",
    closedAt: null,
    unreadCount: 0,
    lastReadMessageId: null,
    counterpartLastReadMessageId: null,
    counterpart: {
      role: "driver",
      firstName: "Samer",
      photoUrl: null,
      phone: "+963955000111",
    },
    ...overrides,
  };
}

export function chatMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: MSG_1,
    clientMsgId: null,
    senderRole: "driver",
    kind: "text",
    body: "On my way",
    quickReply: null,
    sentAt: "2026-10-13T09:30:00Z",
    ...overrides,
  };
}

export function messagePage(
  items: ChatMessage[],
  nextCursor: string | null = null,
): ChatMessagePage {
  return { items, nextCursor };
}

export function shareLink(overrides: Partial<ShareLink> = {}): ShareLink {
  return {
    url: "https://labby.example/share/tok-123",
    createdAt: "2026-10-13T09:35:00Z",
    ...overrides,
  };
}

export function sosEvent(overrides: Partial<SosEvent> = {}): SosEvent {
  return {
    sosEventId: "bbbbbbb1-1111-4111-8111-111111111111",
    rideId: RIDE_ID,
    triggeredByRole: "rider",
    lat: 33.5138,
    lng: 36.2765,
    triggeredAt: "2026-10-13T09:36:00Z",
    createdAt: "2026-10-13T09:36:01Z",
    ...overrides,
  };
}
