import { ApiError, authFetch } from "./client";
import type {
  DriverCancelReason,
  Ride,
  RideErrorBody,
  RideOffer,
} from "./ride-types";

/**
 * Client slice of rides-v1.yaml for the driver (DriverOffers, DriverRides —
 * UC-D-06..10). A 204 parses to null (see apiFetch).
 */

/** `GET /driver/offers/open` — the open offer, or null (204). */
export async function getOpenOffer(): Promise<RideOffer | null> {
  return (await authFetch<RideOffer | null>("/api/v1/driver/offers/open")) ?? null;
}

/** `POST /driver/offers/{id}/accept` — 409 `offer_closed` (UC-D-06 E1). */
export function acceptOffer(offerId: string): Promise<Ride> {
  return authFetch<Ride>(`/api/v1/driver/offers/${offerId}/accept`, {
    method: "POST",
  });
}

/** `POST /driver/offers/{id}/decline` — 204; 409 `offer_closed`. */
export async function declineOffer(offerId: string): Promise<void> {
  await authFetch<null>(`/api/v1/driver/offers/${offerId}/decline`, {
    method: "POST",
  });
}

/** `GET /driver/rides/active` — the current job, or null (204). */
export async function getActiveRide(): Promise<Ride | null> {
  return (await authFetch<Ride | null>("/api/v1/driver/rides/active")) ?? null;
}

/** `GET /driver/rides/{id}` (driver view). */
export function getDriverRide(rideId: string): Promise<Ride> {
  return authFetch<Ride>(`/api/v1/driver/rides/${rideId}`);
}

function rideAction(rideId: string, action: string, body?: unknown) {
  return authFetch<Ride>(`/api/v1/driver/rides/${rideId}/${action}`, {
    method: "POST",
    ...(body !== undefined ? { body } : {}),
  });
}

/** Transition 7 — 422 `outside_geofence` | `no_position` (GeofenceError). */
export function arriveAtPickup(rideId: string): Promise<Ride> {
  return rideAction(rideId, "arrive");
}

/** Transition 8. */
export function startRide(rideId: string): Promise<Ride> {
  return rideAction(rideId, "start");
}

/** Transition 9 — the metered fare is computed and STORED server-side. */
export function completeRide(rideId: string): Promise<Ride> {
  return rideAction(rideId, "complete");
}

/** UC-D-09 — pending → paid_cash; 409 `payment_not_pending`. */
export function confirmCash(rideId: string): Promise<Ride> {
  return rideAction(rideId, "cash-confirm");
}

/** UC-D-09 E1 — pending → unpaid; 409 `payment_not_pending`. */
export function markUnpaid(rideId: string): Promise<Ride> {
  return rideAction(rideId, "mark-unpaid");
}

/**
 * Transition 11 — reason mandatory, `other` needs a note; `rider_no_show`
 * before the wait grace → 422 `no_show_too_early` (`details.availableAt`).
 */
export function cancelDriverRide(
  rideId: string,
  reason: DriverCancelReason,
  note?: string,
): Promise<Ride> {
  return rideAction(rideId, "cancel", note ? { reason, note } : { reason });
}

/** The machine `code` of a ride error (and its details), or null. */
export function rideErrorOf(
  error: unknown,
): { status: number; code: string | null; details: Record<string, unknown> } | null {
  if (!(error instanceof ApiError)) return null;
  const body = (error.body ?? {}) as RideErrorBody;
  return {
    status: error.status,
    code: typeof body.code === "string" ? body.code : null,
    details:
      body.details && typeof body.details === "object" ? body.details : {},
  };
}
