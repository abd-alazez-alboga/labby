import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect, useRef } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';

import type { AdminSosEvent } from '../../api/comms';
import type { Place, TracePoint } from '../../api/rides';
import { useConfig } from '../../config/ConfigContext';
import { DEFAULT_MAP_TILE_URL } from '../../config/runtime-config';
import { MAP_COLORS } from '../../theme/map-colors';

const ACCENT = MAP_COLORS.accent;
const MUTED = MAP_COLORS.muted;
const SOS_RED = MAP_COLORS.sos;
const SURFACE = MAP_COLORS.surface;

export interface RideTraceMapProps {
  /** Accessible name of the map region (also the mock hook in tests). */
  label: string;
  /** The stored GPS trace, both phases, in recordedAt order (TRK-03). */
  trace: TracePoint[];
  pickup: Place;
  destination: Place;
  stops: Place[];
  /** The ride's SOS events — red pins at their recorded spots. */
  sosEvents: AdminSosEvent[];
}

/** The red teardrop SOS pin as a Leaflet divIcon (no image assets). */
function sosIcon(): L.DivIcon {
  return L.divIcon({
    className: 'liveops-sos-pin',
    html:
      `<span class="liveops-sos-pin__drop" style="background:${SOS_RED}">` +
      `<svg width="12" height="12" viewBox="0 0 24 24" fill="${SURFACE}" aria-hidden="true">` +
      '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"></path></svg></span>',
    iconSize: [30, 30],
    iconAnchor: [15, 30],
  });
}

/**
 * The ride detail's GPS trace on runtime tiles (UC-A-18): the to-pickup leg
 * dashed and muted, the in-ride leg in the accent, pickup/stops/destination
 * markers and the ride's SOS moments as red pins. Leaflet-only — tests mock
 * this module.
 */
export function RideTraceMap({
  label,
  trace,
  pickup,
  destination,
  stops,
  sosEvents,
}: RideTraceMapProps) {
  const { mapTileUrl } = useConfig();
  const toPickup = trace.filter((point) => point.phase === 'to_pickup');
  const inRide = trace.filter((point) => point.phase === 'in_ride');

  return (
    <div className="trace-map" role="region" aria-label={label}>
      <MapContainer center={[0, 0]} zoom={2} className="trace-map__map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={mapTileUrl ?? DEFAULT_MAP_TILE_URL}
        />
        {toPickup.length > 1 ? (
          <Polyline
            positions={toPickup.map((point) => [point.lat, point.lng])}
            pathOptions={{ color: MUTED, weight: 3, opacity: 0.7, dashArray: '6 6' }}
          />
        ) : null}
        {inRide.length > 1 ? (
          <Polyline
            positions={inRide.map((point) => [point.lat, point.lng])}
            pathOptions={{ color: ACCENT, weight: 4, opacity: 0.9 }}
          />
        ) : null}
        <CircleMarker
          center={[pickup.lat, pickup.lng]}
          radius={8}
          pathOptions={{ color: MUTED, weight: 3, fillColor: SURFACE, fillOpacity: 1 }}
        >
          {pickup.label ? <Tooltip>{pickup.label}</Tooltip> : null}
        </CircleMarker>
        {stops.map((stop, index) => (
          <CircleMarker
            key={`${stop.lat},${stop.lng},${index}`}
            center={[stop.lat, stop.lng]}
            radius={6}
            pathOptions={{ color: ACCENT, weight: 2, fillColor: SURFACE, fillOpacity: 1 }}
          >
            {stop.label ? <Tooltip>{stop.label}</Tooltip> : null}
          </CircleMarker>
        ))}
        <CircleMarker
          center={[destination.lat, destination.lng]}
          radius={8}
          pathOptions={{ color: SURFACE, weight: 3, fillColor: ACCENT, fillOpacity: 1 }}
        >
          {destination.label ? <Tooltip>{destination.label}</Tooltip> : null}
        </CircleMarker>
        {sosEvents.map((event) => (
          <Marker key={event.sosEventId} position={[event.lat, event.lng]} icon={sosIcon()} />
        ))}
        <FitTrace trace={trace} pickup={pickup} destination={destination} />
      </MapContainer>
    </div>
  );
}

/** Fits the trace (or at least pickup + destination) once. */
function FitTrace({
  trace,
  pickup,
  destination,
}: {
  trace: TracePoint[];
  pickup: Place;
  destination: Place;
}) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) {
      return;
    }
    fitted.current = true;
    const points: [number, number][] = [
      [pickup.lat, pickup.lng],
      [destination.lat, destination.lng],
      ...trace.map((point): [number, number] => [point.lat, point.lng]),
    ];
    map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
  }, [map, trace, pickup, destination]);

  return null;
}
