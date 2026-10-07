/**
 * Region resolution state for the driver app (M4-T4, SD-01).
 *
 * Mounted around the app stack; it only works while an ACTIVE driver is
 * signed in (the apply-to-drive gate needs no region). On activation, on
 * significant movement (>= 1.5 km from the last resolved point) and on
 * foreground re-entry it reads the GPS position (expo-location) and calls
 * `GET /api/v1/regions/resolve`:
 *
 * - 200 → the RegionConfig is stored in state AND cached in AsyncStorage,
 *   so later milestones read currency/service types without re-fetching.
 * - 404 → authoritative "outside every operating area": the cache is
 *   dropped and the home screen shows the outside state.
 * - network/server trouble → the last cached config keeps the app usable;
 *   with no cache an explicit error/retry state is shown — deliberately
 *   distinct from being outside the service area.
 * - location permission denied → an explanatory state with a retry and an
 *   open-system-settings action.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Linking } from 'react-native';

import { ApiError } from '../api/client';
import { resolveRegion } from '../api/regions';
import type { RegionConfig } from '../api/regions';
import { useAuth } from '../auth/AuthProvider';
import { runExclusive } from '../permissions/permission-queue';

export const REGION_CACHE_KEY = 'labby-driver.region';

/** Re-resolve once the device moved this far from the last resolved point. */
export const SIGNIFICANT_MOVE_KM = 1.5;
/** Watch granularity: position updates at most every 500 m of movement. */
const WATCH_DISTANCE_INTERVAL_M = 500;

export type RegionStatus =
  | 'loading'
  | 'resolved'
  | 'outside'
  | 'permissionDenied'
  | 'error';

interface GeoPoint {
  lat: number;
  lng: number;
}

/** AsyncStorage cache entry: the config plus the point it was resolved at. */
interface CachedRegion extends GeoPoint {
  config: RegionConfig;
}

export interface RegionContextValue {
  status: RegionStatus;
  /** The active region's client config; set only while status is 'resolved'. */
  config: RegionConfig | null;
  /** Re-runs permission + GPS + resolve (the retry action of every state). */
  retry: () => void;
  /** Opens the system settings so the user can grant location access. */
  openLocationSettings: () => void;
}

const RegionContext = createContext<RegionContextValue | null>(null);

async function readCachedRegion(): Promise<CachedRegion | null> {
  try {
    const raw = await AsyncStorage.getItem(REGION_CACHE_KEY);
    return raw ? (JSON.parse(raw) as CachedRegion) : null;
  } catch {
    return null;
  }
}

async function writeCachedRegion(entry: CachedRegion | null): Promise<void> {
  try {
    if (entry) {
      await AsyncStorage.setItem(REGION_CACHE_KEY, JSON.stringify(entry));
    } else {
      await AsyncStorage.removeItem(REGION_CACHE_KEY);
    }
  } catch {
    // cache is best-effort
  }
}

/** Great-circle (haversine) distance in km. */
function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h));
}

export function RegionProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, isDriver } = useAuth();
  const active = authStatus === 'signedIn' && isDriver;

  const [status, setStatus] = useState<RegionStatus>('loading');
  const [config, setConfig] = useState<RegionConfig | null>(null);
  /** Point of the last answer from the server (200 or 404). */
  const lastResolved = useRef<GeoPoint | null>(null);
  /** Last known-good config (in-memory mirror of the AsyncStorage cache). */
  const fallback = useRef<CachedRegion | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const appState = useRef(AppState.currentState);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      watch.current?.remove();
      watch.current = null;
    };
  }, []);

  /** Server/network/GPS trouble: keep the last known config if any. */
  const degradeToFallback = useCallback(() => {
    if (!mounted.current) return;
    if (fallback.current) {
      setConfig(fallback.current.config);
      setStatus('resolved');
    } else {
      setConfig(null);
      setStatus('error');
    }
  }, []);

  const applyResolve = useCallback(
    async (point: GeoPoint) => {
      try {
        const fresh = await resolveRegion(point.lat, point.lng);
        lastResolved.current = point;
        fallback.current = { config: fresh, lat: point.lat, lng: point.lng };
        await writeCachedRegion(fallback.current);
        if (mounted.current) {
          setConfig(fresh);
          setStatus('resolved');
        }
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          // Authoritative: no active region covers this point (SD-01).
          lastResolved.current = point;
          fallback.current = null;
          await writeCachedRegion(null);
          if (mounted.current) {
            setConfig(null);
            setStatus('outside');
          }
          return;
        }
        degradeToFallback();
      }
    },
    [degradeToFallback],
  );

  /** Starts the significant-movement watch once (after permission). */
  const startWatch = useCallback(async () => {
    if (watch.current) return;
    try {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: WATCH_DISTANCE_INTERVAL_M,
        },
        (position) => {
          const point = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          const moved = lastResolved.current
            ? distanceKm(lastResolved.current, point)
            : Number.POSITIVE_INFINITY;
          if (moved >= SIGNIFICANT_MOVE_KM) {
            void applyResolve(point);
          }
        },
      );
      if (!mounted.current) {
        subscription.remove();
        return;
      }
      watch.current = subscription;
    } catch {
      // Watching unavailable — boot and foreground re-entry still resolve.
    }
  }, [applyResolve]);

  /**
   * The full cycle: cache → permission → GPS → resolve. `prompt: false` (foreground
   * re-entry) only reads the permission — prompting there loops the OS dialog, which
   * itself backgrounds the app.
   */
  const locateAndResolve = useCallback(async (prompt = true) => {
    if (!fallback.current) {
      fallback.current = await readCachedRegion();
    }
    let permission: Location.LocationPermissionResponse;
    try {
      permission = prompt
        ? await runExclusive(() => Location.requestForegroundPermissionsAsync())
        : await Location.getForegroundPermissionsAsync();
    } catch {
      degradeToFallback();
      return;
    }
    if (!permission.granted) {
      if (mounted.current) {
        setConfig(null);
        setStatus('permissionDenied');
      }
      return;
    }
    void startWatch();
    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      await applyResolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      });
    } catch {
      // GPS read failed: degrade exactly like a network failure.
      degradeToFallback();
    }
  }, [applyResolve, degradeToFallback, startWatch]);

  // Resolve when an active driver session appears; reset when it goes.
  useEffect(() => {
    if (!active) {
      watch.current?.remove();
      watch.current = null;
      lastResolved.current = null;
      if (mounted.current) {
        setConfig(null);
        setStatus('loading');
      }
      return;
    }
    void locateAndResolve();
  }, [active, locateAndResolve]);

  // Re-resolve when the app returns to the foreground.
  useEffect(() => {
    if (!active) return undefined;
    const subscription = AppState.addEventListener('change', (next) => {
      const previous = appState.current;
      appState.current = next;
      if (next === 'active' && previous !== 'active') {
        void locateAndResolve(false);
      }
    });
    return () => subscription.remove();
  }, [active, locateAndResolve]);

  const retry = useCallback(() => {
    if (mounted.current) {
      setConfig(null);
      setStatus('loading');
    }
    void locateAndResolve();
  }, [locateAndResolve]);

  const openLocationSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  const value = useMemo<RegionContextValue>(
    () => ({ status, config, retry, openLocationSettings }),
    [status, config, retry, openLocationSettings],
  );

  return (
    <RegionContext.Provider value={value}>{children}</RegionContext.Provider>
  );
}

/**
 * Region state, or null when rendered without the provider (e.g.
 * provider-less unit tests of screens — same pattern as useOptionalAuth).
 */
export function useOptionalRegion(): RegionContextValue | null {
  return useContext(RegionContext);
}
