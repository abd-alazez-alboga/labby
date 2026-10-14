import type { ApiClient } from './client';

/**
 * The M7 admin rides contract (backend/docs/api/rides-v1.yaml, `rides:view`):
 * GET /admin/rides powers the UC-A-18 search page (M10-T4) and the M8 money
 * lookups; GET /admin/rides/{rideId} is the full truth of one ride —
 * timeline, offers trail, trace, fare — behind the ride detail page.
 */

export interface Place {
  lat: number;
  lng: number;
  label?: string | null;
}

export type RideState =
  | 'requested'
  | 'offering'
  | 'accepted'
  | 'driver_arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled_by_rider'
  | 'cancelled_by_driver'
  | 'no_driver_found';

export interface AdminRideSummary {
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
  kind: 'on_demand' | 'scheduled' | 'shared';
  regionId: string;
  regionName: string;
  riderUserId: string;
  riderName: string;
  driverUserId?: string | null;
  driverName?: string | null;
}

export interface AdminRideSummaryPage {
  items: AdminRideSummary[];
  page: number;
  size: number;
  totalItems: number;
}

export interface AdminRideQuery {
  regionId?: string;
  /** ONE state — the contract's filter takes a single value. */
  state?: RideState;
  /** Rider OR driver. */
  userId?: string;
  /** Rider or driver phone — exact, E.164. */
  phone?: string;
  /** requestedAt ≥ (ISO date-time). */
  from?: string;
  /** requestedAt < (ISO date-time). */
  to?: string;
  page?: number;
  size?: number;
}

/** GET /admin/rides — newest first; rides:view. */
export function searchAdminRides(
  client: ApiClient,
  query: AdminRideQuery,
): Promise<AdminRideSummaryPage> {
  const params = new URLSearchParams();
  if (query.regionId) {
    params.set('regionId', query.regionId);
  }
  if (query.state) {
    params.set('state', query.state);
  }
  if (query.userId) {
    params.set('userId', query.userId);
  }
  if (query.phone) {
    params.set('phone', query.phone);
  }
  if (query.from) {
    params.set('from', query.from);
  }
  if (query.to) {
    params.set('to', query.to);
  }
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 50));
  return client.get<AdminRideSummaryPage>(`/api/v1/admin/rides?${params}`);
}

/* ---------- Ride detail (UC-A-18 full truth) ---------- */

/** One timestamp per reached state (RIDE-02). */
export interface RideTimeline {
  requestedAt: string;
  offeringAt?: string | null;
  acceptedAt?: string | null;
  driverArrivedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  noDriverFoundAt?: string | null;
}

/** Money components (region currency, 2 decimals; PRC-01). */
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

export interface RideEstimate {
  distanceMeters: number;
  durationSeconds: number;
  /** Straight-line fallback (NFR-A3). */
  approximate: boolean;
  components: FareComponents;
}

/** The stored fare — never recomputed (PRC-04). */
export interface FinalFare {
  distanceMeters: number;
  durationSeconds: number;
  components: FareComponents;
}

export type PaymentStatus = 'pending' | 'paid_cash' | 'paid_wallet' | 'paid_mixed' | 'unpaid';

/** The slice of the contract's Ride the admin detail page reads. */
export interface AdminRide {
  id: string;
  state: RideState;
  kind: 'on_demand' | 'scheduled' | 'shared';
  regionId: string;
  serviceTypeNameEn: string;
  serviceTypeNameAr: string;
  pickup: Place;
  destination: Place;
  stops?: Place[];
  paymentMethod: 'cash' | 'wallet';
  surgeMultiplier: number;
  surchargePercent: number;
  estimate: RideEstimate;
  timeline: RideTimeline;
  cancellationReason?: string | null;
  cancellationFee?: number | null;
  fare?: FinalFare | null;
  paymentStatus?: PaymentStatus | null;
  tip?: number | null;
}

/** One entry of the dispatch trail, in candidate order (RIDE-03). */
export interface OfferTrailEntry {
  offerId: string;
  sequence: number;
  driverUserId: string;
  driverName: string;
  vehicleId?: string;
  offeredAt: string;
  expiresAt: string;
  response?: 'accepted' | 'declined' | 'timeout' | 'withdrawn' | null;
  respondedAt?: string | null;
  pickupDistanceMeters: number;
  pickupEtaSeconds: number;
}

/** One stored GPS point of the ride's trace (TRK-03). */
export interface TracePoint {
  lat: number;
  lng: number;
  recordedAt: string;
  phase: 'to_pickup' | 'in_ride';
}

export interface AdminRideDetail {
  ride: AdminRide;
  riderUserId: string;
  riderName: string;
  /** Null unless the caller holds support:handle (contact access, UC-A-20). */
  riderPhone: string | null;
  driverUserId?: string | null;
  driverName?: string | null;
  driverPhone?: string | null;
  vehicleId?: string | null;
  cancellationNote?: string | null;
  /** The dispatch trail in candidate order. */
  offers: OfferTrailEntry[];
  /** Every stored GPS point, both phases, in recordedAt order. */
  trace: TracePoint[];
}

/** GET /admin/rides/{rideId} — the full truth of one ride; rides:view. */
export function getAdminRide(client: ApiClient, rideId: string): Promise<AdminRideDetail> {
  return client.get<AdminRideDetail>(`/api/v1/admin/rides/${rideId}`);
}
