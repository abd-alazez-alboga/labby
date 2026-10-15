import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import { listSosEvents, type AdminSosEvent } from '../api/comms';
import { useAuth } from '../auth/AuthContext';
import { usePermissions } from '../auth/usePermissions';
import { liveOpsLink } from '../pages/rides/ride-format';
import { formatClock } from '../pages/surge';
import { useToast } from '../toast/ToastProvider';

/**
 * Polling cadence of the open-SOS badge. The `safety` web push (PushProvider)
 * is the accelerator when it is enabled; this poll is what makes the badge
 * and banner honest without it, and immediately on tab focus.
 */
export const SOS_POLL_MS = 30_000;
/** One list page is plenty for a badge — alerts are acknowledged fast (SAFE-01). */
const BADGE_PAGE_SIZE = 50;

/** The events of `next` that were not in `seen` — the ones worth an alert. */
// eslint-disable-next-line react-refresh/only-export-components
export function newOpenEvents(
  seen: ReadonlySet<string>,
  next: readonly AdminSosEvent[],
): AdminSosEvent[] {
  return next.filter((event) => !seen.has(event.sosEventId));
}

export interface SosAlertsApi {
  /**
   * Open (unacknowledged) SOS alerts, newest first; null until the first
   * successful read — and always null without `support:view`.
   */
  openEvents: AdminSosEvent[] | null;
  /** The nav badge count; null while unknown (no permission / first read pending). */
  openCount: number | null;
  /** Re-reads the open list now (e.g. after an acknowledgement). */
  refresh(): Promise<void>;
}

const SosAlertsContext = createContext<SosAlertsApi | null>(null);

/**
 * App-wide open-SOS facade (UC-A-20, SAFE-01) for admins with `support:view`:
 * polls GET /admin/sos-events?status=open, feeds the "Live map" nav badge,
 * and surfaces every NEWLY seen open alert as the sticky critical toast —
 * on whatever admin page is open, with or without web push. Without the
 * permission it stays completely idle.
 */
export function SosAlertsProvider({ children }: { children: ReactNode }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { apiClient } = useAuth();
  const { can } = usePermissions();
  const { show } = useToast();
  const enabled = can('support:view');

  const [openEvents, setOpenEvents] = useState<AdminSosEvent[] | null>(null);
  const seen = useRef<Set<string> | null>(null);
  const mounted = useRef(true);
  /** The read in flight; a refresh asked meanwhile queues ONE follow-up read. */
  const inFlight = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  // Route- and language-dependent callbacks live in a ref, so navigating
  // (a new `navigate`) or switching language (a new `t`) never restarts the poll.
  const latest = useRef({ navigate, t, language: i18n.language, show });
  useEffect(() => {
    latest.current = { navigate, t, language: i18n.language, show };
  });

  const readOnce = useCallback(async () => {
    try {
      const page = await listSosEvents(apiClient, { status: 'open', size: BADGE_PAGE_SIZE });
      if (!mounted.current) {
        return;
      }
      // The first read seeds the badge silently; later reads toast arrivals.
      if (seen.current !== null) {
        const { navigate: go, t: tr, language, show: toast } = latest.current;
        for (const event of newOpenEvents(seen.current, page.items)) {
          toast({
            id: `sos-${event.sosEventId}`,
            tone: 'critical',
            title: tr('sos.toastTitle'),
            message: tr('sos.toastBody', {
              name: event.triggeredBy.name,
              time: formatClock(event.triggeredAt, language),
            }),
            action: { label: tr('sos.toastOpen'), onClick: () => go(liveOpsLink(event)) },
          });
        }
      }
      seen.current = new Set(page.items.map((event) => event.sosEventId));
      setOpenEvents(page.items);
    } catch {
      // Keep the last known alerts: a transient failure must not blank the badge.
    }
  }, [apiClient]);

  /**
   * Reads never overlap: a refresh while one is in flight (focus +
   * visibilitychange on tab return, an acknowledgement mid-poll) waits for
   * it and then reads once more, so the newest answer always lands last.
   */
  const refresh = useCallback((): Promise<void> => {
    if (!enabled) {
      return Promise.resolve();
    }
    if (inFlight.current) {
      queued.current = true;
      return inFlight.current;
    }
    const run = async () => {
      do {
        queued.current = false;
        await readOnce();
      } while (queued.current && mounted.current);
    };
    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [enabled, readOnce]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) {
      setOpenEvents(null);
      seen.current = null;
      return;
    }
    void refresh();
    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void refresh();
      }
    }, SOS_POLL_MS);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh();
      }
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      mounted.current = false;
      window.clearInterval(tick);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, refresh]);

  const value = useMemo<SosAlertsApi>(
    () => ({
      openEvents,
      openCount: openEvents === null ? null : openEvents.length,
      refresh,
    }),
    [openEvents, refresh],
  );

  return <SosAlertsContext.Provider value={value}>{children}</SosAlertsContext.Provider>;
}

/** Typed access to the open-SOS facade. */
// eslint-disable-next-line react-refresh/only-export-components
export function useSosAlerts(): SosAlertsApi {
  const value = useContext(SosAlertsContext);
  if (value === null) {
    throw new Error('useSosAlerts must be used inside <SosAlertsProvider>');
  }
  return value;
}
