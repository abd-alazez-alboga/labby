import { useEffect, useState } from "react";

import type { LatLngPoint, Ride } from "../api/rides";
import { getRoute, type Route } from "../api/routing";

/**
 * Re-route the approach once the driver has moved this far from the point
 * the current line starts at — never per GPS sample.
 */
export const APPROACH_REFETCH_METERS = 300;

function metersBetween(a: LatLngPoint, b: LatLngPoint): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/**
 * The route drawn on the rider's tracking map (TRK-02): the driver's
 * position → pickup while `accepted` / `driver_arrived`, then pickup →
 * stops → destination while `in_progress` (realtime-v1 `POST
 * /routing/route`, 2..5 points). The approach line is re-fetched only when
 * the driver has moved {@link APPROACH_REFETCH_METERS} from where it
 * starts; the in-ride line once per route version (a route change
 * refetches). Failures draw no line — the markers still show the way
 * (NFR-A3); `approximate` routes are drawn dashed by the caller.
 */
export function useRideRoute(
  ride: Ride,
  driverPosition: LatLngPoint | null,
): Route | null {
  // The last line fetched, tagged with the ride phase it belongs to.
  const [fetched, setFetched] = useState<{
    phase: string;
    route: Route;
  } | null>(null);
  // Where the approach line starts (the driver, sampled sparsely).
  const [anchor, setAnchor] = useState<{
    rideId: string;
    point: LatLngPoint;
  } | null>(null);
  const approaching =
    ride.state === "accepted" || ride.state === "driver_arrived";

  // Adjusted while rendering (no effect): a new ride, or a driver who has
  // moved far enough, moves the start of the approach line.
  if (
    approaching &&
    driverPosition &&
    (anchor === null ||
      anchor.rideId !== ride.id ||
      metersBetween(anchor.point, driverPosition) >= APPROACH_REFETCH_METERS)
  ) {
    setAnchor({
      rideId: ride.id,
      point: { lat: driverPosition.lat, lng: driverPosition.lng },
    });
  }

  let points: LatLngPoint[] | null = null;
  if (approaching && anchor && anchor.rideId === ride.id) {
    points = [anchor.point, ride.pickup];
  } else if (ride.state === "in_progress") {
    points = [ride.pickup, ...ride.stops.slice(0, 3), ride.destination];
  }
  const pointsKey = points
    ? JSON.stringify(points.map(({ lat, lng }) => [lat, lng]))
    : null;
  // A new ride or phase never shows the previous phase's line.
  const phase = `${ride.id}:${approaching ? "approach" : ride.state}`;

  useEffect(() => {
    if (!pointsKey) return undefined;
    const coordinates = JSON.parse(pointsKey) as [number, number][];
    let cancelled = false;
    getRoute(coordinates.map(([lat, lng]) => ({ lat, lng })))
      .then((route) => {
        if (!cancelled) setFetched({ phase, route });
      })
      .catch(() => {
        // No line; the markers still show the way.
      });
    return () => {
      cancelled = true;
    };
  }, [pointsKey, phase]);

  return points && fetched?.phase === phase ? fetched.route : null;
}
