import { authFetch } from "./client";

export interface RoutePoint {
  lat: number;
  lng: number;
}

/** GeoJSON LineString, [lng, lat] order. */
export interface RouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

/** realtime-v1.yaml `Route` (approximate = OSRM unavailable, NFR-A3). */
export interface Route {
  distanceMeters: number;
  durationSeconds: number;
  geometry: RouteGeometry;
  approximate: boolean;
}

/** `POST /api/v1/routing/route` — 2..5 points (ES-04). */
export function getRoute(points: RoutePoint[]): Promise<Route> {
  return authFetch<Route>("/api/v1/routing/route", {
    method: "POST",
    body: { points: points.map(({ lat, lng }) => ({ lat, lng })) },
  });
}
