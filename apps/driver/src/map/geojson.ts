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
  type: 'LineString';
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
  if (line.type !== 'LineString' || !Array.isArray(line.coordinates)) return [];
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
export function latLngsToLineString(points: LeafletLatLng[]): GeoJsonLineString {
  return {
    type: 'LineString',
    coordinates: points.map(([lat, lng]) => [lng, lat]),
  };
}
