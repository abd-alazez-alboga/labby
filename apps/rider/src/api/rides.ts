import type { GeoJsonLineString } from "../map/geo";
import { ApiError, apiFetch } from "./http-client";
import type { ScheduledInfo, SharedInfo } from "./scheduled-shared";
import type { MyRating } from "./trust";

/**
 * Client slice of the rides contract for the rider app
 * (backend/docs/api/rides-v1.yaml, M7): preferences + matching toggle,
 * saved places, estimate, booking, the active ride and its actions,
 * history and receipts. Types mirror the contract schemas 1:1; screens
 * never call fetch themselves.
 */

// --------------------------------------------------------------- schemas

export const RIDE_STATES = [
  // M12 pre-live states (scheduled-shared-v1.yaml): no driver, never the
  // rider's active ride.
  "scheduled",
  "gathering",
  "requested",
  "offering",
  "accepted",
  "driver_arrived",
  "in_progress",
  "completed",
  "cancelled_by_rider",
  "cancelled_by_driver",
  "no_driver_found",
] as const;
export type RideState = (typeof RIDE_STATES)[number];

/** States in which the ride is still running (not terminal). */
export const LIVE_RIDE_STATES: readonly RideState[] = [
  "requested",
  "offering",
  "accepted",
  "driver_arrived",
  "in_progress",
];

/** Transition 10: the rider may cancel only before the ride starts. */
export const RIDER_CANCELLABLE_STATES: readonly RideState[] = [
  "requested",
  "offering",
  "accepted",
  "driver_arrived",
];

/** RIDE-05: route changes from acceptance until completion. */
export const ROUTE_CHANGE_STATES: readonly RideState[] = [
  "accepted",
  "driver_arrived",
  "in_progress",
];

export function isLiveRide(state: RideState): boolean {
  return LIVE_RIDE_STATES.includes(state);
}

export type PaymentMethod = "cash" | "wallet";
/**
 * M8 (money-v1.yaml): `paid_wallet` = fare fully covered by the wallet at
 * completion; `paid_mixed` = wallet drained + cash remainder confirmed.
 */
export type PaymentStatus =
  | "pending"
  | "paid_cash"
  | "paid_wallet"
  | "paid_mixed"
  | "unpaid"
  /** M12: a completed shared ride, paid per member. */
  | "split"
  | null;
export type PickupDistanceMode = "nearby_only" | "accept_distant_fee";

/** Rides allow at most this many intermediate stops (RIDE-01). */
export const MAX_STOPS = 3;

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface Place extends LatLngPoint {
  label?: string | null;
}

export interface RouteInput {
  pickup: Place;
  destination: Place;
  stops?: Place[];
}

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
  /** Straight-line fallback (NFR-A3) — shown as "approximate". */
  approximate: boolean;
  components: FareComponents;
}

export interface ServiceTypeEstimate {
  serviceTypeId: string;
  nameEn: string;
  nameAr: string;
  estimate: Estimate;
}

export interface EstimateResponse {
  regionId: string;
  currency: string;
  /** The pickup zone's current multiplier (1.0 outside every zone); booking locks it (PRC-02). */
  surgeMultiplier: number;
  /** `surgeMultiplier > 1.0` — show + explain (UC-R-04 A2). */
  surgeActive: boolean;
  /** The zone the surge comes from; null without surge. */
  surgeZoneName: string | null;
  surchargePercent: number;
  route: {
    distanceMeters: number;
    durationSeconds: number;
    approximate: boolean;
    geometry: GeoJsonLineString;
  };
  options: ServiceTypeEstimate[];
  pickupDistanceMode: PickupDistanceMode;
  pickupFeeRule?: { thresholdKm: number; perKm: number } | null;
  /** M12: true when `scheduledAt` was sent — surge evaluated at execution. */
  pricedAtRideTime?: boolean;
}

export const TEMPERATURES = ["no_preference", "cool", "normal", "warm"] as const;
export const CONVERSATIONS = ["no_preference", "quiet", "chatty"] as const;
export const MUSIC = ["no_preference", "none", "soft", "any"] as const;

export interface ComfortPreferences {
  temperature: (typeof TEMPERATURES)[number];
  conversation: (typeof CONVERSATIONS)[number];
  music: (typeof MUSIC)[number];
}

export interface RiderPreferences extends ComfortPreferences {
  pickupDistanceMode: PickupDistanceMode;
}

export interface SavedLocation {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
}

export interface SavedLocationUpsert {
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
}

