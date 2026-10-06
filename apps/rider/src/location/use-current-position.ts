/**
 * The rider's own live position for the home map (M6-T4).
 *
 * Foreground only (the rider app never tracks in the background): asks for
 * the permission through the shared single-flight request, reads a first fix
 * and then watches with a modest granularity while the consumer is mounted.
 *
 * States
 * - `locating`          permission or first fix pending
 * - `ready`             `position` is set
 * - `permissionDenied`  the user refused location access (retry / settings)
 * - `unavailable`       permission granted but no fix (GPS off, timeout…)
 *
 * Coming back to the foreground re-runs the cycle from a failed state, so a
 * user who granted the permission in the system settings sees the map
 * without pressing anything.
 */
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';

import type { LatLng } from '../map/geo';
import { readLocationPermission, requestLocationPermission } from './location-permission';

export type PositionStatus = 'locating' | 'ready' | 'permissionDenied' | 'unavailable';

/** Watch granularity: enough to keep the "you are here" dot honest. */
const WATCH_DISTANCE_INTERVAL_M = 10;
const WATCH_TIME_INTERVAL_MS = 5000;

export interface CurrentPosition {
  status: PositionStatus;
  position: LatLng | null;
  retry: () => void;
  openLocationSettings: () => void;
}

function toLatLng(location: Location.LocationObject): LatLng {
  return { lat: location.coords.latitude, lng: location.coords.longitude };
}

export function useCurrentPosition(): CurrentPosition {
  const [status, setStatus] = useState<PositionStatus>('locating');
  const [position, setPosition] = useState<LatLng | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const statusRef = useRef<PositionStatus>('locating');
  const mounted = useRef(true);

  const update = useCallback((next: PositionStatus, point?: LatLng) => {
    if (!mounted.current) return;
    statusRef.current = next;
    setStatus(next);
    if (point) setPosition(point);
  }, []);

  const startWatch = useCallback(async () => {
    if (watch.current) return;
    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: WATCH_DISTANCE_INTERVAL_M,
          timeInterval: WATCH_TIME_INTERVAL_MS,
        },
        (location) => update('ready', toLatLng(location)),
      );
      if (!mounted.current) {
        subscription.remove();
        return;
      }
      watch.current = subscription;
    } catch {
      // Watching unavailable — the first fix (if any) stays on the map.
    }
  }, [update]);

  const locate = useCallback(async (prompt = true) => {
    let permission: Location.LocationPermissionResponse;
    try {
      permission = prompt ? await requestLocationPermission() : await readLocationPermission();
    } catch {
      update('unavailable');
      return;
    }
    if (!permission.granted) {
      update('permissionDenied');
      return;
    }
    void startWatch();
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      update('ready', toLatLng(fix));
    } catch {
      // A watch update may still arrive; until then say so honestly.
      if (statusRef.current !== 'ready') update('unavailable');
    }
  }, [startWatch, update]);

  useEffect(() => {
    mounted.current = true;
    (async () => {
      await locate();
    })();
    return () => {
      mounted.current = false;
      watch.current?.remove();
      watch.current = null;
    };
  }, [locate]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      const cameBack = next === 'active' && previous !== 'active';
      previous = next;
      if (cameBack && (statusRef.current === 'permissionDenied' || statusRef.current === 'unavailable')) {
        void locate(false);
      }
    });
    return () => subscription.remove();
  }, [locate]);

  const retry = useCallback(() => {
    update('locating');
    void locate();
  }, [locate, update]);

  const openLocationSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  return { status, position, retry, openLocationSettings };
}
