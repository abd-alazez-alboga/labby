import { CHAT_ERROR_CODES } from "../api/comms-types";
import type {
  ChatErrorCode,
  ChatServerFrame,
  QuickReply,
} from "../api/comms-types";

function quickReplyTexts(value: unknown): QuickReply | null {
  if (typeof value !== "object" || value === null) return null;
  const reply = value as Record<string, unknown>;
  return typeof reply.code === "string" &&
    typeof reply.textEn === "string" &&
    typeof reply.textAr === "string"
    ? { code: reply.code, textEn: reply.textEn, textAr: reply.textAr }
    : null;
}

/**
 * Parser for the chat frames on the realtime socket (comms-v1.yaml):
 * turns a raw server frame into a typed {@link ChatServerFrame}, or null
 * for anything else (ride/offer frames, unknown types, malformed payloads).
 * Chat frames carry no `as` — the socket belongs to one authenticated user
 * and the chat facade matches `rideId` against its own thread.
 */
export function parseChatFrame(
  raw: Record<string, unknown>,
): ChatServerFrame | null {
  const isString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0;
  const role = (value: unknown): "rider" | "driver" | null =>
    value === "rider" || value === "driver" ? value : null;

  switch (raw.type) {
    case "chat.message": {
      const senderRole = role(raw.senderRole);
      if (
        !isString(raw.rideId) ||
        !isString(raw.messageId) ||
        !isString(raw.sentAt) ||
        !senderRole ||
        (raw.kind !== "text" && raw.kind !== "quick_reply")
      ) {
        return null;
      }
      return {
        type: "chat.message",
        rideId: raw.rideId,
        messageId: raw.messageId,
        clientMsgId: isString(raw.clientMsgId) ? raw.clientMsgId : undefined,
        senderRole,
        kind: raw.kind,
        body: typeof raw.body === "string" ? raw.body : null,
        quickReplyCode: isString(raw.quickReplyCode)
          ? raw.quickReplyCode
          : null,
        quickReply: quickReplyTexts(raw.quickReply),
        sentAt: raw.sentAt,
      };
    }
    case "chat.read": {
      const readerRole = role(raw.readerRole);
      return isString(raw.rideId) &&
        isString(raw.lastReadMessageId) &&
        readerRole
        ? {
            type: "chat.read",
            rideId: raw.rideId,
            readerRole,
            lastReadMessageId: raw.lastReadMessageId,
          }
        : null;
    }
    case "error":
      // The streamer forwards error frames it does not own; the chat codes
      // are ours (the socket stays open — comms-v1.yaml).
      return isString(raw.code) &&
        (CHAT_ERROR_CODES as readonly string[]).includes(raw.code)
        ? {
            type: "chat.error",
            code: raw.code as ChatErrorCode,
            message: isString(raw.message) ? raw.message : undefined,
          }
        : null;
    default:
      return null;
  }
}
