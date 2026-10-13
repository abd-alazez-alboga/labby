import type { ApiClient } from './client';

/**
 * Contract types and calls for the M4 regions & pricing-config endpoints.
 * Source of truth: backend/docs/api/regions-v1.yaml. Polygons travel as
 * GeoJSON (coordinates are [lng, lat], SRID 4326); the region bundle is
 * gated by `regions:*`, the pricing-flavored children (service types,
 * surcharge windows, surge zones) by `pricing:*` — the same codes the UI
 * gates on.
 */

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** One outer ring of [lng, lat] pairs, closed (first point == last point). */
  coordinates: [number, number][][];
}

export interface CommissionTier {
  weeklyTripsAbove: number;
  percent: number;
}

export interface WeeklyTripBonus {
  trips: number;
  amount: number;
}

export interface RatingReward {
  amount: number;
  minAvgRating: number;
  minWeeklyTrips: number;
}

export interface IncentiveValues {
  weeklyTripBonuses: WeeklyTripBonus[];
  peakHourBonusPerTrip: number;
  ratingReward: RatingReward;
}

export interface SuspensionThreshold {
  minAvgRating: number;
  minRatedRides: number;
}

export interface SuspensionThresholds {
  driver: SuspensionThreshold;
  rider: SuspensionThreshold;
}

export type RegionState = 'draft' | 'active';

export interface RegionSummary {
  id: string;
  name: string;
  state: RegionState;
  currency?: string | null;
}

/** The full ADM-01 config bundle; null fields are simply not set yet (draft). */
export interface Region {
  id: string;
  name: string;
  state: RegionState;
  boundary?: GeoJsonPolygon | null;
  currency?: string | null;
  emergencyNumber?: string | null;
  cancellationGraceMin?: number | null;
  cancellationFee?: number | null;
  waitGraceMin?: number | null;
  waitPerMinRate?: number | null;
  pickupFeeThresholdKm?: number | null;
  pickupFeePerKm?: number | null;
  surgeCap?: number | null;
  commissionTiers?: CommissionTier[] | null;
  incentiveValues?: IncentiveValues | null;
  suspensionThresholds?: SuspensionThresholds | null;
  serviceTypeCount: number;
  surgeZoneCount: number;
}

/** Create/replace payload — `name` is the only mandatory field (draft-friendly). */
export interface RegionUpsertRequest {
  name: string;
  boundary?: GeoJsonPolygon | null;
  currency?: string | null;
  emergencyNumber?: string | null;
  cancellationGraceMin?: number | null;
  cancellationFee?: number | null;
  waitGraceMin?: number | null;
  waitPerMinRate?: number | null;
  pickupFeeThresholdKm?: number | null;
  pickupFeePerKm?: number | null;
  surgeCap?: number | null;
  commissionTiers?: CommissionTier[] | null;
  incentiveValues?: IncentiveValues | null;
  suspensionThresholds?: SuspensionThresholds | null;
}

export interface ServiceType {
  id: string;
  regionId: string;
  nameEn: string;
  nameAr: string;
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minimumFare: number;
  enabled: boolean;
}

export interface ServiceTypeUpsertRequest {
  nameEn: string;
  nameAr: string;
  baseFare: number;
  perKmRate: number;
  perMinRate: number;
  minimumFare: number;
  enabled: boolean;
}

export interface SurchargeWindow {
  id: string;
  regionId: string;
  label: string;
  /** Region-local time, e.g. "07:30:00". */
  startsAt: string;
  endsAt: string;
  /** ISO day numbers, 1 = Monday … 7 = Sunday. */
  daysOfWeek: number[];
  percent: number;
}

export interface SurchargeWindowUpsertRequest {
  label: string;
  startsAt: string;
  endsAt: string;
  daysOfWeek: number[];
  percent: number;
}

export interface ThresholdStep {
  ratio: number;
  multiplier: number;
}

export interface SurgeZone {
  id: string;
  regionId: string;
  name: string;
  polygon: GeoJsonPolygon;
  thresholdSteps: ThresholdStep[];
  multiplierCap?: number | null;
  /** Manual override (UC-A-09, set on the live surge page); null = automatic. */
  overrideMultiplier?: number | null;
  overrideSetAt?: string | null;
}

