import { useCallback, useEffect, useRef, useState } from 'react';

import type { FileRef } from '../../api/onboarding';
import { classifyError, nextRefreshDelay, type FailureKind } from './review-utils';

export interface ReviewResource<T> {
  data: T | null;
  /** Why the initial load failed (network vs server vs 404), or null. */
  loadError: FailureKind | null;
  /** A silent file-URL refresh failed; visible links may have expired. */
  filesStale: boolean;
  /** Full reload with the loading state (initial load / retry). */
  reload: () => void;
  /** Silent refetch for fresh file URLs — what an expired/broken file triggers. */
  refreshFiles: () => void;
  /** Replace the data with a mutation's response (wins over any in-flight refresh). */
  replace: (next: T) => void;
  /** Refetch after a refused decision; resolves to the current server state (or the error). */
  refetch: () => Promise<{ data: T } | { error: unknown }>;
}

/**
 * State holder for one review resource (application, vehicle switch,
 * renewal) whose responses carry expiring file URLs (NFR-S2). The URLs are
 * never cached beyond the response: a timer refetches the resource shortly
 * before the earliest `urlExpiresAt`, and a broken file asks for the same
 * silent refresh. Mutation responses always win over a refresh that was
 * already in flight, so a stale read can never roll back a decision.
 */
export function useReviewResource<T>(
  load: () => Promise<T>,
  filesOf: (data: T) => FileRef[],
): ReviewResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loadError, setLoadError] = useState<FailureKind | null>(null);
  const [filesStale, setFilesStale] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const version = useRef(0);
  const refreshing = useRef(false);
  const filesOfRef = useRef(filesOf);
  filesOfRef.current = filesOf;

  useEffect(() => {
    let cancelled = false;
    version.current += 1;
    setData(null);
    setLoadError(null);
    setFilesStale(false);
    load()
      .then((loaded) => {
        if (!cancelled) {
          setData(loaded);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setLoadError(classifyError(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const refreshFiles = useCallback(() => {
    if (refreshing.current) {
      return;
    }
    refreshing.current = true;
    const startedAt = version.current;
    load()
      .then((fresh) => {
        if (version.current === startedAt) {
          setData(fresh);
          setFilesStale(false);
        }
      })
      .catch(() => {
        if (version.current === startedAt) {
          setFilesStale(true);
        }
      })
      .finally(() => {
        refreshing.current = false;
      });
  }, [load]);

  // Re-mint the URLs before they expire, every time new data arrives.
  useEffect(() => {
    if (data === null) {
      return;
    }
    const delay = nextRefreshDelay(filesOfRef.current(data));
    if (delay === null) {
      return;
    }
    const timer = setTimeout(refreshFiles, delay);
    return () => clearTimeout(timer);
  }, [data, refreshFiles]);

  const replace = useCallback((next: T) => {
    version.current += 1;
    setData(next);
    setFilesStale(false);
  }, []);

  const refetch = useCallback(async () => {
    try {
      const fresh = await load();
      replace(fresh);
      return { data: fresh };
    } catch (error) {
      return { error };
    }
  }, [load, replace]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, loadError, filesStale, reload, refreshFiles, replace, refetch };
}
