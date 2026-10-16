import type { QuickReply } from "../api/comms";
import type { Ride } from "../api/rides";

/**
 * Pure pieces of the realtime WebSocket protocol for the rider app
 * (realtime-v1.yaml `GET /api/v1/realtime`, rides-v1.yaml "Realtime
 * events"): socket URL, frame shapes + parsing, the `as` audience filter,
 * close codes, reconnect backoff and the access token's expiry.
 */

export const REALTIME_PATH = "/api/v1/realtime";

/** ws/wss derived from the API base URL (no token in the URL — first-frame auth). */
export function realtimeUrl(apiBaseUrl: string): string {
  const base = apiBaseUrl.replace(/\/+$/, "");
  const url = base.replace(/^http(s?):\/\//i, (_match, secure: string) =>
    secure ? "wss://" : "ws://",
  );
  return `${url}${REALTIME_PATH}`;
}

export const CLOSE_NORMAL = 1000;
export const CLOSE_SERVER_SHUTDOWN = 1001;
export const CLOSE_MALFORMED = 4400;
export const CLOSE_UNAUTHORIZED = 4401;

/** M10 chat frames the rider sends (comms-v1.yaml "WebSocket chat frames"). */
export type ChatClientFrame =
  | {
      type: "chat.send";
      rideId: string;
      /** Client-generated UUID — the dedup key (a resend is never duplicated). */
      clientMsgId: string;
      kind: "text" | "quick_reply";
      body?: string;
      quickReplyCode?: string;
    }
  | { type: "chat.read"; rideId: string; lastReadMessageId: string };

export type ClientFrame =
  { type: "auth"; token: string } | { type: "ping" } | ChatClientFrame;

/** The ride events addressed to the rider (`"as": "rider"`). */
export type RideEvent =
  | { type: "ride.state"; ride: Ride }
  | { type: "ride.updated"; reason: string | null; ride: Ride }
  | {
      type: "ride.driver_position";
      rideId: string;
      lat: number;
      lng: number;
      headingDeg: number | null;
      recordedAt: string | null;
      etaSeconds: number | null;
    }
  | { type: "ride.connection"; rideId: string; driverStream: "ok" | "lost" }
  /** M12 (scheduled-shared-v1.yaml): seats changed on a shared ride the rider is in. */
  | {
      type: "shared.occupancy";
      rideId: string;
      seatsTaken: number;
      totalSeats: number;
    };

/**
 * The chat frames the server fans out (comms-v1.yaml). They are addressed
 * per user (no `as` audience field): the sender's echo carries `clientMsgId`
 * — that echo is the delivery ack.
 */
export type ChatServerEvent =
  | {
      type: "chat.message";
      rideId: string;
      messageId: string;
      clientMsgId: string | null;
      senderRole: "rider" | "driver";
      kind: "text" | "quick_reply";
      body: string | null;
      quickReplyCode: string | null;
      /** A quick reply's texts — the counterpart's codes are not in this app's catalog. */
      quickReply: QuickReply | null;
      sentAt: string;
    }
  | {
      type: "chat.read";
      rideId: string;
      readerRole: "rider" | "driver";
      lastReadMessageId: string;
    };

export type ServerFrame =
  | { type: "ready"; userId?: string }
  | { type: "pong" }
  | { type: "error"; code: string }
  | { type: "ride"; event: RideEvent }
  | { type: "chat"; event: ChatServerEvent }
  /** Unknown types and frames for another audience — ignored. */
  | { type: "ignored" };

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRide(value: unknown): value is Ride {
  if (!value || typeof value !== "object") return false;
  const ride = value as Record<string, unknown>;
  return typeof ride.id === "string" && typeof ride.state === "string";
}

