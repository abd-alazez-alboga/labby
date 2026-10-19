import type { Href } from "expo-router";

import { DOCUMENT_TYPES } from "../api/onboarding-types";
import type { DeepLink } from "../api/realtime-types";

/**
 * The single deep-link mapper (UC-S-11): catalog `{screen, params}` →
 * expo-router href, shared by the notification center and push taps.
 *
 * Catalog (realtime-v1.yaml): `driver_application`, `driver_documents`
 * (params: `documentType?`), `driver_vehicles`, `notifications`; M7 adds
 * `ride` (params `rideId`) and `ride_offer` (params `offerId`) — both open
 * the home route, which IS the ride flow, after the ride facade resynced
 * (`DriverRideContextValue.openLink`); M10 adds `chat` (params `rideId`),
 * which opens the ride's chat thread; M14 adds `ticket` and
 * `lost_item_case` (params `ticketId`) for the support screens. Unknown
 * screens open the notification center.
 *
 * The target respects the driver gate (the stacks are guarded): an
 * applicant/suspended account has no home or vehicles screen, an active
 * driver no applicant tracker.
 */

export const NOTIFICATIONS_HREF = "/notifications" as const;

export interface DeepLinkContext {
  /** ACTIVE driver role (the in-app gate). */
  isDriver: boolean;
}

export function hrefForLink(
  link: DeepLink | null | undefined,
  context: DeepLinkContext,
): Href {
  switch (link?.screen) {
    case "driver_application":
      // Approved drivers have no tracker any more — their home is the outcome.
      return context.isDriver ? "/" : "/apply-to-drive";
    case "driver_documents": {
      const documentType = link.params?.documentType;
      return documentType &&
        (DOCUMENT_TYPES as readonly string[]).includes(documentType)
        ? { pathname: "/documents", params: { documentType } }
        : "/documents";
    }
    case "driver_vehicles":
      return context.isDriver ? "/vehicles" : NOTIFICATIONS_HREF;
    case "ride":
    case "ride_offer":
      return context.isDriver ? "/" : NOTIFICATIONS_HREF;
    case "chat": {
      // M10 (UC-S-13): a chat push opens the ride's thread directly; M12: on
      // a shared ride the push names the member whose thread it is.
      const rideId = link.params?.rideId;
      const memberId = link.params?.memberId;
      return context.isDriver && rideId
        ? {
            pathname: "/chat",
            params: memberId ? { rideId, memberId } : { rideId },
          }
        : NOTIFICATIONS_HREF;
    }
    case "ticket": {
      // M14 (support-v1): `support.ticket_*` pushes open the ticket's thread.
      const ticketId = link.params?.ticketId;
      // The support routes live in the active-driver stack (the gate).
      return context.isDriver && ticketId
        ? { pathname: "/ticket", params: { ticketId } }
        : NOTIFICATIONS_HREF;
    }
    case "lost_item_case": {
      // M14 (UC-D-21): `lost_item.case_*` pushes open the case view.
      const ticketId = link.params?.ticketId;
      return context.isDriver && ticketId
        ? { pathname: "/lost-item-case", params: { ticketId } }
        : NOTIFICATIONS_HREF;
    }
    case "notifications":
    default:
      return NOTIFICATIONS_HREF;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringParams(value: unknown): Record<string, string> | null {
  const record = asRecord(value);
  if (!record) return null;
  const params: Record<string, string> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") params[key] = item;
  }
  return params;
}

export interface PushPayload {
  link: DeepLink | null;
  notificationId: string | null;
  /** The catalog event, e.g. `driver.balance_unblocked`. */
  event: string | null;
}

/**
 * Reads the deep link out of a push's data payload. The contract
 * (realtime-v1.yaml, "Notification delivery") fixes the FCM data keys:
 * `notificationId`, `category`, `event` and, when the notification has a
 * deep link, flat `screen` + `params` (a JSON object encoded as a string).
 * A nested `link` (object or JSON string) is also tolerated, though the
 * backend does not send it.
 */
export function parsePushPayload(data: unknown): PushPayload {
  const record = asRecord(data) ?? {};
  const notificationId =
    typeof record.notificationId === "string" ? record.notificationId : null;
  const nested = asRecord(record.link);
  const source = nested ?? record;
  const screen = typeof source.screen === "string" ? source.screen : null;
  return {
    link: screen ? { screen, params: stringParams(source.params) } : null,
    notificationId,
    event: typeof record.event === "string" ? record.event : null,
  };
}

/** `driver.balance_warning` / `_blocked` / `_unblocked` (COM-03). */
export function isBalanceEvent(event: string | null | undefined): boolean {
  return !!event && event.startsWith("driver.balance_");
}

/**
 * M12: scheduled-ride pushes the home sheet answers with a notice
 * (`scheduled.released` — a claim given back by the system;
 * `scheduled.cancelled_rider_busy`) or a resync (`scheduled.converted`).
 */
export function scheduledNoticeFor(
  event: string | null | undefined,
): "scheduledReleased" | "scheduledRiderBusy" | null {
  if (event === "scheduled.released") return "scheduledReleased";
  if (event === "scheduled.cancelled_rider_busy") return "scheduledRiderBusy";
  return null;
}

export function isScheduledConversion(event: string | null | undefined): boolean {
  return event === "scheduled.converted";
}

/** Links the ride facade must resync for before the home route shows them. */
export function isRideLink(link: DeepLink | null | undefined): boolean {
  return link?.screen === "ride" || link?.screen === "ride_offer";
}

/**
 * M11 account events (category `account`, no deep link — the center
 * opens): a role / account suspension or reactivation changes the gate, so
 * the profile is re-read when one arrives or is tapped.
 */
const ACCOUNT_STATE_EVENTS = new Set([
  "account.role_suspended",
  "account.role_reactivated",
  "account.suspended",
  "account.reactivated",
]);

export function isAccountStateEvent(event: string | null | undefined): boolean {
  return !!event && ACCOUNT_STATE_EVENTS.has(event);
}
