/**
 * The ONE place where API geometry is converted for the map.
 *
 * The backend speaks GeoJSON (`[lng, lat]` order — realtime-v1.yaml `Route.
 * geometry`), the app and Leaflet speak `{lat, lng}` / `[lat, lng]`. Every
 * conversion between the two goes through this module so the axis order can
 * never be flipped by accident somewhere else.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** GeoJSON LineString as returned by `POST /api/v1/routing/route`. */
export interface GeoJsonLineString {
  type: 'LineString';
  /** `[lng, lat]` pairs (GeoJSON order). */
  coordinates: number[][];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True for a point inside the valid WGS84 range. */
export function isValidLatLng(point: LatLng | null | undefined): point is LatLng {
  return (
    !!point &&
    isFiniteNumber(point.lat) &&
    isFiniteNumber(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

/**
 * GeoJSON LineString (`[lng, lat]`) → `{lat, lng}` points. Malformed or
 * out-of-range positions are dropped rather than drawn in the wrong place;
 * a non-LineString yields an empty list.
 */
export function lineStringToLatLngs(geometry: GeoJsonLineString | null | undefined): LatLng[] {
  if (!geometry || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) {
    return [];
  }
  const points: LatLng[] = [];
  for (const position of geometry.coordinates) {
    if (!Array.isArray(position) || position.length < 2) continue;
    const point = { lat: position[1], lng: position[0] };
    if (isValidLatLng(point)) points.push(point);
  }
  return points;
}

/** `{lat, lng}` → Leaflet's `[lat, lng]` tuple. */
export function toLeafletLatLng(point: LatLng): [number, number] {
  return [point.lat, point.lng];
}
