/**
 * Deep-link mapper (UC-S-11, realtime-v1.yaml "Deep links").
 *
 * The backend sends `{screen, params}` from a fixed catalog; this module is
 * the only place that turns one into a rider-app route. Unknown screens open
 * the notification center (contract rule). The rider app has no screen for
 * the M5 driver-onboarding entries (they land on the center, where the
 * notification itself is readable); `ride` {rideId} (rides-v1.yaml "Push")
 * opens the ride screen for that ride.
 */
import type { Href } from "expo-router";

import type { DeepLink } from "../api/notifications";

export const NOTIFICATION_CENTER_HREF = "/notifications" satisfies Href;

type RouteBuilder = (params: Record<string, string>) => Href;

/** Catalog screen → rider route. Anything not listed falls back to the center. */
const CATALOG: Record<string, RouteBuilder> = {
  notifications: () => NOTIFICATION_CENTER_HREF,
  // M7: the ride flow for that ride; without a ride id the center is the
  // safe landing (the notification text is readable there).
  ride: (params) =>
    params.rideId
      ? (`/ride/${encodeURIComponent(params.rideId)}` as Href)
      : NOTIFICATION_CENTER_HREF,
  // M10 (comms-v1.yaml "Chat push"): the ride's chat thread.
  chat: (params) =>
    params.rideId
      ? (`/chat/${encodeURIComponent(params.rideId)}` as Href)
      : NOTIFICATION_CENTER_HREF,
  // M14 (support-v1.yaml "Notifications"): the ticket thread / the case.
  ticket: (params) =>
    params.ticketId
      ? (`/ticket/${encodeURIComponent(params.ticketId)}` as Href)
      : NOTIFICATION_CENTER_HREF,
  lost_item_case: (params) =>
    params.ticketId
      ? (`/lost-item/${encodeURIComponent(params.ticketId)}` as Href)
      : NOTIFICATION_CENTER_HREF,
};

export function resolveDeepLink(link: DeepLink | null | undefined): Href {
  if (!link || typeof link.screen !== "string") return NOTIFICATION_CENTER_HREF;
  const build = Object.prototype.hasOwnProperty.call(CATALOG, link.screen)
    ? CATALOG[link.screen]
    : null;
  return build ? build(link.params ?? {}) : NOTIFICATION_CENTER_HREF;
}

/** True when the link lands on the center itself (no navigation needed there). */
export function opensNotificationCenter(
  link: DeepLink | null | undefined,
): boolean {
  return resolveDeepLink(link) === NOTIFICATION_CENTER_HREF;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function asParams(value: unknown): Record<string, string> | undefined {
  const parsed = parseMaybeJson(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return undefined;
  const params: Record<string, string> = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof raw === "string") params[key] = raw;
  }
  return params;
}

function asDeepLink(value: unknown): DeepLink | null {
  const parsed = parseMaybeJson(value);
  if (!parsed || typeof parsed !== "object") return null;
  const { screen, params } = parsed as { screen?: unknown; params?: unknown };
  if (typeof screen !== "string" || !screen) return null;
  const link: DeepLink = { screen };
  const parsedParams = asParams(params);
  if (parsedParams) link.params = parsedParams;
  return link;
}

export interface PushPayload {
  notificationId: string | null;
  link: DeepLink | null;
}

/**
 * Reads the deep link out of a push's data payload. The contract
 * (realtime-v1.yaml, "Notification delivery") fixes the FCM data keys:
 * `notificationId`, `category`, `event` and, when the notification has a
 * deep link, flat `screen` + `params` (a JSON object encoded as a string).
 * A nested `link` (object or JSON string) is also tolerated, though the
 * backend does not send it. Anything else opens the center.
 */
export function parsePushPayload(
  data: Record<string, unknown> | null | undefined,
): PushPayload {
  if (!data || typeof data !== "object")
    return { notificationId: null, link: null };
  const notificationId =
    typeof data.notificationId === "string" && data.notificationId
      ? data.notificationId
      : null;
  const link =
    asDeepLink(data.link) ??
    (typeof data.screen === "string"
      ? asDeepLink({ screen: data.screen, params: data.params })
      : null);
  return { notificationId, link };
}
