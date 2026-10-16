/**
 * Types mirroring the M7 rides contract (backend/docs/api/rides-v1.yaml) —
 * the DRIVER slice: offers, the driver view of a ride, the stored fare, the
 * driver cancel request, the coded error bodies and the realtime frames.
 * Import-free so every layer can depend on them without cycles.
 */

export type RideState =
  | "requested"
  | "offering"
  | "accepted"
  | "driver_arrived"
  | "in_progress"
  | "completed"
  | "cancelled_by_rider"
  | "cancelled_by_driver"
  | "no_driver_found";

export type PaymentMethod = "cash" | "wallet";
/**
 * null until `completed`. M8 (money-v1.yaml): `paid_wallet` = fare fully
 * covered by the wallet at completion AND no cash carried due
 * (auto-confirmed); otherwise `pending` until the driver confirms cash
 * (`paid_mixed` when the wallet paid part of the fare, else `paid_cash`)
 * or marks it unpaid.
 */
export type PaymentStatus =
  | "pending"
  | "paid_cash"
  | "paid_wallet"
  | "paid_mixed"
  | "unpaid";

export interface Place {
  lat: number;
  lng: number;
  /** Display text (search result / saved name). */
  label?: string | null;
}

export interface ComfortPreferences {
  temperature: "no_preference" | "cool" | "normal" | "warm";
  conversation: "no_preference" | "quiet" | "chatty";
  music: "no_preference" | "none" | "soft" | "any";
}

/** What the driver sees of the rider from the offer on. */
export interface RiderSummary {
  firstName: string;
  /**
   * M11 (RATE-02): the rider-role LIFETIME average from the daily snapshot
   * (2 decimals); null below 5 ratings — then nothing is shown.
   */
  rating?: number | null;
  comfort: ComfortPreferences;
}

/**
 * Money components (region currency, 2 decimals). total = baseFare +
 * distanceFare + timeFare + surchargeAmount + surgeAmount + waitFare +
 * pickupFee + minimumFareAdjustment − discount.
 */
export interface FareComponents {
  currency: string;
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  surchargePercent: number;
  surchargeAmount: number;
  surgeMultiplier: number;
  surgeAmount: number;
  waitFare: number;
  pickupFee: number;
  minimumFareAdjustment: number;
  discount: number;
  total: number;
}

export interface Estimate {
  distanceMeters: number;
  durationSeconds: number;
  approximate: boolean;
  components: FareComponents;
}

/** The stored fare (fares row) — never recomputed (PRC-04). */
export interface FinalFare {
  distanceMeters: number;
  durationSeconds: number;
  components: FareComponents;
}

export interface Timeline {
  requestedAt: string;
  offeringAt?: string | null;
  acceptedAt?: string | null;
  driverArrivedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  noDriverFoundAt?: string | null;
}

export type DriverCancelReason =
  | "rider_no_show"
  | "vehicle_issue"
  | "unsafe_pickup"
  | "other";

export const DRIVER_CANCEL_REASONS: readonly DriverCancelReason[] = [
  "rider_no_show",
  "vehicle_issue",
  "unsafe_pickup",
  "other",
];

/** Contract `note.maxLength`. */
export const CANCEL_NOTE_MAX = 500;

/**
 * M8 (rides-v1 CarriedDue): a rider's cancellation fee from an earlier
 * ride, collected with this one — `wallet` dues are taken from the rider's
 * wallet at completion (always `collected`); `cash` dues are collected by
 * the driver (`earmarked` while payment is pending, `collected` after the
 * cash-confirm; released — gone from the list — after mark-unpaid).
 */
export interface CarriedDue {
  dueId: string;
  /** The cancelled ride the fee came from. */
  sourceRideId: string;
  /** Always in the ride's currency. */
  amount: number;
  currency: string;
  method: "wallet" | "cash";
  status: "earmarked" | "collected";
}

/** One ride as its DRIVER sees it (`rider` set, `driver` null). */
export interface Ride {
  id: string;
  state: RideState;
  kind: "on_demand" | "scheduled" | "shared";
  regionId: string;
  serviceTypeId: string;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  pickup: Place;
  destination: Place;
  stops: Place[];
  paymentMethod: PaymentMethod;
  surgeMultiplier: number;
  surchargePercent: number;
  estimate: Estimate;
  timeline: Timeline;
  cancellationGraceEndsAt?: string | null;
  /** driverArrivedAt + region wait grace — no-show allowed from then on. */
  waitGraceEndsAt?: string | null;
  cancellationReason?: string | null;
  cancellationFee?: number | null;
  fare?: FinalFare | null;
  paymentStatus?: PaymentStatus | null;
  /** M8 (PAY-02): wallet part of the FARE (null on cash-method rides). */
  walletApplied?: number | null;
  /**
   * M8 (PAY-02): cash the driver collects = the cash part of the fare +
   * every CASH carried due of this ride; null when nothing is owed in cash.
   */
  cashDue?: number | null;
  /** M8 (W6): cancellation fees from earlier rides carried by this one. */
  carriedDues: CarriedDue[];
  /** M8 (PAY-04): outside the fare total. */
  tip?: number | null;
  driverStream?: "ok" | "lost" | null;
  /** To the pickup before start, to the destination after. */
  etaSeconds?: number | null;
  redispatchOfRideId?: string | null;
  rider?: RiderSummary | null;
  /** M11 (RATE-01): the caller's OWN rating state for this ride (trust-v1 MyRating). */
  myRating?: MyRating | null;
}

/** trust-v1 `MyRating` — never describes ratings the caller received. */
export interface MyRating {
  state: "pending" | "submitted" | "expired" | "not_applicable";
  /** completedAt + 7 days. */
  windowEndsAt?: string | null;
  /** The score the caller gave (`submitted`). */
  score?: number | null;
}

/** UC-D-06 offer card. */
export interface RideOffer {
  id: string;
  rideId: string;
  offeredAt?: string;
  /** offeredAt + 15 s. */
  expiresAt: string;
  pickup: Place;
  pickupDistanceMeters: number;
  pickupEtaSeconds: number;
  destination: Place;
  stops: Place[];
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  estimatedFare: number;
  currency: string;
  surge: boolean;
  paymentMethod: PaymentMethod;
  rider: RiderSummary;
}

/** Ride error body: the M1 ErrorResponse + machine `code` / `details`. */
export interface RideErrorBody {
  status?: number;
  message?: string;
  code?: string;
  details?: Record<string, unknown> | null;
}

/** Ride / offer frames on the realtime socket (rides-v1 "Realtime events"). */
export type RideFrame =
  | { type: "offer.new"; offer: RideOffer }
  | {
      type: "offer.withdrawn";
      offerId: string;
      rideId: string;
      reason: "timeout" | "ride_ended" | string;
    }
  | { type: "ride.state"; ride: Ride }
  | {
      type: "ride.updated";
      reason: "route_changed" | "payment_confirmed" | "payment_unpaid" | string;
      ride: Ride;
    }
  | { type: "ride.connection"; rideId: string; driverStream: "ok" | "lost" };

/** States in which the ride is the driver's current job. */
export function isActiveForDriver(ride: Ride): boolean {
  switch (ride.state) {
    case "accepted":
    case "driver_arrived":
    case "in_progress":
      return true;
    case "completed":
      return ride.paymentStatus === "pending";
    default:
      return false;
  }
}
