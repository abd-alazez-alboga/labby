/**
 * Driver demand heatmap facade (DRV-09, UC-D-14, M9-T2) — the single source
 * of `GET /driver/heatmap` for the home map layer and the "Demand near you"
 * sheet section.
 *
 * Refresh: the server recomputes the zone levels once per surge cycle and
 * says when the next cycle runs (`nextCycleAt`). The facade reads the
 * heatmap when it becomes visible and then once per cycle — the next read
 * is scheduled a few seconds after `nextCycleAt`, clamped to one cycle
 * period taken from server timestamps (so a wrong device clock costs at
 * most one cycle), with a fixed fallback when the cycle time is missing.
 * A read that finds the awaited cycle not yet written retries in 15 s, so
 * a level change reaches the map within one cycle (M9 AC).
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

/** Refresh when the cycle time is unknown (null), and the period when unknown. */
export const HEATMAP_FALLBACK_MS = 120_000;
/** Read this long after `nextCycleAt`, so the new cycle has been written. */
export const HEATMAP_CYCLE_GRACE_MS = 5_000;
/** Never schedule sooner than this (a device clock ahead of the server). */
export const HEATMAP_MIN_DELAY_MS = 1_000;
/** Retry this soon when the awaited cycle has not written yet (a slow cycle). */
export const HEATMAP_STALE_RETRY_MS = 15_000;

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : at;
}

/**
 * The cycle period from server timestamps only (`nextCycleAt − computedAt`),
 * so it is immune to the device clock; the fallback when unknown or ≤ 0.
 */
export function cyclePeriod(
  computedAt: string | null,
  nextCycleAt: string | null,
): number {
  const computed = parseTime(computedAt);
  const next = parseTime(nextCycleAt);
  if (computed === null || next === null || next <= computed) {
    return HEATMAP_FALLBACK_MS;
  }
  return next - computed;
}

/**
 * Milliseconds until the next read: `nextCycleAt` + grace, clamped to
 * [1 s, one period + grace] — a device clock off from the server can shift
 * the read by at most one cycle. The fallback when the cycle time is unknown.
 */
export function nextRefreshDelay(
  nextCycleAt: string | null,
  computedAt: string | null,
  now: number,
): number {
  const next = parseTime(nextCycleAt);
  if (next === null) return HEATMAP_FALLBACK_MS;
  const max = cyclePeriod(computedAt, nextCycleAt) + HEATMAP_CYCLE_GRACE_MS;
  return Math.min(
    Math.max(next + HEATMAP_CYCLE_GRACE_MS - now, HEATMAP_MIN_DELAY_MS),
    max,
  );
}

/** What the schedule remembers between reads. */
export interface RefreshTrack {
  /** The `nextCycleAt` the last fresh read announced — the cycle awaited. */
  awaited: string | null;
  /** That read's cycle period (bounds the slow-cycle retries). */
  period: number;
  /** 15 s retries already spent waiting for `awaited`. */
  retries: number;
}

export const INITIAL_REFRESH_TRACK: RefreshTrack = {
  awaited: null,
  period: HEATMAP_FALLBACK_MS,
  retries: 0,
};

/**
 * Plans the read after `read`. When the latest `computedAt` is not later
 * than the cycle announced before (that cycle has not written yet), it
 * retries in 15 s instead of sleeping a whole cycle — for at most one
 * period, so a stopped cycle does not turn into 15 s polling; after that
 * it keeps the normal schedule (never sooner than 15 s) until a fresh
 * cycle appears.
 */
export function planNextRead(
  read: { computedAt: string | null; nextCycleAt: string | null },
  track: RefreshTrack,
  now: number,
): { delay: number; track: RefreshTrack } {
  const awaited = parseTime(track.awaited);
  const computed = parseTime(read.computedAt);
  const normal = nextRefreshDelay(read.nextCycleAt, read.computedAt, now);
  if (awaited !== null && computed !== null && computed <= awaited) {
    if ((track.retries + 1) * HEATMAP_STALE_RETRY_MS <= track.period) {
      return {
        delay: HEATMAP_STALE_RETRY_MS,
        track: { ...track, retries: track.retries + 1 },
      };
    }
    return { delay: Math.max(normal, HEATMAP_STALE_RETRY_MS), track };
  }
  return {
    delay: normal,
    track: {
      awaited: read.nextCycleAt,
      period: cyclePeriod(read.computedAt, read.nextCycleAt),
      retries: 0,
    },
  };
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
    let track = INITIAL_REFRESH_TRACK;
    const read = async () => {
      let delay = HEATMAP_FALLBACK_MS;
      try {
        const next = await getDriverHeatmap();
        if (cancelled) return;
        setHeatmap(next);
        const plan = planNextRead(next, track, Date.now());
        delay = plan.delay;
        track = plan.track;
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
