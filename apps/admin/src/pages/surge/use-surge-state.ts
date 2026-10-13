import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { getSurgeState, type SurgeState } from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { toSurgeOverlay, type SurgeOverlayZone } from './surge-overlay';

/** Refetch this long after the announced next cycle, so its results are in. */
export const CYCLE_GRACE_MS = 5_000;
/** Refetch interval (and cycle period) when unknown (cycle off, or a failed read). */
export const FALLBACK_REFRESH_MS = 120_000;
/** Never schedule sooner than this (a device clock ahead of the server). */
export const MIN_REFRESH_MS = 1_000;
/** Retry this soon when the awaited cycle has not written yet (a slow cycle). */
export const STALE_RETRY_MS = 15_000;

function parseTime(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const at = new Date(value).getTime();
  return Number.isFinite(at) ? at : null;
}

/** The latest cycle any zone reports (zones of one region run in the same cycle). */
export function latestComputedAt(zones: SurgeState['zones']): string | null {
  let latest: string | null = null;
  for (const zone of zones) {
    const at = parseTime(zone.computedAt);
    if (at !== null && (latest === null || at > parseTime(latest)!)) {
      latest = zone.computedAt;
    }
  }
  return latest;
}

/**
 * The cycle period from server timestamps only (`nextCycleAt − computedAt`),
 * so it is immune to the device clock; the fallback when unknown or ≤ 0.
 */
export function cyclePeriod(computedAt: string | null, nextCycleAt: string | null): number {
  const computed = parseTime(computedAt);
  const next = parseTime(nextCycleAt);
  return computed === null || next === null || next <= computed
    ? FALLBACK_REFRESH_MS
    : next - computed;
}

/**
 * Milliseconds until the next refetch: next cycle + grace, clamped to
 * [1 s, one period + grace] — a device clock off from the server shifts the
 * read by at most one cycle. The fallback when the cycle time is unknown.
 */
export function nextRefreshDelay(
  nextCycleAt: string | null,
  computedAt: string | null,
  now: number = Date.now(),
): number {
  const next = parseTime(nextCycleAt);
  if (next === null) {
    return FALLBACK_REFRESH_MS;
  }
  const max = cyclePeriod(computedAt, nextCycleAt) + CYCLE_GRACE_MS;
  return Math.min(Math.max(next + CYCLE_GRACE_MS - now, MIN_REFRESH_MS), max);
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
  period: FALLBACK_REFRESH_MS,
  retries: 0,
};

/**
 * Plans the refetch after a scheduled read. When the newest `computedAt`
 * is not later than the cycle announced before (that cycle has not written
 * yet), it retries in 15 s instead of sleeping a whole cycle — for at most
 * one period, so a stopped cycle does not turn into 15 s polling; after
 * that it keeps the normal schedule (never sooner than 15 s) until a fresh
 * cycle appears. An unscheduled read (the first one, or a manual refresh
 * mid-cycle) never counts as "not written yet": it keeps the normal schedule.
 */
export function planNextRead(
  read: SurgeState,
  track: RefreshTrack,
  now: number = Date.now(),
  scheduled = true,
): { delay: number; track: RefreshTrack } {
  const computedAt = latestComputedAt(read.zones);
  const awaited = parseTime(track.awaited);
  const computed = parseTime(computedAt);
  const normal = nextRefreshDelay(read.nextCycleAt, computedAt, now);
  if (awaited !== null && computed !== null && computed <= awaited) {
    if (!scheduled) {
      return { delay: normal, track };
    }
    if ((track.retries + 1) * STALE_RETRY_MS <= track.period) {
      return { delay: STALE_RETRY_MS, track: { ...track, retries: track.retries + 1 } };
    }
    return { delay: Math.max(normal, STALE_RETRY_MS), track };
  }
  return {
    delay: normal,
    track: {
      awaited: read.nextCycleAt,
      period: cyclePeriod(computedAt, read.nextCycleAt),
      retries: 0,
    },
  };
}

export interface SurgeStateFacade {
  /** The latest surge state; null until the first read succeeds. */
  state: SurgeState | null;
  /** The same zones as a map overlay (empty until loaded) — for the M10 live map. */
  overlay: SurgeOverlayZone[];
  /** Why the latest read failed: an unknown region, or anything else; null when it worked. */
  error: 'notFound' | 'failed' | null;
  /** Refetch now (e.g. after an override change) and re-arm the cycle timer. */
  refresh: () => Promise<void>;
}

/**
 * Facade for a region's live surge state (UC-A-09, PRC-02). Reads
 * surge-state and re-reads it a few seconds after each announced cycle
 * (`nextCycleAt`, clamped to one cycle period from server timestamps, so a
 * wrong device clock costs at most one cycle), retrying in 15 s when that
 * cycle has not written yet, and falling back to every 2 minutes when the
 * cycle time is unknown — so levels and pending overrides propagate within
 * one cycle.
 * A failed refresh keeps the last state and retries on the fallback.
 * Needs pricing:view; pass `enabled = false` to keep it idle without it.
 */
export function useSurgeState(regionId: string | undefined, enabled = true): SurgeStateFacade {
  const { apiClient } = useAuth();
  const [state, setState] = useState<SurgeState | null>(null);
  const [error, setError] = useState<'notFound' | 'failed' | null>(null);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!regionId || !enabled) {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    let track = INITIAL_REFRESH_TRACK;
    setState(null);
    setError(null);

    // `scheduled`: the timer's read, made for the awaited cycle. A manual
    // refresh (e.g. after an override) may run mid-cycle (planNextRead).
    async function load(scheduled = false): Promise<void> {
      clearTimeout(timer);
      const mine = ++generation;
      let delay = FALLBACK_REFRESH_MS;
      try {
        const next = await getSurgeState(apiClient, regionId!);
        if (disposed || mine !== generation) {
          return;
        }
        setState(next);
        setError(null);
        const plan = planNextRead(next, track, Date.now(), scheduled);
        delay = plan.delay;
        track = plan.track;
      } catch (failure) {
        if (disposed || mine !== generation) {
          return;
        }
        setError(failure instanceof ApiError && failure.status === 404 ? 'notFound' : 'failed');
      }
      timer = setTimeout(() => void load(true), delay);
    }

    refreshRef.current = () => load();
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      refreshRef.current = () => Promise.resolve();
    };
  }, [apiClient, regionId, enabled]);

  const refresh = useCallback(() => refreshRef.current(), []);
  const overlay = useMemo(() => (state ? toSurgeOverlay(state) : []), [state]);

  return { state, overlay, error, refresh };
}
