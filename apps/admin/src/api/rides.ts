import type { ApiClient } from './client';

/**
 * The slice of the M7 admin ride-search contract the money screens need
 * (backend/docs/api/rides-v1.yaml, GET /admin/rides; `rides:view`): the M8
 * lookup pages resolve a phone to its users through their ride history, and
 * the grant/refund panel lists a user's rides for the mandatory refund link
 * (PAY-03). The full UC-A-18 rides screen arrives with M10-T4.
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
  /** Rider OR driver. */
  userId?: string;
  /** Rider or driver phone — exact, E.164. */
  phone?: string;
  page?: number;
  size?: number;
}

/** GET /admin/rides — newest first; rides:view. */
export function searchAdminRides(
  client: ApiClient,
  query: AdminRideQuery,
): Promise<AdminRideSummaryPage> {
  const params = new URLSearchParams();
  if (query.userId) {
    params.set('userId', query.userId);
  }
  if (query.phone) {
    params.set('phone', query.phone);
  }
  params.set('page', String(query.page ?? 0));
  params.set('size', String(query.size ?? 50));
  return client.get<AdminRideSummaryPage>(`/api/v1/admin/rides?${params}`);
}