export interface DriverSummary {
  firstName: string;
  photoUrl?: string | null;
  /**
   * Driver-role lifetime average from the daily snapshot (M11, RATE-02);
   * null below 5 ratings — then nothing is shown.
   */
  rating?: number | null;
  vehicle: {
    make: string;
    model: string;
    color: string;
    plate: string;
    photoUrl?: string | null;
  };
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

export type CancellationReason =
  | "changed_mind"
  | "driver_too_far"
  | "wrong_pickup"
  | "rider_no_show"
  | "vehicle_issue"
  | "unsafe_pickup"
  | "other"
  /**
   * M11: a searching ride the system cancelled because the whole account
   * was suspended (state `cancelled_by_rider`, no fee).
   */
  | "account_suspended"
  /** M12: a "when full" shared ride left unfilled for 24 h (no fee). */
  | "shared_expired"
  /** M12 (ruling 2026-10-16): the rider was on another live ride when the scheduled one was due. */
  | "rider_busy";

export interface FinalFare {
  distanceMeters: number;
  durationSeconds: number;
  components: FareComponents;
}

/**
 * A cancellation fee carried into this ride (rides-v1 `CarriedDue`, M8):
 * `wallet` = taken from the rider's wallet at completion (always
 * `collected`); `cash` = collected via the driver — `earmarked` while the
 * payment is pending, `collected` after cash-confirm. Always in the ride's
 * currency.
 */
export interface CarriedDue {
  dueId: string;
  /** The cancelled ride the fee came from. */
  sourceRideId: string;
  amount: number;
  currency: string;
  method: PaymentMethod;
  status: "earmarked" | "collected";
}

/** The rider view of a ride (`driver` set from acceptance on). */
export interface Ride {
  id: string;
  state: RideState;
  kind: RideKind;
  regionId: string;
  serviceTypeId: string;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  pickup: Place;
  destination: Place;
  stops: Place[];
  paymentMethod: PaymentMethod;
  pickupDistanceMode?: PickupDistanceMode;
  surgeMultiplier: number;
  surchargePercent: number;
  estimate: Estimate;
  timeline: Timeline;
  cancellationGraceEndsAt?: string | null;
  waitGraceEndsAt?: string | null;
  cancellationReason?: CancellationReason | null;
  cancellationFee?: number | null;
  fare?: FinalFare | null;
  paymentStatus?: PaymentStatus;
  /** M8 (PAY-02): wallet part of the FARE (null on cash-method rides). */
  walletApplied?: number | null;
  /** M8 (PAY-02): cash part of the fare + every CASH carried due. */
  cashDue?: number | null;
  /** M8: itemized carried dues (`[]` when none). */
  carriedDues?: CarriedDue[];
  /** M8 (PAY-04): outside the fare total. */
  tip?: number | null;
  driverStream?: "ok" | "lost" | null;
  driverPosition?: LatLngPoint | null;
  etaSeconds?: number | null;
  retryOfRideId?: string | null;
  redispatchOfRideId?: string | null;
  redispatchedAsRideId?: string | null;
  driver?: DriverSummary | null;
  /** M11 (RATE-01): the rider's OWN rating state for this ride. */
  myRating?: MyRating | null;
  /** M12 — kind `scheduled` only. */
  scheduled?: ScheduledInfo | null;
  /** M12 — kind `shared` only (money fields above are the caller's member values). */
  shared?: SharedInfo | null;
}

/** M12 pre-live states: the ride waits (scheduled) or gathers members (shared). */
export function isPreLiveRide(state: RideState): boolean {
  return state === "scheduled" || state === "gathering";
}

export interface CancellationQuote {
  free: boolean;
  fee?: number | null;
  currency?: string | null;
  graceEndsAt?: string | null;
}

export const RIDER_CANCEL_REASONS = [
  "changed_mind",
  "driver_too_far",
  "wrong_pickup",
  "other",
] as const;
export type RiderCancelReason = (typeof RIDER_CANCEL_REASONS)[number];

export interface RideSummary {
  id: string;
  state: RideState;
  requestedAt: string;
  pickup: Place;
  destination: Place;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  total?: number | null;
  cancellationFee?: number | null;
  currency?: string;
  /** M11 (RATE-01): the rider's OWN rating state for this ride. */
  myRating?: MyRating | null;
  /** M11: the driver's first name (null when no driver was assigned). */
  counterpartFirstName?: string | null;
  /**
   * Why the ride was cancelled (rides-v1, null when not cancelled) — the
   * history reads it for M11's `account_suspended` (rendered instead of
   * "Cancelled by you").
   */
  cancellationReason?: CancellationReason | null;
  /** V1 audit W41: the row's ride kind (labels + the history filter). */
  kind?: RideKind;
  /** W41: the rider's own seats on a shared ride; null otherwise. */
  partySize?: number | null;
}

export type RideKind = "on_demand" | "scheduled" | "shared";

/**
 * `GET /rides` filters (V1 audit W41, UC-R-16), each optional and combined:
 * `state` groups completed / cancelled (cancelled_by_rider, _by_driver,
 * no_driver_found); `from` / `to` are inclusive region-local days
 * (`YYYY-MM-DD`).
 */
export interface RideHistoryFilters {
  state?: "completed" | "cancelled";
  kind?: RideKind;
  from?: string;
  to?: string;
}

export interface RideSummaryPage {
  items: RideSummary[];
  page: number;
  size: number;
  totalItems: number;
}

export interface Receipt {
  rideId: string;
  regionId: string;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  pickup: Place;
  destination: Place;
  stops: Place[];
  timeline: Timeline;
  fare: FinalFare;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /** M8 (PAY-02): wallet part of the FARE (null on cash-method rides). */
  walletApplied?: number | null;
  /** M8 (PAY-02): cash part of the fare + every CASH carried due. */
  cashDue?: number | null;
  /** M8: itemized carried dues (`[]` when none). */
  carriedDues: CarriedDue[];
  /** M8 (PAY-04): its own receipt line, outside the fare total. */
  tip?: number | null;
  driver?: DriverSummary | null;
  /** GeoJSON LineString of the in_ride trace, `[lng, lat]`. */
  route: GeoJsonLineString;
}

// ---------------------------------------------------------------- errors

/** The machine `code` of a ride error, if the backend sent one. */
export function rideErrorCode(error: unknown): string | null {
  return error instanceof ApiError ? (error.body?.code ?? null) : null;
}

/** A `details` entry of a coded ride error, as text. */
export function rideErrorDetail(error: unknown, key: string): string | null {
  if (!(error instanceof ApiError)) return null;
  const value = error.body?.details?.[key];
  return typeof value === "string" ? value : null;
}

/** A numeric `details` entry of a coded ride error (e.g. `surgeMultiplier`). */
export function rideErrorNumber(error: unknown, key: string): number | null {
  if (!(error instanceof ApiError)) return null;
  const value = error.body?.details?.[key];
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

// ------------------------------------------------------------- endpoints

const RIDER = "/api/v1/rider";
const RIDES = "/api/v1/rides";

function rideUrl(rideId: string, suffix = ""): string {
  return `${RIDES}/${encodeURIComponent(rideId)}${suffix}`;
}

function json(body: unknown): string {
  return JSON.stringify(body);
}

/** `GET /rider/preferences` — defaults when never set. */
export function getRiderPreferences(): Promise<RiderPreferences> {
  return apiFetch<RiderPreferences>(`${RIDER}/preferences`, { auth: true });
}

/** `PUT /rider/preferences` — applies to every later booking. */
export function saveRiderPreferences(
  preferences: RiderPreferences,
): Promise<RiderPreferences> {
  return apiFetch<RiderPreferences>(`${RIDER}/preferences`, {
    method: "PUT",
    auth: true,
    body: json(preferences),
  });
}

/** `GET /rider/saved-locations`. */
export function listSavedLocations(): Promise<SavedLocation[]> {
  return apiFetch<SavedLocation[]>(`${RIDER}/saved-locations`, { auth: true });
}

/** `POST /rider/saved-locations` — 409 `duplicate_name` (UC-R-01 E1). */
export function createSavedLocation(
  place: SavedLocationUpsert,
): Promise<SavedLocation> {
  return apiFetch<SavedLocation>(`${RIDER}/saved-locations`, {
    method: "POST",
    auth: true,
    body: json(place),
  });
}

/** `PUT /rider/saved-locations/{id}` — rename / move. */
export function updateSavedLocation(
  id: string,
  place: SavedLocationUpsert,
): Promise<SavedLocation> {
  return apiFetch<SavedLocation>(
    `${RIDER}/saved-locations/${encodeURIComponent(id)}`,
    { method: "PUT", auth: true, body: json(place) },
  );
}

/** `DELETE /rider/saved-locations/{id}`. */
export function deleteSavedLocation(id: string): Promise<void> {
  return apiFetch<void>(`${RIDER}/saved-locations/${encodeURIComponent(id)}`, {
    method: "DELETE",
    auth: true,
  });
}

/**
 * `POST /rides/estimate` — one route, an estimate per service type. With
 * `scheduledAt` (M12) it prices a scheduled ride: the surcharge window of
 * that time and NO surge (`pricedAtRideTime: true`).
 */
export function estimateRide(
  route: RouteInput,
  scheduledAt?: string,
): Promise<EstimateResponse> {
  return apiFetch<EstimateResponse>(`${RIDES}/estimate`, {
    method: "POST",
    auth: true,
    body: json(scheduledAt ? { ...route, scheduledAt } : route),
  });
}

/** The `POST /rides` payload (rides-v1 `BookRideRequest`). */
export type BookRideRequest = RouteInput & {
  serviceTypeId: string;
  paymentMethod: PaymentMethod;
  /**
   * The multiplier the rider was shown (`EstimateResponse.surgeMultiplier`);
   * a mismatch with the current value → 409 `surge_changed` (PRC-02).
   */
  expectedSurgeMultiplier?: number | null;
  /**
   * M13 (growth-v1): a promo to reserve on this ride — re-validated at
   * booking; a refused code fails the booking with the `promo_*` codes.
   */
  promoCode?: string | null;
};

/**
 * `POST /rides` — the ride starts `requested`. 409 `surge_changed` with
 * `details.surgeMultiplier` when the expected multiplier is stale.
 */
export function bookRide(request: BookRideRequest): Promise<Ride> {
  return apiFetch<Ride>(RIDES, {
    method: "POST",
    auth: true,
    body: json(request),
  });
}

/** `GET /rides/active` — the active ride, or null on 204. */
export async function getActiveRide(): Promise<Ride | null> {
  const ride = await apiFetch<Ride | undefined>(`${RIDES}/active`, {
    auth: true,
  });
  return ride ?? null;
}

/** `GET /rides/{id}` — one of the rider's rides. */
export function getRide(rideId: string): Promise<Ride> {
  return apiFetch<Ride>(rideUrl(rideId), { auth: true });
}

/** `GET /rides/{id}/cancellation-quote` — free or the fee, before confirming. */
export function getCancellationQuote(
  rideId: string,
): Promise<CancellationQuote> {
  return apiFetch<CancellationQuote>(rideUrl(rideId, "/cancellation-quote"), {
    auth: true,
  });
}

/** `POST /rides/{id}/cancel` — `other` needs a note. */
export function cancelRide(
  rideId: string,
  reason: RiderCancelReason,
  note?: string,
): Promise<Ride> {
  return apiFetch<Ride>(rideUrl(rideId, "/cancel"), {
    method: "POST",
    auth: true,
    body: json(note ? { reason, note } : { reason }),
  });
}

/** `PUT /rides/{id}/route` — new destination / stops (RIDE-05). */
export function changeRideRoute(
  rideId: string,
  route: { destination: Place; stops: Place[] },
): Promise<Ride> {
  return apiFetch<Ride>(rideUrl(rideId, "/route"), {
    method: "PUT",
    auth: true,
    body: json(route),
  });
}

/**
 * `POST /rides/{id}/retry` — a NEW ride for a `no_driver_found` one, locked
 * at `expectedSurgeMultiplier` (PRC-02). 409 `surge_changed` with
 * `details.surgeMultiplier` when the zone's multiplier moved; nothing is
 * created then.
 */
export function retryRide(
  rideId: string,
  expectedSurgeMultiplier: number,
): Promise<Ride> {
  return apiFetch<Ride>(rideUrl(rideId, "/retry"), {
    method: "POST",
    auth: true,
    body: json({ expectedSurgeMultiplier }),
  });
}

/** `GET /rides/{id}/receipt` — stored components only (PRC-04). */
export function getReceipt(rideId: string): Promise<Receipt> {
  return apiFetch<Receipt>(rideUrl(rideId, "/receipt"), { auth: true });
}

export const RIDE_HISTORY_PAGE_SIZE = 20;

/** `GET /rides` — history, newest first, optionally filtered (W41). */
export function listRides(
  page = 0,
  filters: RideHistoryFilters = {},
): Promise<RideSummaryPage> {
  const params = new URLSearchParams({
    page: String(page),
    size: String(RIDE_HISTORY_PAGE_SIZE),
  });
  for (const key of ["state", "kind", "from", "to"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  return apiFetch<RideSummaryPage>(`${RIDES}?${params.toString()}`, {
    auth: true,
  });
}
