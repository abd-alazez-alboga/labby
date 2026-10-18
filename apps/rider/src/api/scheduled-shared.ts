import { ApiError, apiFetch } from "./http-client";
import type {
  CancellationQuote,
  DriverSummary,
  PaymentMethod,
  Place,
  Ride,
  RiderCancelReason,
} from "./rides";

/**
 * Client slice of the M12 contract for the rider app
 * (backend/docs/api/scheduled-shared-v1.yaml): scheduling a ride for later
 * and the upcoming list (UC-R-10/11), and public shared rides — create,
 * browse, join, leave, creator start / cancel (UC-R-12…15). Types mirror the
 * contract schemas 1:1; screens never call fetch themselves.
 */

// --------------------------------------------------------------- schemas

/** Scheduling needs this much notice (SRS §9 default `minLeadMin`). */
export const DEFAULT_MIN_LEAD_MIN = 30;
/** Claimed rides convert / unclaimed fall back this long before pickup. */
export const DEFAULT_FALLBACK_LEAD_MIN = 15;
/** The rider is warned before booking now when a scheduled ride is this close (ruling 2026-10-16). */
export const SCHEDULED_WARNING_MIN = 60;

export type ClaimState = "open" | "claimed" | "converted" | "fallen_back";

/** The scheduled extension of a ride (`ScheduledInfo`). */
export interface ScheduledInfo {
  scheduledAt: string;
  claimState: ClaimState;
  claimedAt?: string | null;
  /** True while `scheduled` — the surge is evaluated at execution (RIDE-S1). */
  pricedAtRideTime: boolean;
  /** Rider view, once claimed. */
  claimedBy?: DriverSummary | null;
}

export type DepartureMode = "at_time" | "when_full";

export interface Departure {
  mode: DepartureMode;
  /** `at_time` only. */
  departAt?: string | null;
  /** `when_full` only — created + 24 h. */
  expiresAt?: string | null;
}

export type MemberStatus =
  | "joined"
  | "left"
  | "cancelled"
  | "no_show"
  | "completed";

/** One party; rider views only ever show the caller's own (`me`). */
export interface MemberView {
  memberId: string;
  firstName?: string | null;
  isCreator: boolean;
  partySize: number;
  status: MemberStatus;
  paymentMethod: PaymentMethod;
  joinedAt?: string;
  cancellationFee?: number | null;
  /** `completed` only — this party's part of the fare. */
  shareAmount?: number | null;
  paymentStatus?:
    | "pending"
    | "paid_cash"
    | "paid_wallet"
    | "paid_mixed"
    | "unpaid"
    | null;
  walletApplied?: number | null;
  cashDue?: number | null;
}

/** RIDE-P4 — how the stored fare was divided. */
export interface SplitSummary {
  fareTotal: number;
  currency: string;
  boardedSeats: number;
  /** F ÷ B, half-up to 2 dp (before the remainder). */
  perSeatAmount: number;
}

/** The shared extension of a ride (`SharedInfo`). */
export interface SharedInfo {
  totalSeats: number;
  seatsTaken: number;
  departure: Departure;
  dispatchTrigger?: "creator" | "full" | "departure_time" | null;
  dispatchedAt?: string | null;
  isCreator: boolean;
  me?: MemberView | null;
  members?: MemberView[];
  split?: SplitSummary | null;
}

/** Browse card / detail / member view of a shared ride (`SharedRide`). */
export interface SharedRide {
  rideId: string;
  state:
    | "gathering"
    | "requested"
    | "offering"
    | "accepted"
    | "driver_arrived"
    | "in_progress"
    | "completed"
    | "cancelled_by_rider"
    | "cancelled_by_driver"
    | "no_driver_found";
  regionId: string;
  pickup: Place;
  destination: Place;
  serviceTypeId: string;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  departure: Departure;
  totalSeats: number;
  seatsTaken: number;
  seatsLeft: number;
  /** Whole-ride estimate; the per-seat basis is fare ÷ boarded seats. */
  estimateTotal: number;
  currency: string;
  /** True while `gathering` — surge is locked at dispatch. */
  pricedAtDispatch: boolean;
  creatorFirstName?: string;
  isCreator?: boolean;
  me?: MemberView | null;
  cancellationReason?: string | null;
}

export interface SharedRidePage {
  items: SharedRide[];
  page: number;
  size: number;
  totalItems: number;
}

export interface ScheduleRideRequest {
  pickup: Place;
  destination: Place;
  stops?: Place[];
  serviceTypeId: string;
  paymentMethod: PaymentMethod;
  /** Pickup time; ≥ now + minLeadMin, no upper bound. */
  scheduledAt: string;
  /** M13 ruling 3: validated + reserved now, the amount computed at ride time. */
  promoCode?: string | null;
}

export interface CreateSharedRideRequest {
  pickup: Place;
  destination: Place;
  serviceTypeId: string;
  paymentMethod: PaymentMethod;
  totalSeats: number;
  partySize: number;
  departure: { mode: DepartureMode; departAt?: string | null };
  /** M13 ruling 2: discounts the creator's own seat share at the split. */
  promoCode?: string | null;
}

export const SHARED_MIN_SEATS = 2;
export const SHARED_MAX_SEATS = 8;

/** Reasons a member gives when leaving after dispatch (RIDE-07). */
export const SHARED_LEAVE_REASONS = [
  "changed_mind",
  "driver_too_far",
  "wrong_pickup",
  "other",
] as const satisfies readonly RiderCancelReason[];

