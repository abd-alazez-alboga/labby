import type { TripEarning } from "../api/money-types";
import { isCancelledTrip } from "../api/money-types";

/**
 * Display helpers for the driver's past trips (V1 conformance W43, boards
 * V1FDriverEarningsTrips / V1FDriverTripDetail*). Western digits in both
 * languages (owner ruling 2026-10-11). Nothing here computes money.
 */

/** How a cancelled-after-accept trip ended (null: the ride completed). */
export type TripCancellation = "rider" | "driver" | "noShow";

export function cancellationOf(earning: TripEarning): TripCancellation | null {
  if (earning.rideState === "cancelled_by_rider") return "rider";
  if (earning.rideState === "cancelled_by_driver") {
    return earning.cancellationReason === "rider_no_show" ? "noShow" : "driver";
  }
  return null;
}

/** A trip row's identity: the ride, plus the member on a shared ride. */
export function tripRowKey(earning: TripEarning): string {
  return `${earning.rideId}:${earning.memberId ?? ""}`;
}

/**
 * The trip's place label: where a completed ride ended; where a cancelled
 * one was to pick up (it never got further). Either falls back to the other.
 */
export function tripPlace(earning: TripEarning): string | null {
  return isCancelledTrip(earning)
    ? (earning.pickupLabel ?? earning.destinationLabel ?? null)
    : (earning.destinationLabel ?? earning.pickupLabel ?? null);
}

/**
 * The moment the trip is told by: a completed ride's completion, a cancelled
 * one's acceptance (its row moment is the cancellation).
 */
export function tripMoment(earning: TripEarning): string {
  return isCancelledTrip(earning)
    ? (earning.acceptedAt ?? earning.completedAt)
    : earning.completedAt;
}

function dateLocale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

/** Device-local calendar day of an ISO date-time ("2026-10-11"). */
export function localDayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "Sat 11 Oct" — the local weekday, day and short month of an ISO date-time. */
export function formatTripDay(iso: string, language: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat(dateLocale(language), {
      weekday: "short",
      day: "numeric",
      month: "short",
    }).format(date);
  } catch {
    return iso.slice(0, 10);
  }
}
