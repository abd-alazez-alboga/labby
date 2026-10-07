import type { GeoJsonLineString, LatLng } from "../map/geo";
import { apiFetch } from "./http-client";

/**
 * Client slice of the routing contract (realtime-v1.yaml `Routing`, ES-04,
 * NFR-A3). Never a hard failure server-side: when OSRM is unreachable the
 * backend answers a straight-line estimate flagged `approximate: true`.
 */
export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  /** GeoJSON `[lng, lat]` — convert with map/geo.ts only. */
  geometry: GeoJsonLineString;
  approximate: boolean;
}

/** `POST /api/v1/routing/route` through 2..5 points. */
export function getRoute(points: LatLng[]): Promise<Route> {
  return apiFetch<Route>("/api/v1/routing/route", {
    method: "POST",
    auth: true,
    body: JSON.stringify({
      points: points.map(({ lat, lng }) => ({ lat, lng })),
    }),
  });
}
