/**
 * Contract-shaped fixtures for scheduled-shared-v1.yaml (rider views):
 * scheduled rides (state `scheduled` + `ScheduledInfo`), shared rides
 * (`SharedRide` browse/member views) and a live shared ride (rides-v1 Ride
 * with its `SharedInfo`).
 */
import type { Ride } from "../api/rides";
import type { MemberView, SharedRide } from "../api/scheduled-shared";
import { acceptedRide, destinationPlace, pickupPlace, ride, sampleDriver } from "./ride-fixtures";

export const SCHEDULED_ID = "55555555-5555-4555-8555-555555555555";
export const SCHEDULED_OPEN_ID = "66666666-6666-4666-8666-666666666666";
export const SHARED_ID = "77777777-7777-4777-8777-777777777777";
export const MEMBER_ID = "88888888-8888-4888-8888-888888888888";

/** A local time `minutes` from now as ISO. */
export function inMinutes(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() + minutes * 60 * 1000).toISOString();
}

export function scheduledRide(overrides: Partial<Ride> = {}): Ride {
  return ride({
    id: SCHEDULED_ID,
    state: "scheduled",
    kind: "scheduled",
    destination: { lat: 33.4114, lng: 36.5156, label: "Damascus Airport" },
    scheduled: {
      scheduledAt: inMinutes(24 * 60),
      claimState: "claimed",
      claimedAt: inMinutes(-60),
      pricedAtRideTime: true,
      claimedBy: { ...sampleDriver, rating: 4.9 },
    },
    ...overrides,
  });
}

export function openScheduledRide(overrides: Partial<Ride> = {}): Ride {
  return scheduledRide({
    id: SCHEDULED_OPEN_ID,
    destination: destinationPlace,
    scheduled: {
      scheduledAt: inMinutes(48 * 60),
      claimState: "open",
      claimedAt: null,
      pricedAtRideTime: true,
      claimedBy: null,
    },
    ...overrides,
  });
}

export function member(overrides: Partial<MemberView> = {}): MemberView {
  return {
    memberId: MEMBER_ID,
    isCreator: false,
    partySize: 2,
    status: "joined",
    paymentMethod: "cash",
    joinedAt: "2026-10-16T16:00:00Z",
    cancellationFee: null,
    shareAmount: null,
    paymentStatus: null,
    walletApplied: null,
    cashDue: null,
    ...overrides,
  };
}

export function sharedRide(overrides: Partial<SharedRide> = {}): SharedRide {
  return {
    rideId: SHARED_ID,
    state: "gathering",
    regionId: "44444444-4444-4444-8444-444444444444",
    pickup: pickupPlace,
    destination: { lat: 33.5109, lng: 36.2927, label: "Damascus University" },
    serviceTypeId: "22222222-2222-4222-8222-222222222222",
    serviceTypeNameEn: "Economy",
    serviceTypeNameAr: "اقتصادية",
    departure: { mode: "at_time", departAt: inMinutes(90), expiresAt: null },
    totalSeats: 4,
    seatsTaken: 2,
    seatsLeft: 2,
    estimateTotal: 24000,
    currency: "SYP",
    pricedAtDispatch: true,
    creatorFirstName: "Lina",
    isCreator: false,
    me: null,
    cancellationReason: null,
    ...overrides,
  };
}

/** A dispatched shared ride as the rides-v1 rider view of one member. */
export function liveSharedRide(overrides: Partial<Ride> = {}): Ride {
  return acceptedRide({
    id: SHARED_ID,
    kind: "shared",
    stops: [],
    shared: {
      totalSeats: 4,
      seatsTaken: 4,
      departure: { mode: "at_time", departAt: inMinutes(-5) },
      dispatchTrigger: "full",
      dispatchedAt: inMinutes(-3),
      isCreator: false,
      me: member(),
      members: [],
      split: null,
    },
    ...overrides,
  });
}