/** The creator's cancel before dispatch (`RiderCancelRequest`). */
export const SHARED_CANCEL_REASONS = ["changed_mind", "other"] as const;
export type SharedCancelReason = (typeof SHARED_CANCEL_REASONS)[number];

/** A scheduled ride is cancelled with the rides-v1 cancel (pre-live reasons only). */
export const SCHEDULED_CANCEL_REASONS = [
  "changed_mind",
  "wrong_pickup",
  "other",
] as const satisfies readonly RiderCancelReason[];

export interface SharedBrowseQuery {
  lat: number;
  lng: number;
  destLat?: number;
  destLng?: number;
  departFrom?: string;
  departTo?: string;
  page?: number;
}

// ------------------------------------------------------------- endpoints

const SCHEDULED = "/api/v1/scheduled-rides";
const SHARED = "/api/v1/shared-rides";

function sharedUrl(rideId: string, suffix = ""): string {
  return `${SHARED}/${encodeURIComponent(rideId)}${suffix}`;
}

function json(body: unknown): string {
  return JSON.stringify(body);
}

/**
 * `POST /scheduled-rides` (S1) — 422 `scheduled_too_soon` with
 * `details.minLeadMinutes` when the time is too near; never converted to
 * on-demand (ruling 2026-10-16).
 */
export function scheduleRide(request: ScheduleRideRequest): Promise<Ride> {
  return apiFetch<Ride>(SCHEDULED, {
    method: "POST",
    auth: true,
    body: json(request),
  });
}

/** `GET /scheduled-rides` — upcoming (still `scheduled`), soonest first. */
export function listScheduledRides(): Promise<Ride[]> {
  return apiFetch<Ride[]>(SCHEDULED, { auth: true });
}

export const SHARED_PAGE_SIZE = 20;

/** `GET /shared-rides` — open rides of the region containing the point. */
export function listSharedRides(query: SharedBrowseQuery): Promise<SharedRidePage> {
  const params = new URLSearchParams({
    lat: String(query.lat),
    lng: String(query.lng),
    page: String(query.page ?? 0),
    size: String(SHARED_PAGE_SIZE),
  });
  if (query.destLat !== undefined && query.destLng !== undefined) {
    params.set("destLat", String(query.destLat));
    params.set("destLng", String(query.destLng));
  }
  if (query.departFrom) params.set("departFrom", query.departFrom);
  if (query.departTo) params.set("departTo", query.departTo);
  return apiFetch<SharedRidePage>(`${SHARED}?${params.toString()}`, {
    auth: true,
  });
}

/** `GET /shared-rides/{id}` — browse detail or the caller's member view. */
export function getSharedRide(rideId: string): Promise<SharedRide> {
  return apiFetch<SharedRide>(sharedUrl(rideId), { auth: true });
}

/**
 * `GET /shared-rides/mine/open` — the caller's still-gathering shared ride
 * for the home entry (W10); null when they have none (404
 * `no_open_shared_ride`).
 */
export function getMyOpenSharedRide(): Promise<SharedRide | null> {
  return apiFetch<SharedRide>(`${SHARED}/mine/open`, { auth: true }).catch(
    (error: unknown) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    },
  );
}

/** `POST /shared-rides` (P1) — the creator becomes the first member. */
export function createSharedRide(
  request: CreateSharedRideRequest,
): Promise<SharedRide> {
  return apiFetch<SharedRide>(SHARED, {
    method: "POST",
    auth: true,
    body: json(request),
  });
}

/**
 * `POST /shared-rides/{id}/join` — first-come; 409 `insufficient_seats` /
 * `shared_ride_closed`. `promoCode` (M13 ruling 2) discounts the member's
 * own seat share; one promo per ride → 409 `promo_already_applied`.
 */
export function joinSharedRide(
  rideId: string,
  partySize: number,
  paymentMethod: PaymentMethod,
  promoCode?: string | null,
): Promise<SharedRide> {
  return apiFetch<SharedRide>(sharedUrl(rideId, "/join"), {
    method: "POST",
    auth: true,
    body: json(
      promoCode ? { partySize, paymentMethod, promoCode } : { partySize, paymentMethod },
    ),
  });
}

/** `GET /shared-rides/{id}/leave-quote` — free before dispatch, RIDE-07 after. */
export function getLeaveQuote(rideId: string): Promise<CancellationQuote> {
  return apiFetch<CancellationQuote>(sharedUrl(rideId, "/leave-quote"), {
    auth: true,
  });
}

/** `POST /shared-rides/{id}/leave` — the reason is required after dispatch only. */
export function leaveSharedRide(
  rideId: string,
  reason?: RiderCancelReason,
  note?: string,
): Promise<SharedRide> {
  const body = reason ? (note ? { reason, note } : { reason }) : {};
  return apiFetch<SharedRide>(sharedUrl(rideId, "/leave"), {
    method: "POST",
    auth: true,
    body: json(body),
  });
}

/** `POST /shared-rides/{id}/start` — creator only (P2 trigger `creator`). */
export function startSharedRide(rideId: string): Promise<SharedRide> {
  return apiFetch<SharedRide>(sharedUrl(rideId, "/start"), {
    method: "POST",
    auth: true,
  });
}

/** `POST /shared-rides/{id}/cancel` — creator, before dispatch (P3). */
export function cancelSharedRide(
  rideId: string,
  reason: SharedCancelReason,
  note?: string,
): Promise<SharedRide> {
  return apiFetch<SharedRide>(sharedUrl(rideId, "/cancel"), {
    method: "POST",
    auth: true,
    body: json(note ? { reason, note } : { reason }),
  });
}
