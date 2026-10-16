import { authFetch } from "./client";
import type { Ride } from "./ride-types";
import type {
  AvailabilityWindows,
  ClaimBoardPage,
  ClaimReleaseReason,
} from "./scheduled-types";

/**
 * Client slice of scheduled-shared-v1.yaml for the driver: weekly
 * availability windows (UC-D-05), the claim board, claims and releases
 * (UC-D-11/12) and the per-member shared-ride actions (UC-D-13).
 */

const WINDOWS = "/api/v1/driver/availability-windows";

/** `GET /driver/availability-windows` — by weekday then start. */
export function getAvailabilityWindows(): Promise<AvailabilityWindows> {
  return authFetch<AvailabilityWindows>(WINDOWS);
}

/** `PUT /driver/availability-windows` — replaces the whole set; 400 on a bad / duplicate window. */
export function putAvailabilityWindows(
  windows: AvailabilityWindows,
): Promise<AvailabilityWindows> {
  return authFetch<AvailabilityWindows>(WINDOWS, {
    method: "PUT",
    body: windows,
  });
}

/** `GET /driver/claim-board` — open rides inside the driver's windows, soonest first. */
export function getClaimBoard(page = 0, size = 20): Promise<ClaimBoardPage> {
  return authFetch<ClaimBoardPage>(
    `/api/v1/driver/claim-board?page=${page}&size=${size}`,
  );
}

/** `GET /driver/scheduled-rides` — the driver's claims not yet converted, soonest first. */
export function getClaimedRides(): Promise<Ride[]> {
  return authFetch<Ride[]>("/api/v1/driver/scheduled-rides");
}

/**
 * `POST /driver/scheduled-rides/{id}/claim` — 409 `already_claimed` |
 * `claim_closed` (UC-D-11 E1: refresh); 422 `not_eligible` (`details.rule`).
 */
export function claimScheduledRide(rideId: string): Promise<Ride> {
  return authFetch<Ride>(`/api/v1/driver/scheduled-rides/${rideId}/claim`, {
    method: "POST",
  });
}

/**
 * `POST /driver/scheduled-rides/{id}/release` — 204; `other` needs a note;
 * 409 `illegal_state` once converted (UC-D-12 E1).
 */
export async function releaseScheduledRide(
  rideId: string,
  reason: ClaimReleaseReason,
  note?: string,
): Promise<void> {
  await authFetch<null>(`/api/v1/driver/scheduled-rides/${rideId}/release`, {
    method: "POST",
    body: note ? { reason, note } : { reason },
  });
}

function memberAction(rideId: string, memberId: string, action: string) {
  return authFetch<Ride>(
    `/api/v1/driver/rides/${rideId}/members/${memberId}/${action}`,
    { method: "POST" },
  );
}

/**
 * UC-D-13 E1 — `driver_arrived` after the wait grace; 409
 * `wait_grace_running` (`details.waitGraceEndsAt`) | `illegal_state`.
 */
export function markMemberNoShow(rideId: string, memberId: string): Promise<Ride> {
  return memberAction(rideId, memberId, "no-show");
}

/** UC-D-13 step 3 — one member's cash; 409 when not `pending`. */
export function confirmMemberCash(rideId: string, memberId: string): Promise<Ride> {
  return memberAction(rideId, memberId, "cash-confirm");
}

/** One member's cash unpaid; 409 when not `pending`. */
export function markMemberUnpaid(rideId: string, memberId: string): Promise<Ride> {
  return memberAction(rideId, memberId, "mark-unpaid");
}
