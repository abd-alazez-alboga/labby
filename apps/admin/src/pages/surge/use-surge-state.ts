import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { getSurgeState, type SurgeState } from '../../api/regions';
import { useAuth } from '../../auth/AuthContext';
import { toSurgeOverlay, type SurgeOverlayZone } from './surge-overlay';

/** Refetch this long after the announced next cycle, so its results are in. */
export const CYCLE_GRACE_MS = 5_000;
/** Refetch interval when the next cycle is unknown (cycle off, or a failed read). */
export const FALLBACK_REFRESH_MS = 120_000;

/** Milliseconds until the next refetch: next cycle + grace, else the fallback. */
export function nextRefreshDelay(nextCycleAt: string | null, now: number = Date.now()): number {
  if (nextCycleAt === null) {
    return FALLBACK_REFRESH_MS;
  }
  const delay = new Date(nextCycleAt).getTime() + CYCLE_GRACE_MS - now;
  return Number.isFinite(delay) && delay > 0 ? delay : FALLBACK_REFRESH_MS;
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
 * (`nextCycleAt`), falling back to every 2 minutes when the cycle time is
 * unknown — so levels and pending overrides propagate within one cycle.
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
    setState(null);
    setError(null);

    async function load(): Promise<void> {
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
        delay = nextRefreshDelay(next.nextCycleAt);
      } catch (failure) {
        if (disposed || mine !== generation) {
          return;
        }
        setError(failure instanceof ApiError && failure.status === 404 ? 'notFound' : 'failed');
      }
      timer = setTimeout(() => void load(), delay);
    }

    refreshRef.current = load;
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
