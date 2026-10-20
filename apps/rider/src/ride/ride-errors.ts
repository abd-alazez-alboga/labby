import type { TranslateOptions } from "i18n-js";

import { ApiError } from "../api/http-client";
import { rideErrorCode, rideErrorDetail } from "../api/rides";

type T = (key: string, options?: TranslateOptions) => string;

/** Coded ride errors the booking and route screens explain (rides-v1.yaml). */
const KNOWN_CODES = [
  "outside_region",
  "too_many_stops",
  "service_type_unavailable",
  "active_ride_exists",
  "rider_suspended",
  "payment_method_unavailable",
  "illegal_state",
] as const;

/** The `SuspensionReason` values that have a localized label. */
const SUSPENSION_REASONS = ["low_rating", "document_expired", "manual"] as const;

/**
 * User copy for a failed booking / estimate / retry / route change: the
 * contract `code` decides the message; a suspension shows its reason as a
 * localized label (UC-R-04 E3) — never the raw enum, so an unknown reason
 * shows the plain message; anything else is the generic network or server
 * message.
 */
export function rideErrorMessage(error: unknown, t: T): string {
  const code = rideErrorCode(error);
  if (code === "rider_suspended") {
    const reason = rideErrorDetail(error, "suspensionReason");
    return reason && (SUSPENSION_REASONS as readonly string[]).includes(reason)
      ? t("booking.errors.rider_suspended_reason", {
          reason: t(`booking.errors.suspensionReasons.${reason}`),
        })
      : t("booking.errors.rider_suspended");
  }
  if (code && (KNOWN_CODES as readonly string[]).includes(code)) {
    return t(`booking.errors.${code}`);
  }
  if (error instanceof ApiError) return t("booking.errors.generic");
  return t("common.networkError");
}
