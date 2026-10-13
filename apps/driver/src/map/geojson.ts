/**
 * The ONLY conversion between the contract's GeoJSON and Leaflet's latLng
 * world (mirrors admin's leaflet-geojson.ts). The contract (realtime-v1
 * `Route.geometry`) is a GeoJSON LineString with [lng, lat] pairs; Leaflet
 * wants [lat, lng]. Every map input passes through here exactly once.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** Contract GeoJSON LineString ([lng, lat] order). */
export interface GeoJsonLineString {
  type: "LineString";
  coordinates: [number, number][];
}

/** Leaflet tuple order. */
export type LeafletLatLng = [number, number];

function isFiniteCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Contract LineString -> Leaflet polyline points; invalid pairs are dropped. */
export function lineStringToLatLngs(line: GeoJsonLineString): LeafletLatLng[] {
  if (line.type !== "LineString" || !Array.isArray(line.coordinates)) return [];
  const points: LeafletLatLng[] = [];
  for (const pair of line.coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const [lng, lat] = pair;
    if (isFiniteCoordinate(lat, lng)) points.push([lat, lng]);
  }
  return points;
}

/** App point -> Leaflet tuple. */
export function toLeafletLatLng(point: LatLng): LeafletLatLng {
  return [point.lat, point.lng];
}

/** Leaflet points -> contract LineString (the inverse, for round-trips). */
export function latLngsToLineString(
  points: LeafletLatLng[],
): GeoJsonLineString {
  return {
    type: "LineString",
    coordinates: points.map(([lat, lng]) => [lng, lat]),
  };
}

/** Contract GeoJSON Polygon ([lng, lat], one closed outer ring — surge-v1.yaml). */
export interface GeoJsonPolygon {
  type: "Polygon";
  coordinates: number[][][];
}

/**
 * Contract Polygon -> Leaflet ring (outer ring only, closing point dropped
 * — Leaflet closes polygons itself); invalid pairs are dropped.
 */
export function polygonToLatLngs(polygon: GeoJsonPolygon): LeafletLatLng[] {
  if (polygon?.type !== "Polygon" || !Array.isArray(polygon.coordinates)) {
    return [];
  }
  const ring = polygon.coordinates[0];
  if (!Array.isArray(ring)) return [];
  const points = lineStringToLatLngs({
    type: "LineString",
    coordinates: ring as [number, number][],
  });
  if (points.length > 1) {
    const first = points[0];
    const last = points[points.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) points.pop();
  }
  return points;
}

/**
 * The area centroid of a Leaflet ring (planar — zones are city-sized), or
 * the vertex average when the ring has no area; null for an empty ring.
 * Where a zone's multiplier label sits.
 */
export function ringCentroid(ring: LeafletLatLng[]): LeafletLatLng | null {
  if (ring.length === 0) return null;
  let area = 0;
  let lat = 0;
  let lng = 0;
  for (let i = 0; i < ring.length; i++) {
    const [y0, x0] = ring[i];
    const [y1, x1] = ring[(i + 1) % ring.length];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    lng += (x0 + x1) * cross;
    lat += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-12) {
    const sum = ring.reduce(
      (acc, [y, x]) => [acc[0] + y, acc[1] + x] as LeafletLatLng,
      [0, 0] as LeafletLatLng,
    );
    return [sum[0] / ring.length, sum[1] / ring.length];
  }
  return [lat / (3 * area), lng / (3 * area)];
}
