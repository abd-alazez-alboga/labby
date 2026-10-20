import { authFetch } from "./client";

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

/** The client-facing config of an ACTIVE region (contract `RegionConfig`). */
export interface RegionConfig {
  id: string;
  name: string;
  /** ISO 4217. */
  currency: string;
  emergencyNumber: string;
  /** PRC-03: the free wait at pickup in minutes; null = the SRS default 5. */
  waitGraceMin?: number | null;
  serviceTypes: RegionServiceType[];
}

/** `GET /api/v1/regions/resolve` — 200 config, 404 outside operating area. */
export function resolveRegion(lat: number, lng: number): Promise<RegionConfig> {
  return authFetch<RegionConfig>(
    `/api/v1/regions/resolve?lat=${lat}&lng=${lng}`,
  );
}
