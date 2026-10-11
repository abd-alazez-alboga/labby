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

export type ClientFrame = { type: "auth"; token: string } | { type: "ping" };

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
  | { type: "ride.connection"; rideId: string; driverStream: "ok" | "lost" };

export type ServerFrame =
  | { type: "ready"; userId?: string }
  | { type: "pong" }
  | { type: "error"; code: string }
  | { type: "ride"; event: RideEvent }
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
      return isRide(frame.ride) ? { type: "ride.state", ride: frame.ride } : null;
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
        recordedAt: typeof frame.recordedAt === "string" ? frame.recordedAt : null,
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
    default:
      return null;
  }
}

/**
 * Parses a server text frame; never throws. Ride frames whose `as` is not
 * `"rider"` belong to the driver app (one account can hold both roles with
 * both apps connected) and are ignored, like unknown types.
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
