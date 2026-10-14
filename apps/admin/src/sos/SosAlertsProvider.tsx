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

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    try {
      const page = await listSosEvents(apiClient, { status: 'open', size: BADGE_PAGE_SIZE });
      if (!mounted.current) {
        return;
      }
      // The first read seeds the badge silently; later reads toast arrivals.
      if (seen.current !== null) {
        for (const event of newOpenEvents(seen.current, page.items)) {
          show({
            id: `sos-${event.sosEventId}`,
            tone: 'critical',
            title: t('sos.toastTitle'),
            message: t('sos.toastBody', {
              name: event.triggeredBy.name,
              time: formatClock(event.triggeredAt, i18n.language),
            }),
            action: { label: t('sos.toastOpen'), onClick: () => navigate('/live-ops') },
          });
        }
      }
      seen.current = new Set(page.items.map((event) => event.sosEventId));
      setOpenEvents(page.items);
    } catch {
      // Keep the last known alerts: a transient failure must not blank the badge.
    }
  }, [apiClient, enabled, i18n.language, navigate, show, t]);

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
