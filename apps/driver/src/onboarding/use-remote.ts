import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../api/client';
import { failureKindOf } from './server-errors';
import type { FailureKind } from './server-errors';

/**
 * Facade hook for one onboarding resource (application, vehicles, document
 * slots). It loads whenever the screen gains focus, so the expiring file URLs
 * inside the resource are always freshly minted (NFR-S2) instead of cached.
 * Contract statuses that mean a STATE rather than a failure (404 never
 * applied, 409 not an approved driver) are surfaced as `absent`.
 *
 * `load` and `absentStatuses` must be stable (module-level functions and
 * constants), as they key the reload callback.
 */
export type RemoteState<T> =
  | { status: 'loading' }
  | { status: 'loaded'; data: T }
  | { status: 'absent'; httpStatus: number }
  | { status: 'error'; kind: FailureKind };

export interface Remote<T> {
  state: RemoteState<T>;
  /** True while a reload runs with data already on screen. */
  refreshing: boolean;
  reload: () => Promise<void>;
}

const NONE: readonly number[] = [];

export function useRemote<T>(
  load: () => Promise<T>,
  absentStatuses: readonly number[] = NONE,
): Remote<T> {
  const [state, setState] = useState<RemoteState<T>>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const hasDataRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (hasDataRef.current) setRefreshing(true);
    else setState({ status: 'loading' });
    try {
      const data = await load();
      if (!mountedRef.current) return;
      hasDataRef.current = true;
      setState({ status: 'loaded', data });
    } catch (error) {
      if (!mountedRef.current) return;
      hasDataRef.current = false;
      if (error instanceof ApiError && absentStatuses.includes(error.status)) {
        setState({ status: 'absent', httpStatus: error.status });
      } else {
        setState({ status: 'error', kind: failureKindOf(error) });
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [load, absentStatuses]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { state, refreshing, reload };
}
