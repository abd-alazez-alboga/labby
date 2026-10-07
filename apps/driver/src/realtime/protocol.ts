import type { LocationSample } from "../api/realtime-types";

/**
 * Pure pieces of the realtime WebSocket protocol (realtime-v1.yaml,
 * `GET /api/v1/realtime`): the socket URL, frame shapes + parsing, close
 * codes, reconnect backoff, GPS-fix → sample sanitizing and the access
 * token's expiry (for re-auth before it lapses).
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

/** Contract close codes. */
export const CLOSE_UNAUTHORIZED = 4401;
export const CLOSE_MALFORMED = 4400;
export const CLOSE_SERVER_SHUTDOWN = 1001;
/** Our own clean close (going offline / signing out). */
export const CLOSE_NORMAL = 1000;

export type ClientFrame =
  | { type: "auth"; token: string }
  | ({ type: "location" } & LocationSample)
  | { type: "ping" };

export type ServerFrame =
  | {
      type: "ready";
      userId?: string;
      streamIntervalSeconds?: number;
      staleAfterSeconds?: number;
    }
  | { type: "pong" }
  | { type: "error"; code: string; message?: string }
  /** Anything else (M7 adds `ride.*`, `offer.*`, …) — clients ignore it. */
  | { type: "unknown"; rawType: string | null };

/** Parses a server text frame; never throws. */
export function parseServerFrame(data: unknown): ServerFrame | null {
  if (typeof data !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  switch (frame.type) {
    case "ready":
      return {
        type: "ready",
        userId: typeof frame.userId === "string" ? frame.userId : undefined,
        streamIntervalSeconds: positiveNumber(frame.streamIntervalSeconds),
        staleAfterSeconds: positiveNumber(frame.staleAfterSeconds),
      };
    case "pong":
      return { type: "pong" };
    case "error":
      return {
        type: "error",
        code: typeof frame.code === "string" ? frame.code : "unknown",
        message: typeof frame.message === "string" ? frame.message : undefined,
      };
    default:
      return {
        type: "unknown",
        rawType: typeof frame.type === "string" ? frame.type : null,
      };
  }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
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
  const jitter = 0.8 + random() * 0.4;
  return Math.round(raw * jitter);
}

/** What expo-location hands us (subset of LocationObject). */
export interface GpsFix {
  coords: {
    latitude: number;
    longitude: number;
    heading?: number | null;
    speed?: number | null;
    accuracy?: number | null;
  };
  timestamp: number;
}

function nonNegative(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

/**
 * GPS fix → contract sample. Platforms report "unknown" heading/speed as
 * -1; those become null, and heading is normalized into [0, 360).
 */
export function sampleFromFix(fix: GpsFix): LocationSample {
  const heading = nonNegative(fix.coords.heading);
  return {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    headingDeg: heading === null ? null : heading % 360,
    speedMps: nonNegative(fix.coords.speed),
    accuracyM: nonNegative(fix.coords.accuracy),
    recordedAt: new Date(fix.timestamp).toISOString(),
  };
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
