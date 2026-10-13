import { ApiError, authFetch } from "./client";
import type { GeoJsonPolygon } from "../map/geojson";

/**
 * Client slice of surge-v1.yaml for the driver (DRV-09, UC-D-14): the
 * demand heatmap of the operating region — the zone levels pricing uses,
 * refreshed once per surge cycle.
 */

/** One surge zone (contract `HeatmapZone`). */
export interface HeatmapZone {
  id: string;
  name: string;
  /** GeoJSON Polygon, [lng, lat], one closed outer ring. */
  polygon: GeoJsonPolygon;
  /** The current multiplier (exactly what pricing uses). */
  multiplier: number;
  /** 0 = no surge; n = the n-th threshold step reached. */
  level: number;
}

/** Contract `Heatmap`. */
export interface Heatmap {
  regionId: string;
  /** The latest cycle; null before the first. */
  computedAt: string | null;
  /** When to refresh; null when the cycle is disabled. */
  nextCycleAt: string | null;
  zones: HeatmapZone[];
}

/** The 404 `code` when the driver was never located and never rode. */
export const NO_OPERATING_REGION = "no_operating_region";

/** `GET /driver/heatmap` — the operating region's zones with their live levels. */
export function getDriverHeatmap(): Promise<Heatmap> {
  return authFetch<Heatmap>("/api/v1/driver/heatmap");
}

/** True for the contract 404 (no operating region) — the quiet "no layer" case. */
export function isNoOperatingRegion(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 404) return false;
  const code = (error.body as { code?: unknown } | null)?.code;
  // A 404 without a body code means the same here: nothing to draw.
  return code === undefined || code === null || code === NO_OPERATING_REGION;
}
