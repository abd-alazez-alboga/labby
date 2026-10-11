import { useEffect, useRef, useState } from "react";

import type { Ride } from "../api/ride-types";
import { getRoute } from "../api/routing";
import type { Route } from "../api/routing";

/**
 * The OSRM route drawn on the ride map (UC-D-07 step 1, UC-D-08 step 2):
 * own position → pickup while `accepted`; own position → stops →
 * destination while `in_progress`. Fetched ONCE per ride phase and route
 * version (a rider route change refetches) from the position at that
 * moment — never per GPS sample. Failures simply draw no line (NFR-A3).
 */
export function useRideRoute(
  ride: Ride | null,
  position: { lat: number; lng: number } | null,
): Route | null {
  const [route, setRoute] = useState<Route | null>(null);
  const positionRef = useRef(position);
  positionRef.current = position;
  const hasPosition = position !== null;

  let key: string | null = null;
  let targets: { lat: number; lng: number }[] = [];
  if (ride?.state === "accepted") {
    targets = [ride.pickup];
  } else if (ride?.state === "in_progress") {
    targets = [...ride.stops.slice(0, 3), ride.destination];
  }
  if (ride && targets.length > 0) {
    key = `${ride.id}:${ride.state}:${targets
      .map((point) => `${point.lat},${point.lng}`)
      .join(";")}`;
  }
  const targetsRef = useRef(targets);
  targetsRef.current = targets;

  useEffect(() => {
    setRoute(null);
    if (!key || !hasPosition) return undefined;
    const origin = positionRef.current;
    if (!origin) return undefined;
    let cancelled = false;
    getRoute([origin, ...targetsRef.current])
      .then((next) => {
        if (!cancelled) setRoute(next);
      })
      .catch(() => {
        // No line; the markers still show the way.
      });
    return () => {
      cancelled = true;
    };
  }, [key, hasPosition]);

  return route;
}