export interface SurgeZoneUpsertRequest {
  name: string;
  polygon: GeoJsonPolygon;
  thresholdSteps: ThresholdStep[];
  multiplierCap?: number | null;
}

/* ---------- Regions ---------- */

/** GET /admin/regions — name-sorted; requires regions:view. */
export function listRegions(client: ApiClient): Promise<RegionSummary[]> {
  return client.get<RegionSummary[]>('/api/v1/admin/regions');
}

/** POST /admin/regions — requires regions:edit; 409 = name already exists (UC-A-05). */
export function createRegion(client: ApiClient, body: RegionUpsertRequest): Promise<Region> {
  return client.post<Region>('/api/v1/admin/regions', body);
}

/** GET /admin/regions/{regionId} — the full bundle; requires regions:view. */
export function getRegion(client: ApiClient, regionId: string): Promise<Region> {
  return client.get<Region>(`/api/v1/admin/regions/${regionId}`);
}

/**
 * PUT /admin/regions/{regionId} — full-bundle replace, new rides only
 * (UC-A-06); requires regions:edit; 409 = duplicate name, boundary overlap,
 * or stripping mandatory config from an active region.
 */
export function updateRegion(
  client: ApiClient,
  regionId: string,
  body: RegionUpsertRequest,
): Promise<Region> {
  return client.put<Region>(`/api/v1/admin/regions/${regionId}`, body);
}

/**
 * POST /admin/regions/{regionId}/activate — requires regions:edit;
 * 409 = mandatory bundle incomplete (UC-A-05 E1).
 */
export function activateRegion(client: ApiClient, regionId: string): Promise<Region> {
  return client.post<Region>(`/api/v1/admin/regions/${regionId}/activate`);
}

/* ---------- Service types ---------- */

/** GET /admin/regions/{regionId}/service-types — incl. disabled; requires pricing:view. */
export function listServiceTypes(client: ApiClient, regionId: string): Promise<ServiceType[]> {
  return client.get<ServiceType[]>(`/api/v1/admin/regions/${regionId}/service-types`);
}

/** POST /admin/regions/{regionId}/service-types — requires pricing:edit; 409 = duplicate English name. */
export function createServiceType(
  client: ApiClient,
  regionId: string,
  body: ServiceTypeUpsertRequest,
): Promise<ServiceType> {
  return client.post<ServiceType>(`/api/v1/admin/regions/${regionId}/service-types`, body);
}

/**
 * PUT /admin/service-types/{serviceTypeId} — edit or disable (UC-A-07; never
 * deleted); requires pricing:edit; 409 = duplicate English name.
 */
export function updateServiceType(
  client: ApiClient,
  serviceTypeId: string,
  body: ServiceTypeUpsertRequest,
): Promise<ServiceType> {
  return client.put<ServiceType>(`/api/v1/admin/service-types/${serviceTypeId}`, body);
}

/* ---------- Surcharge windows ---------- */

/** GET /admin/regions/{regionId}/surcharge-windows — ordered by start; requires pricing:view. */
export function listSurchargeWindows(
  client: ApiClient,
  regionId: string,
): Promise<SurchargeWindow[]> {
  return client.get<SurchargeWindow[]>(`/api/v1/admin/regions/${regionId}/surcharge-windows`);
}

/** POST /admin/regions/{regionId}/surcharge-windows — requires pricing:edit. */
export function createSurchargeWindow(
  client: ApiClient,
  regionId: string,
  body: SurchargeWindowUpsertRequest,
): Promise<SurchargeWindow> {
  return client.post<SurchargeWindow>(`/api/v1/admin/regions/${regionId}/surcharge-windows`, body);
}

/** PUT /admin/surcharge-windows/{surchargeWindowId} — requires pricing:edit. */
export function updateSurchargeWindow(
  client: ApiClient,
  surchargeWindowId: string,
  body: SurchargeWindowUpsertRequest,
): Promise<SurchargeWindow> {
  return client.put<SurchargeWindow>(`/api/v1/admin/surcharge-windows/${surchargeWindowId}`, body);
}

