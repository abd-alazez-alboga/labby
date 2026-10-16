/**
 * Contract-shaped fixtures for trust-v1.yaml (rider side) and the M11
 * additions to rides-v1 (`Ride.myRating`) and auth-v1 (suspension state).
 */
import type { UserProfile } from "../api/auth";
import type { Ride } from "../api/rides";
import type { MyRating, OwnReport, PendingRating } from "../api/trust";
import { sampleUser } from "./mock-api";
import { acceptedRide, components, RIDE_ID } from "./ride-fixtures";

export const RIDE_2 = "55555555-5555-4555-8555-555555555555";
export const RIDE_3 = "66666666-6666-4666-8666-666666666666";
export const RIDE_4 = "88888888-8888-4888-8888-888888888888";

const DAY = 86_400_000;

/** An ISO instant `days` from now (negative = in the past). */
export function inDays(days: number): string {
  return new Date(Date.now() + days * DAY).toISOString();
}

export function pendingRating(windowDays = 6): MyRating {
  return { state: "pending", windowEndsAt: inDays(windowDays), score: null };
}

/** A completed rider ride with its own rating state. */
export function completedRide(
  myRating: MyRating | null = pendingRating(),
  overrides: Partial<Ride> = {},
): Ride {
  return acceptedRide({
    state: "completed",
    paymentStatus: "pending",
    timeline: {
      requestedAt: "2026-10-08T09:29:00Z",
      acceptedAt: "2026-10-08T09:29:20Z",
      startedAt: "2026-10-08T09:31:00Z",
      completedAt: "2026-10-08T09:43:00Z",
    },
    fare: {
      distanceMeters: 4200,
      durationSeconds: 840,
      components: components({ total: 27250 }),
    },
    myRating,
    ...overrides,
  });
}

export function pendingPrompt(
  overrides: Partial<PendingRating> = {},
): PendingRating {
  return {
    rideId: RIDE_ID,
    completedAt: inDays(-1),
    windowEndsAt: inDays(6),
    counterpartFirstName: "Samer",
    counterpartPhotoUrl: null,
    pickupLabel: "Mazzeh Autostrad",
    destinationLabel: "Umayyad Square",
    ...overrides,
  };
}

export function ownReport(overrides: Partial<OwnReport> = {}): OwnReport {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    rideId: RIDE_ID,
    category: "unsafe_driving",
    status: "open",
    createdAt: "2026-10-14T09:50:00Z",
    resolvedAt: null,
    ...overrides,
  };
}

export function riderRoleSuspended(
  reason: "low_rating" | "manual",
  note: string | null = null,
): UserProfile {
  return {
    ...sampleUser,
    roles: [
      {
        role: "rider",
        state: "suspended",
        suspensionReason: reason,
        suspensionNote: note,
      },
    ],
  };
}

export function accountSuspended(note: string | null): UserProfile {
  return { ...sampleUser, state: "suspended", suspensionNote: note };
}

/** A 409 / 403 error body with a machine code (global ErrorResponse). */
export function coded(status: number, code: string) {
  return { status, body: { status, message: code, code } };
}
