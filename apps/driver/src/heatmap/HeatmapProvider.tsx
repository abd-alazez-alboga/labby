/**
 * Driver demand heatmap facade (DRV-09, UC-D-14, M9-T2) — the single source
 * of `GET /driver/heatmap` for the home map layer and the "Demand near you"
 * sheet section.
 *
 * Refresh: the server recomputes the zone levels once per surge cycle and
 * says when the next cycle runs (`nextCycleAt`). The facade reads the
 * heatmap when it becomes visible and then exactly once per cycle — the
 * next read is scheduled a few seconds after `nextCycleAt` (a fixed
 * fallback when the cycle time is missing or already past), so a level
 * change reaches the map within one cycle (M9 AC).
 *
 * It reads ONLY while: an approved driver is signed in, online, the
 * heatmap toggle is on, no offer/ride owns the home screen, and the app is
 * not in the background. Anything else stops the schedule. The toggle is
 * the driver's choice for the session (in memory), on by default.
 *
 * Failures are quiet: a 404 `no_operating_region` means "no layer" (no
 * error UI), any other failure keeps the last view and retries on the
 * fallback interval.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { AppState } from "react-native";

import { getDriverHeatmap, isNoOperatingRegion } from "../api/heatmap";
import type { Heatmap } from "../api/heatmap";
import { useAuth } from "../auth/AuthProvider";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";

/** Refresh when the cycle time is unknown (null) or already past. */
export const HEATMAP_FALLBACK_MS = 120_000;
/** Read this long after `nextCycleAt`, so the new cycle has been written. */
export const HEATMAP_CYCLE_GRACE_MS = 5_000;
/** Never wait longer than this (guards a device clock far behind the server). */
export const HEATMAP_MAX_DELAY_MS = 10 * 60_000;

/** Milliseconds until the next read for a heatmap's `nextCycleAt`. */
export function nextRefreshDelay(
  nextCycleAt: string | null,
  now: number,
): number {
  if (!nextCycleAt) return HEATMAP_FALLBACK_MS;
  const at = Date.parse(nextCycleAt);
  if (Number.isNaN(at) || at <= now) return HEATMAP_FALLBACK_MS;
  return Math.min(at - now + HEATMAP_CYCLE_GRACE_MS, HEATMAP_MAX_DELAY_MS);
}

export interface HeatmapContextValue {
  /** The driver's toggle (session, in memory) — on by default. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
  /** The driver is online — the toggle and the layer exist only then. */
  online: boolean;
  /**
   * The heatmap to draw: set only while online with the toggle on and the
   * operating region known. Null = no layer, no sheet section.
   */
  heatmap: Heatmap | null;
}

const HeatmapContext = createContext<HeatmapContextValue | null>(null);

export function HeatmapProvider({ children }: { children: React.ReactNode }) {
  const { status: authStatus, isDriver } = useAuth();
  const active = authStatus === "signedIn" && isDriver;
  const availability = useOptionalAvailability();
  const online =
    active &&
    availability?.load.status === "loaded" &&
    availability.load.data.online;
  const rides = useOptionalDriverRide();
  const rideOnScreen = !!(rides?.offer || rides?.ride);

  const [enabled, setEnabled] = useState(true);
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [foreground, setForeground] = useState(
    AppState.currentState !== "background",
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      setForeground(next !== "background");
    });
    return () => subscription.remove();
  }, []);

  // Signing out resets the session's toggle.
  useEffect(() => {
    if (!active) setEnabled(true);
  }, [active]);

  // Signed out / offline / toggled off: the layer is gone.
  useEffect(() => {
    if (!active || !online || !enabled) setHeatmap(null);
  }, [active, online, enabled]);

  const polling = online && enabled && !rideOnScreen && foreground;

  useEffect(() => {
    if (!polling) return undefined;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const read = async () => {
      let delay = HEATMAP_FALLBACK_MS;
      try {
        const next = await getDriverHeatmap();
        if (cancelled) return;
        setHeatmap(next);
        delay = nextRefreshDelay(next.nextCycleAt, Date.now());
      } catch (caught) {
        if (cancelled) return;
        // Quiet: no operating region → no layer; anything else keeps the
        // last view until the next attempt.
        if (isNoOperatingRegion(caught)) setHeatmap(null);
      }
      timer = setTimeout(() => void read(), delay);
    };
    void read();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [polling]);

  const toggle = useCallback(() => setEnabled((value) => !value), []);

  const value = useMemo<HeatmapContextValue>(
    () => ({
      enabled,
      setEnabled,
      toggle,
      online: !!online,
      heatmap: online && enabled ? heatmap : null,
    }),
    [enabled, toggle, online, heatmap],
  );

  return (
    <HeatmapContext.Provider value={value}>{children}</HeatmapContext.Provider>
  );
}

/** Null without the provider (provider-less unit tests). */
export function useOptionalHeatmap(): HeatmapContextValue | null {
  return useContext(HeatmapContext);
}
