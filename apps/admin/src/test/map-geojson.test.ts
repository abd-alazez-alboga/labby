import { describe, expect, it } from 'vitest';

import type { GeoJsonPolygon } from '../api/regions';
import { latLngsToPolygon, polygonToLatLngs } from '../pages/regions/leaflet-geojson';

const POLYGON: GeoJsonPolygon = {
  type: 'Polygon',
  coordinates: [
    [
      [36.2, 33.4],
      [36.4, 33.4],
      [36.4, 33.6],
      [36.2, 33.4],
    ],
  ],
};

/**
 * The contract (regions-v1.yaml) mandates [lng, lat] order and a closed
 * outer ring; Leaflet uses open [lat, lng] rings. These conversions are
 * where a silent lat/lng swap would corrupt every saved polygon, so the
 * round-trip must be exact.
 */
describe('leaflet-geojson conversions', () => {
  it('converts the closed [lng, lat] ring to open [lat, lng] pairs', () => {
    expect(polygonToLatLngs(POLYGON)).toEqual([
      [33.4, 36.2],
      [33.4, 36.4],
      [33.6, 36.4],
    ]);
  });

  it('closes the ring (first point == last point) when building GeoJSON from drawn points', () => {
    const polygon = latLngsToPolygon([
      { lat: 33.4, lng: 36.2 },
      { lat: 33.4, lng: 36.4 },
      { lat: 33.6, lng: 36.4 },
    ]);
    expect(polygon).toEqual(POLYGON);
  });

  it('round-trips a polygon unchanged through Leaflet shapes', () => {
    const latLngs = polygonToLatLngs(POLYGON).map(([lat, lng]) => ({ lat, lng }));
    expect(latLngsToPolygon(latLngs)).toEqual(POLYGON);
  });
});
