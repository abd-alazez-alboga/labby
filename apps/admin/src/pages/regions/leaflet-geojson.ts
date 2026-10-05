import type { GeoJsonPolygon } from '../../api/regions';

/**
 * Pure conversion between the contract's GeoJSON polygons and Leaflet's
 * latLng world. The contract (regions-v1.yaml) is strict: coordinates are
 * [lng, lat] (SRID 4326) and the single outer ring is CLOSED (first point
 * == last point). Leaflet works with open [lat, lng] rings, so each
 * direction flips the pair order and adds/removes the closing point —
 * round-tripping a polygon through both must reproduce it exactly.
 */

export interface LatLngPoint {
  lat: number;
  lng: number;
}

/** Contract polygon -> open Leaflet ring ([lat, lng] tuples, no closing point). */
export function polygonToLatLngs(polygon: GeoJsonPolygon): [number, number][] {
  const ring = polygon.coordinates[0] ?? [];
  const open = ring.length > 1 ? ring.slice(0, -1) : ring;
  return open.map(([lng, lat]) => [lat, lng]);
}

/** Open Leaflet ring -> contract polygon (closed [lng, lat] ring). */
export function latLngsToPolygon(latLngs: LatLngPoint[]): GeoJsonPolygon {
  const ring: [number, number][] = latLngs.map(({ lat, lng }) => [lng, lat]);
  if (ring.length > 0) {
    const [firstLng, firstLat] = ring[0];
    ring.push([firstLng, firstLat]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}
