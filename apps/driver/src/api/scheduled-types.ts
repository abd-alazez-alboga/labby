/**
 * Types mirroring the M12 contract (backend/docs/api/scheduled-shared-v1.yaml)
 * — the DRIVER slice: weekly availability windows (UC-D-05), the claim
 * board and claims (UC-D-11/12), and the scheduled / shared extension
 * blocks of the driver view of a ride (UC-D-13). Import-free.
 */

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const DAYS_OF_WEEK: readonly DayOfWeek[] = [1, 2, 3, 4, 5, 6, 7];

/**
 * One weekly window, wall-clock `HH:mm` in the RIDE's region zone. Start
 * inclusive, end exclusive; `endsAt < startsAt` spans midnight (belongs to
 * the day it starts on); `startsAt = endsAt` is the whole day.
 */
export interface AvailabilityWindow {
  dayOfWeek: DayOfWeek;
  startsAt: string;
  endsAt: string;
}

export interface AvailabilityWindows {
  windows: AvailabilityWindow[];
}

/** Contract `maxItems` of the weekly set. */
export const MAX_AVAILABILITY_WINDOWS = 50;

export type PaymentMethodValue = "cash" | "wallet";

/** An open scheduled ride on the claim board (pickup rounded ≈ 100 m). */
export interface ClaimBoardEntry {
  rideId: string;
  scheduledAt: string;
  pickupArea: { lat: number; lng: number; label?: string | null };
  destination: { lat: number; lng: number; label?: string | null };
  stopsCount?: number;
  serviceTypeId: string;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  /** Without surge — priced at ride time. */
  estimatedFare: number;
  currency: string;
  pricedAtRideTime: true;
  paymentMethod: PaymentMethodValue;
  estimateDistanceMeters?: number;
  estimateDurationSeconds?: number;
}

/**
 * Why the board is empty for this driver (V1 audit H7, owner ruling
 * 2026-10-20): at/below the COM-03 balance floor the board, claims and
 * conversion are closed.
 */
export type ClaimBoardBlockedReason = "balance_below_floor";

export interface ClaimBoardPage {
  items: ClaimBoardEntry[];
  page: number;
  size: number;
  totalItems: number;
  /** Set → `items` is empty; null when the board is open to the driver. */
  blockedReason: ClaimBoardBlockedReason | null;
}

export type ClaimReleaseReason = "vehicle_issue" | "unsafe_pickup" | "other";

export const CLAIM_RELEASE_REASONS: readonly ClaimReleaseReason[] = [
  "vehicle_issue",
  "unsafe_pickup",
  "other",
];

/** Contract `note.maxLength`. */
export const RELEASE_NOTE_MAX = 500;

/** The scheduled extension of a ride (kind `scheduled`). */
export interface ScheduledInfo {
  scheduledAt: string;
  claimState: "open" | "claimed" | "converted" | "fallen_back";
  claimedAt?: string | null;
  pricedAtRideTime: boolean;
}

export type MemberStatus =
  | "joined"
  | "left"
  | "cancelled"
  | "no_show"
  | "completed";

export type MemberPaymentStatus =
  | "pending"
  | "paid_cash"
  | "paid_wallet"
  | "paid_mixed"
  | "unpaid";

/** One party of a shared ride, as the driver sees it (first name, never phones). */
export interface MemberView {
  memberId: string;
  firstName?: string | null;
  isCreator: boolean;
  partySize: number;
  status: MemberStatus;
  paymentMethod: PaymentMethodValue;
  joinedAt?: string;
  /** `cancelled` after the grace, or `no_show`. */
  cancellationFee?: number | null;
  /** `completed` only — this party's part of the fare. */
  shareAmount?: number | null;
  paymentStatus?: MemberPaymentStatus | null;
  walletApplied?: number | null;
  /** Share cash part + this member's cash carried dues. */
  cashDue?: number | null;
}

/** RIDE-P4 — how the stored fare was divided. */
export interface SplitSummary {
  fareTotal: number;
  currency: string;
  boardedSeats: number;
  perSeatAmount: number;
}

/** The shared extension of a ride (kind `shared`), driver view. */
export interface SharedInfo {
  totalSeats: number;
  seatsTaken: number;
  departure: {
    mode: "at_time" | "when_full";
    departAt?: string | null;
    expiresAt?: string | null;
  };
  dispatchTrigger?: "creator" | "full" | "departure_time" | null;
  dispatchedAt?: string | null;
  /** Driver view: every party. */
  members: MemberView[];
  split?: SplitSummary | null;
}

/** Added to the rides-v1 offer of a shared ride (UC-D-13 step 1). */
export interface SharedOfferInfo {
  /** Seats taken at dispatch. */
  seats: number;
  /** Joined members (parties). */
  parties: number;
}
