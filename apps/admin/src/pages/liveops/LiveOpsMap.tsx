import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect, useRef } from 'react';
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet';

import type { AdminSosEvent, LatLng, LiveOpsDriver, LiveOpsRide } from '../../api/comms';
import { useConfig } from '../../config/ConfigContext';
import { DEFAULT_MAP_TILE_URL } from '../../config/runtime-config';
import { polygonToLatLngs } from '../regions/leaflet-geojson';
import { formatMultiplier, type SurgeOverlayZone } from '../surge';

/** Labby purple — the one accent (design canvas 2026-10-07). */
const ACCENT = '#59128A';
/** The approved functional safety red for SOS (owner ruling, M10 canvas). */
export const SOS_RED = '#D92D20';

export interface LiveOpsMapProps {
  /** Accessible name of the map region (also the mock hook in tests). */
  label: string;
  language: string;
  drivers: LiveOpsDriver[];
  rides: LiveOpsRide[];
  /** Open SOS events — the red pins. */
  sosEvents: AdminSosEvent[];
  /** The surge overlay (surge facade shape); null while the toggle is off. */
  surgeZones: SurgeOverlayZone[] | null;
  /** A point to fly to (the banner's "Focus on map"); null = free. */
  focus: LatLng | null;
  onDriverClick: (driverUserId: string) => void;
  onRideClick: (rideId: string) => void;
}

/** The red teardrop SOS pin as a Leaflet divIcon (no image assets). */
function sosIcon(): L.DivIcon {
  return L.divIcon({
    className: 'liveops-sos-pin',
    html:
      `<span class="liveops-sos-pin__drop" style="background:${SOS_RED}">` +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true">' +
      '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"></path></svg></span>',
    iconSize: [34, 34],
    iconAnchor: [17, 34],
  });
}

/**
 * The live operations Leaflet map (ADM-03, UC-A-19): runtime tiles, idle
 * (outline) vs on-ride (filled) driver dots, active-ride route lines
 * (pickup → stops → destination), the surge overlay in the M9 facade's
 * shape, and red SOS pins. Clicks hand ids back to the page — this module
 * is the only one that touches Leaflet here, so tests mock it.
 */
export function LiveOpsMap({
  label,
  language,
  drivers,
  rides,
  sosEvents,
  surgeZones,
  focus,
  onDriverClick,
  onRideClick,
}: LiveOpsMapProps) {
  const { mapTileUrl } = useConfig();
  return (
    <div className="liveops-map" role="region" aria-label={label}>
      <MapContainer center={[0, 0]} zoom={2} className="liveops-map__map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url={mapTileUrl ?? DEFAULT_MAP_TILE_URL}
        />
        {surgeZones?.map((zone) =>
          zone.band === 'none' ? null : (
            <Polygon
              key={zone.id}
              positions={polygonToLatLngs(zone.polygon)}
              pathOptions={{
                color: ACCENT,
                weight: 2,
                opacity: 0.45 + 0.3 * zone.strength,
                fillColor: ACCENT,
                fillOpacity: 0.08 + 0.14 * zone.strength,
                interactive: false,
              }}
            >
              <Tooltip direction="center" permanent className="liveops-map__zone-label">
                <span dir="ltr">{`${zone.name} · ${formatMultiplier(zone.multiplier, language)}`}</span>
              </Tooltip>
            </Polygon>
          ),
        )}
        {rides.map((ride) => (
          <Polyline
            key={ride.rideId}
            positions={[ride.pickup, ...(ride.stops ?? []), ride.destination].map((point) => [
              point.lat,
              point.lng,
            ])}
            pathOptions={{ color: ride.sosOpen ? SOS_RED : ACCENT, weight: 4, opacity: 0.85 }}
            eventHandlers={{ click: () => onRideClick(ride.rideId) }}
          />
        ))}
        {drivers.map((driver) => (
          <CircleMarker
            key={driver.driverUserId}
            center={[driver.lat, driver.lng]}
            radius={8}
            pathOptions={
              driver.status === 'on_ride'
                ? { color: '#FFFFFF', weight: 3, fillColor: ACCENT, fillOpacity: 1 }
                : { color: ACCENT, weight: 3, fillColor: '#FFFFFF', fillOpacity: 1 }
            }
            eventHandlers={{
              click: () =>
                driver.status === 'on_ride' && driver.rideId
                  ? onRideClick(driver.rideId)
                  : onDriverClick(driver.driverUserId),
            }}
          >
            <Tooltip>{driver.name}</Tooltip>
          </CircleMarker>
        ))}
        {sosEvents.map((event) => (
          <Marker
            key={event.sosEventId}
            position={[event.lat, event.lng]}
            icon={sosIcon()}
            eventHandlers={{ click: () => onRideClick(event.rideId) }}
          >
            <Tooltip>{event.triggeredBy.name}</Tooltip>
          </Marker>
        ))}
        <FitAndFocus drivers={drivers} rides={rides} zones={surgeZones} focus={focus} />
      </MapContainer>
    </div>
  );
}

/** Fits the region's content once per mount, then obeys focus requests. */
function FitAndFocus({
  drivers,
  rides,
  zones,
  focus,
}: {
  drivers: LiveOpsDriver[];
  rides: LiveOpsRide[];
  zones: SurgeOverlayZone[] | null;
  focus: LatLng | null;
}) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (fitted.current) {
      return;
    }
    const points: [number, number][] = [
      ...drivers.map((driver): [number, number] => [driver.lat, driver.lng]),
      ...rides.flatMap((ride) =>
        [ride.pickup, ...(ride.stops ?? []), ride.destination].map((point): [number, number] => [
          point.lat,
          point.lng,
        ]),
      ),
      ...(zones ?? []).flatMap((zone) => polygonToLatLngs(zone.polygon)),
    ];
    if (points.length > 0) {
      fitted.current = true;
      map.fitBounds(L.latLngBounds(points), { padding: [32, 32] });
    }
  }, [map, drivers, rides, zones]);

  useEffect(() => {
    if (focus) {
      map.setView([focus.lat, focus.lng], Math.max(map.getZoom(), 15));
    }
  }, [map, focus]);

  return null;
}
