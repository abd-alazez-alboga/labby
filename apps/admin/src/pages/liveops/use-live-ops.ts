import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../api/client';
import { getLiveOps, type LiveOps } from '../../api/comms';
import { useAuth } from '../../auth/AuthContext';

/** The contract default (LIVEOPS_REFRESH_SECONDS) until the first read answers. */
export const DEFAULT_REFRESH_SECONDS = 5;
/** Never poll faster than this, whatever the server announces. */
export const MIN_REFRESH_MS = 1_000;
/** Retry pace while reads fail (the last snapshot stays on screen). */
export const FAILED_RETRY_MS = 15_000;

/** The delay until the next poll, from the snapshot's announced pace. */
export function refreshDelayMs(refreshSeconds: number): number {
  return Math.max(MIN_REFRESH_MS, refreshSeconds * 1_000);
}

export interface LiveOpsFacade {
  /** The latest snapshot; null until the first read of the region succeeds. */
  snapshot: LiveOps | null;
  /** Why the LATEST read failed; null while reads succeed. */
  error: 'notFound' | 'failed' | null;
  /** Refetch now (e.g. after an SOS acknowledgement) and re-arm the timer. */
  refresh: () => Promise<void>;
}

/**
 * Facade for the region's live ops snapshot (ADM-03, UC-A-19): polls
 * GET /admin/regions/{id}/live-ops at the pace the response announces
 * (`refreshSeconds`, default 5 s), pausing while the tab is hidden. A failed
 * read keeps the last snapshot on screen, flags `error` and retries every
 * 15 s. Needs rides:view (the page's route guard).
 */
export function useLiveOps(regionId: string | undefined): LiveOpsFacade {
  const { apiClient } = useAuth();
  const [snapshot, setSnapshot] = useState<LiveOps | null>(null);
  const [error, setError] = useState<'notFound' | 'failed' | null>(null);
  const refreshRef = useRef<() => Promise<void>>(() => Promise.resolve());

  useEffect(() => {
    if (!regionId) {
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    setSnapshot(null);
    setError(null);

    async function load(): Promise<void> {
      clearTimeout(timer);
      const mine = ++generation;
      let delay = FAILED_RETRY_MS;
      try {
        const next = await getLiveOps(apiClient, regionId!);
        if (disposed || mine !== generation) {
          return;
        }
        setSnapshot(next);
        setError(null);
        delay = refreshDelayMs(next.refreshSeconds);
      } catch (failure) {
        if (disposed || mine !== generation) {
          return;
        }
        setError(failure instanceof ApiError && failure.status === 404 ? 'notFound' : 'failed');
      }
      timer = setTimeout(() => {
        if (document.visibilityState === 'hidden') {
          // Skip the hidden tick; the visibility listener resumes the poll.
          timer = setTimeout(() => void load(), FAILED_RETRY_MS);
          return;
        }
        void load();
      }, delay);
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    refreshRef.current = () => load();
    void load();
    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      refreshRef.current = () => Promise.resolve();
    };
  }, [apiClient, regionId]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { snapshot, error, refresh };
}
