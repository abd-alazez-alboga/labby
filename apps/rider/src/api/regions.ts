import { apiFetch } from "./http-client";

/**
 * Client slice of the regions contract (backend/docs/api/regions-v1.yaml,
 * SD-01): resolve the ACTIVE region covering a GPS point. Any authenticated
 * account may call it; 404 means "outside every operating area".
 */

/** One ENABLED service type of a region (contract `ServiceType`). */
export interface RegionServiceType {
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

/**
 * The client-facing config of an ACTIVE region (contract `RegionConfig`).
 *
 * The M8 pricing fields below are OPTIONAL: the rider UI only needs them for
 * pre-charge disclosure (the wait-charge accrual notice, UC-R-05/PRC-03) and
 * tolerates their absence — the authoritative amounts always come from the
 * stored fare. `RegionConfig` in regions-v1.yaml does not list them yet
 * (flagged to the backend as an M8 contract gap); until it serves them the
 * notice falls back to rate-less copy.
 */
export interface RegionConfig {
  id: string;
  name: string;
  /** ISO 4217. */
  currency: string;
  emergencyNumber: string;
  serviceTypes: RegionServiceType[];
  /** PRC-03 free waiting minutes after Arrived (region default: 5). */
  waitGraceMin?: number | null;
  /** PRC-03 per-minute wait charge once the grace ends. */
  waitPerMinRate?: number | null;
}

/** `GET /api/v1/regions/resolve` — 200 config, 404 outside operating area. */
export function resolveRegion(lat: number, lng: number): Promise<RegionConfig> {
  return apiFetch<RegionConfig>(
    `/api/v1/regions/resolve?lat=${lat}&lng=${lng}`,
    {
      auth: true,
    },
  );
}