function parseRideEvent(frame: Record<string, unknown>): RideEvent | null {
  switch (frame.type) {
    case "ride.state":
      return isRide(frame.ride)
        ? { type: "ride.state", ride: frame.ride }
        : null;
    case "ride.updated":
      return isRide(frame.ride)
        ? {
            type: "ride.updated",
            reason: typeof frame.reason === "string" ? frame.reason : null,
            ride: frame.ride,
          }
        : null;
    case "ride.driver_position": {
      const lat = finite(frame.lat);
      const lng = finite(frame.lng);
      if (typeof frame.rideId !== "string" || lat === null || lng === null)
        return null;
      return {
        type: "ride.driver_position",
        rideId: frame.rideId,
        lat,
        lng,
        headingDeg: finite(frame.headingDeg),
        recordedAt:
          typeof frame.recordedAt === "string" ? frame.recordedAt : null,
        etaSeconds: finite(frame.etaSeconds),
      };
    }
    case "ride.connection":
      if (
        typeof frame.rideId !== "string" ||
        (frame.driverStream !== "ok" && frame.driverStream !== "lost")
      )
        return null;
      return {
        type: "ride.connection",
        rideId: frame.rideId,
        driverStream: frame.driverStream,
      };
    case "shared.occupancy": {
      const seatsTaken = finite(frame.seatsTaken);
      const totalSeats = finite(frame.totalSeats);
      if (
        typeof frame.rideId !== "string" ||
        seatsTaken === null ||
        totalSeats === null
      )
        return null;
      return {
        type: "shared.occupancy",
        rideId: frame.rideId,
        seatsTaken,
        totalSeats,
      };
    }
    default:
      return null;
  }
}

function chatRole(value: unknown): "rider" | "driver" | null {
  return value === "rider" || value === "driver" ? value : null;
}

function parseQuickReply(value: unknown): QuickReply | null {
  if (typeof value !== "object" || value === null) return null;
  const reply = value as Record<string, unknown>;
  return typeof reply.code === "string" &&
    typeof reply.textEn === "string" &&
    typeof reply.textAr === "string"
    ? { code: reply.code, textEn: reply.textEn, textAr: reply.textAr }
    : null;
}

function parseChatEvent(
  frame: Record<string, unknown>,
): ChatServerEvent | null {
  if (typeof frame.rideId !== "string") return null;
  switch (frame.type) {
    case "chat.message": {
      const senderRole = chatRole(frame.senderRole);
      const kind =
        frame.kind === "text" || frame.kind === "quick_reply"
          ? frame.kind
          : null;
      if (
        typeof frame.messageId !== "string" ||
        !senderRole ||
        !kind ||
        typeof frame.sentAt !== "string"
      ) {
        return null;
      }
      return {
        type: "chat.message",
        rideId: frame.rideId,
        messageId: frame.messageId,
        clientMsgId:
          typeof frame.clientMsgId === "string" ? frame.clientMsgId : null,
        senderRole,
        kind,
        body: typeof frame.body === "string" ? frame.body : null,
        quickReplyCode:
          typeof frame.quickReplyCode === "string"
            ? frame.quickReplyCode
            : null,
        quickReply: parseQuickReply(frame.quickReply),
        sentAt: frame.sentAt,
      };
    }
    case "chat.read": {
      const readerRole = chatRole(frame.readerRole);
      if (!readerRole || typeof frame.lastReadMessageId !== "string")
        return null;
      return {
        type: "chat.read",
        rideId: frame.rideId,
        readerRole,
        lastReadMessageId: frame.lastReadMessageId,
      };
    }
    default:
      return null;
  }
}

/**
 * Parses a server text frame; never throws. Ride frames whose `as` is not
 * `"rider"` belong to the driver app (one account can hold both roles with
 * both apps connected) and are ignored, like unknown types. Chat frames are
 * addressed per user and carry no `as` (comms-v1.yaml).
 */
export function parseServerFrame(data: unknown): ServerFrame | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const frame = parsed as Record<string, unknown>;
  switch (frame.type) {
    case "ready":
      return {
        type: "ready",
        userId: typeof frame.userId === "string" ? frame.userId : undefined,
      };
    case "pong":
      return { type: "pong" };
    case "error":
      return {
        type: "error",
        code: typeof frame.code === "string" ? frame.code : "unknown",
      };
    default: {
      if (typeof frame.type === "string" && frame.type.startsWith("chat.")) {
        const chatEvent = parseChatEvent(frame);
        return chatEvent
          ? { type: "chat", event: chatEvent }
          : { type: "ignored" };
      }
      if (frame.as !== "rider") return { type: "ignored" };
      const event = parseRideEvent(frame);
      return event ? { type: "ride", event } : { type: "ignored" };
    }
  }
}

/** Reconnect backoff: 1 s, 2 s, 4 s … capped at 30 s, ±20 % jitter. */
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;

export function backoffDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.round(raw * (0.8 + random() * 0.4));
}

function decodeBase64Url(segment: string): string | null {
  try {
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    return globalThis.atob(padded);
  } catch {
    return null;
  }
}

/** The access token's `exp` in epoch ms, or null when it isn't a readable JWT. */
export function accessTokenExpiryMs(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const json = decodeBase64Url(parts[1]);
  if (!json) return null;
  try {
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