/** DELETE /admin/surcharge-windows/{surchargeWindowId} — requires pricing:edit. */
export function deleteSurchargeWindow(client: ApiClient, surchargeWindowId: string): Promise<void> {
  return client.delete<void>(`/api/v1/admin/surcharge-windows/${surchargeWindowId}`);
}

/* ---------- Surge zones ---------- */

/** GET /admin/regions/{regionId}/surge-zones — requires pricing:view. */
export function listSurgeZones(client: ApiClient, regionId: string): Promise<SurgeZone[]> {
  return client.get<SurgeZone[]>(`/api/v1/admin/regions/${regionId}/surge-zones`);
}

/**
 * POST /admin/regions/{regionId}/surge-zones — requires pricing:edit;
 * 409 = duplicate name in the region or polygon outside it (UC-A-08).
 */
export function createSurgeZone(
  client: ApiClient,
  regionId: string,
  body: SurgeZoneUpsertRequest,
): Promise<SurgeZone> {
  return client.post<SurgeZone>(`/api/v1/admin/regions/${regionId}/surge-zones`, body);
}

/** PUT /admin/surge-zones/{surgeZoneId} — requires pricing:edit; 409 as on create. */
export function updateSurgeZone(
  client: ApiClient,
  surgeZoneId: string,
  body: SurgeZoneUpsertRequest,
): Promise<SurgeZone> {
  return client.put<SurgeZone>(`/api/v1/admin/surge-zones/${surgeZoneId}`, body);
}

/** DELETE /admin/surge-zones/{surgeZoneId} — requires pricing:edit. */
export function deleteSurgeZone(client: ApiClient, surgeZoneId: string): Promise<void> {
  return client.delete<void>(`/api/v1/admin/surge-zones/${surgeZoneId}`);
}

/* ---------- Live surge (M9, UC-A-09) ---------- */

/** One zone's live surge state, as of the last surge cycle (PRC-02). */
export interface SurgeZoneState {
  id: string;
  name: string;
  polygon: GeoJsonPolygon;
  /** What pricing reads now: the override when applied, else the computed step. */
  currentMultiplier: number;
  /** The capped step the last cycle reached. */
  computedMultiplier: number;
  /** Manual override; null = automatic. */
  overrideMultiplier: number | null;
  overrideSetAt: string | null;
  /** The last override change (set or reset) lands at the next cycle. */
  overridePending: boolean;
  /** Open requests in the zone at the last cycle. */
  demandCount: number;
  /** Idle online drivers in the zone at the last cycle. */
  supplyCount: number;
  /** The last cycle; null before the first. */
  computedAt: string | null;
  /**
   * 0 = no surge; n = the n-th threshold step reached — the driver heatmap's
   * scale. Any multiplier above 1.00 is at least 1.
   */
  level: number;
  /** The lower of the zone cap and the region cap; null when neither is set. */
  effectiveCap: number | null;
}

export interface SurgeState {
  regionId: string;
  surgeCap: number | null;
  /** When the next cycle runs; null when the cycle is disabled. */
  nextCycleAt: string | null;
  /** Name-sorted. */
  zones: SurgeZoneState[];
}

/** GET /admin/regions/{regionId}/surge-state — requires pricing:view. */
export function getSurgeState(client: ApiClient, regionId: string): Promise<SurgeState> {
  return client.get<SurgeState>(`/api/v1/admin/regions/${regionId}/surge-state`);
}

/**
 * PUT /admin/surge-zones/{surgeZoneId}/override — requires pricing:edit;
 * 1.00 ≤ multiplier ≤ the zone's effective cap, at most 2 decimals; takes
 * effect at the next cycle. 400 code `override_above_cap` carries `details.cap`.
 */
export function setSurgeOverride(
  client: ApiClient,
  surgeZoneId: string,
  multiplier: number,
): Promise<SurgeZone> {
  return client.put<SurgeZone>(`/api/v1/admin/surge-zones/${surgeZoneId}/override`, {
    multiplier,
  });
}

/** DELETE /admin/surge-zones/{surgeZoneId}/override — requires pricing:edit; next cycle. */
export function resetSurgeOverride(client: ApiClient, surgeZoneId: string): Promise<void> {
  return client.delete<void>(`/api/v1/admin/surge-zones/${surgeZoneId}/override`);
}
