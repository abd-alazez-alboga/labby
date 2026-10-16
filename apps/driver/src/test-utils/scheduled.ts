import type { Ride } from "../api/ride-types";
import type {
  ClaimBoardEntry,
  ClaimBoardPage,
  MemberView,
} from "../api/scheduled-types";
import type { MockResponse } from "./contract";
import { componentsFixture, rideFixture } from "./rides";

/** Contract-shaped fixtures for scheduled-shared-v1.yaml (driver view). */

export const WINDOWS_GET = "GET /api/v1/driver/availability-windows";
export const WINDOWS_PUT = "PUT /api/v1/driver/availability-windows";
export const BOARD = "GET /api/v1/driver/claim-board?page=0&size=20";
export const CLAIMS = "GET /api/v1/driver/scheduled-rides";

export const SCHEDULED_ID = "5b1d3f0e-3333-4c4c-9a9a-000000000001";
export const SCHEDULED_ID_2 = "5b1d3f0e-3333-4c4c-9a9a-000000000002";

export const claimRoute = (rideId: string) =>
  `POST /api/v1/driver/scheduled-rides/${rideId}/claim`;
export const releaseRoute = (rideId: string) =>
  `POST /api/v1/driver/scheduled-rides/${rideId}/release`;
export const memberRoute = (rideId: string, memberId: string, action: string) =>
  `POST /api/v1/driver/rides/${rideId}/members/${memberId}/${action}`;

export const ok = (body: unknown): MockResponse => ({ status: 200, body });

export function coded(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
): MockResponse {
  return { status, body: { status, message: code, code, details } };
}

/** ISO time `hours` from now. */
export function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3_600_000).toISOString();
}

export function boardEntry(
  overrides: Partial<ClaimBoardEntry> = {},
): ClaimBoardEntry {
  return {
    rideId: SCHEDULED_ID,
    scheduledAt: inHours(14),
    pickupArea: { lat: 33.5, lng: 36.28, label: "Mazzeh Autostrad" },
    destination: { lat: 33.513, lng: 36.292, label: "Umayyad Square" },
    stopsCount: 0,
    serviceTypeId: "9b000000-0000-4000-8000-000000000001",
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادي",
    estimatedFare: 22000,
    currency: "SYP",
    pricedAtRideTime: true,
    paymentMethod: "cash",
    estimateDistanceMeters: 4200,
    estimateDurationSeconds: 720,
    ...overrides,
  };
}

export function boardPage(
  items: ClaimBoardEntry[],
  totalItems = items.length,
): ClaimBoardPage {
  return { items, page: 0, size: 20, totalItems };
}

/** A claimed scheduled ride, not yet live (driver view, exact pickup). */
export function claimedRide(overrides: Partial<Ride> = {}): Ride {
  const scheduledAt = inHours(30);
  return rideFixture({
    id: SCHEDULED_ID,
    kind: "scheduled",
    state: "scheduled",
    pickup: { lat: 33.5001, lng: 36.2802, label: "Mazzeh Autostrad, gate 3" },
    scheduled: {
      scheduledAt,
      claimState: "claimed",
      claimedAt: new Date().toISOString(),
      pricedAtRideTime: true,
    },
    ...overrides,
  });
}

export function member(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: "6c000000-0000-4000-8000-000000000001",
    firstName: "Rana",
    isCreator: true,
    partySize: 2,
    status: "joined",
    paymentMethod: "cash",
    joinedAt: "2026-10-16T08:00:00Z",
    cancellationFee: null,
    shareAmount: null,
    paymentStatus: null,
    walletApplied: null,
    cashDue: null,
    ...overrides,
  };
}

export const RANA = member();
export const OMAR = member({
  memberId: "6c000000-0000-4000-8000-000000000002",
  firstName: "Omar",
  isCreator: false,
  partySize: 1,
  paymentMethod: "wallet",
});
export const LINA = member({
  memberId: "6c000000-0000-4000-8000-000000000003",
  firstName: "Lina",
  isCreator: false,
  partySize: 1,
});

/** A dispatched shared ride (driver view) with every party. */
export function sharedRide(
  overrides: Partial<Ride> = {},
  members: MemberView[] = [RANA, OMAR, LINA],
): Ride {
  return rideFixture({
    kind: "shared",
    rider: null,
    pickup: { lat: 33.5, lng: 36.28, label: "Baramkeh bus station" },
    destination: { lat: 33.51, lng: 36.25, label: "Damascus University" },
    shared: {
      totalSeats: 4,
      seatsTaken: 4,
      departure: { mode: "when_full", departAt: null, expiresAt: null },
      dispatchTrigger: "full",
      dispatchedAt: new Date(Date.now() - 300_000).toISOString(),
      members,
      split: null,
    },
    ...overrides,
  });
}

/** Completed shared ride: Rana cash pending, Omar wallet paid, Lina absent. */
export function completedShared(overrides: Partial<Ride> = {}): Ride {
  return sharedRide(
    {
      state: "completed",
      paymentStatus: "split",
      fare: {
        distanceMeters: 11000,
        durationSeconds: 1500,
        components: componentsFixture({ total: 28500 }),
      },
      ...overrides,
    },
    [
      { ...RANA, status: "completed", shareAmount: 19000, cashDue: 19000, paymentStatus: "pending" },
      { ...OMAR, status: "completed", shareAmount: 9500, walletApplied: 9500, paymentStatus: "paid_wallet" },
      { ...LINA, status: "no_show", cancellationFee: 2000 },
    ],
  );
}

export function withSplit(ride: Ride): Ride {
  return {
    ...ride,
    shared: ride.shared
      ? {
          ...ride.shared,
          split: { fareTotal: 28500, currency: "SYP", boardedSeats: 3, perSeatAmount: 9500 },
        }
      : null,
  };
}
