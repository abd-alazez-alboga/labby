import 'leaflet/dist/leaflet.css';
import 'leaflet-draw/dist/leaflet.draw.css';

import L from 'leaflet';
import 'leaflet-draw';
import { useEffect, useRef } from 'react';
import { MapContainer, Polygon, TileLayer, useMap } from 'react-leaflet';

import type { GeoJsonPolygon } from '../../api/regions';
import { useConfig } from '../../config/ConfigContext';
import { DEFAULT_MAP_TILE_URL } from '../../config/runtime-config';
import { latLngsToPolygon, polygonToLatLngs } from './leaflet-geojson';

/** A read-only context polygon (e.g. the region boundary behind a zone). */
export interface MapOverlay {
  id: string;
  polygon: GeoJsonPolygon;
}

export interface PolygonMapEditorProps {
  /** Accessible name of the map region (also the mock hook in tests). */
  label: string;
  /** The ONE editable polygon, as contract GeoJSON ([lng, lat]); null = none drawn yet. */
  polygon: GeoJsonPolygon | null;
  /** Dashed, non-editable context polygons. */
  overlays?: MapOverlay[];
  /** Whether drawing/editing tools are offered (permission-gated by the caller). */
  editable: boolean;
  /** Fired with the drawn/edited polygon (closed [lng, lat] ring) or null on delete. */
  onPolygonChange: (polygon: GeoJsonPolygon | null) => void;
}

/**
 * The ONLY component that touches Leaflet: OSM-style tiles (URL template
 * from runtime config) + leaflet-draw for the one-polygon
 * draw/edit/delete cycle (UC-A-05/08). It speaks contract
 * GeoJSON at its boundary — [lng, lat], closed ring — so pages and tests
 * never deal in Leaflet shapes, and component tests mock this module.
 */
export function PolygonMapEditor({
  label,
  polygon,
  overlays = [],
  editable,
  onPolygonChange,
}: PolygonMapEditorProps) {
  // Tile source comes from runtime config (realtime-v1.yaml), never hard-coded.
  const { mapTileUrl } = useConfig();
  return (
    <div className="map-editor" role="region" aria-label={label}>
      <MapContainer center={[0, 0]} zoom={2} className="map-editor__map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={mapTileUrl ?? DEFAULT_MAP_TILE_URL}
        />
        {overlays.map((overlay) => (
          <Polygon
            key={overlay.id}
            positions={polygonToLatLngs(overlay.polygon)}
            pathOptions={{ color: '#6b7280', dashArray: '6 6', fill: false, interactive: false }}
          />
        ))}
        <DrawLayer polygon={polygon} editable={editable} onPolygonChange={onPolygonChange} />
        <FitToContent polygon={polygon} overlays={overlays} />
      </MapContainer>
    </div>
  );
}

/** Zooms to the editable polygon (or the overlays) once content exists. */
function FitToContent({
  polygon,
  overlays,
}: {
  polygon: GeoJsonPolygon | null;
  overlays: MapOverlay[];
}) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) {
      return;
    }
    const points = [polygon, ...overlays.map((o) => o.polygon)]
      .filter((p): p is GeoJsonPolygon => p !== null)
      .flatMap((p) => polygonToLatLngs(p));
    if (points.length > 0) {
      fitted.current = true;
      map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
    }
  }, [map, polygon, overlays]);

  return null;
}

/** Owns the feature group + draw control; translates events to GeoJSON. */
function DrawLayer({
  polygon,
  editable,
  onPolygonChange,
}: {
  polygon: GeoJsonPolygon | null;
  editable: boolean;
  onPolygonChange: (polygon: GeoJsonPolygon | null) => void;
}) {
  const map = useMap();
  const groupRef = useRef<L.FeatureGroup | null>(null);
  const changeRef = useRef(onPolygonChange);
  changeRef.current = onPolygonChange;

  // One feature group for the lifetime of the map.
  if (groupRef.current === null) {
    groupRef.current = new L.FeatureGroup();
  }

  useEffect(() => {
    const group = groupRef.current!;
    map.addLayer(group);
    return () => {
      map.removeLayer(group);
    };
  }, [map]);

  // Mirror the prop into the layer (initial load and saves both pass here).
  useEffect(() => {
    const group = groupRef.current!;
    group.clearLayers();
    if (polygon) {
      group.addLayer(L.polygon(polygonToLatLngs(polygon)));
    }
  }, [polygon]);

  useEffect(() => {
    if (!editable) {
      return;
    }
    const group = groupRef.current!;

    const emitFromGroup = () => {
      const layers = group.getLayers();
      if (layers.length === 0) {
        changeRef.current(null);
        return;
      }
      const ring = (layers[layers.length - 1] as L.Polygon).getLatLngs()[0] as L.LatLng[];
      changeRef.current(latLngsToPolygon(ring));
    };

    const onCreated = (event: L.LeafletEvent) => {
      // One polygon only: a new drawing replaces the previous one.
      group.clearLayers();
      group.addLayer((event as L.DrawEvents.Created).layer);
      emitFromGroup();
    };

    const control = new L.Control.Draw({
      draw: {
        polygon: { allowIntersection: false },
        polyline: false,
        rectangle: false,
        circle: false,
        circlemarker: false,
        marker: false,
      },
      edit: { featureGroup: group },
    });
    map.addControl(control);
    map.on(L.Draw.Event.CREATED, onCreated);
    map.on(L.Draw.Event.EDITED, emitFromGroup);
    map.on(L.Draw.Event.DELETED, emitFromGroup);

    return () => {
      map.off(L.Draw.Event.CREATED, onCreated);
      map.off(L.Draw.Event.EDITED, emitFromGroup);
      map.off(L.Draw.Event.DELETED, emitFromGroup);
      map.removeControl(control);
    };
  }, [map, editable]);

  return null;
}
