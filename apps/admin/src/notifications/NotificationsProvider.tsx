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

import { getUnreadCount } from '../api/notifications';
import { useAuth } from '../auth/AuthContext';

/**
 * Polling cadence of the unread badge. Push is an accelerator, not a
 * requirement: without it (no Firebase config yet, permission denied,
 * unsupported browser) the badge still converges within this interval,
 * and immediately whenever the tab regains focus.
 */
export const UNREAD_POLL_MS = 60_000;

export interface NotificationsApi {
  /** Unread count of the admin center; null until the first successful read. */
  unread: number | null;
  /** Re-reads the count from the server (failures keep the last known value). */
  refreshUnread(): Promise<void>;
  /** Adopts a count the server just reported (e.g. a center page's `unread`). */
  reportUnread(count: number): void;
  /**
   * Bumped whenever new notifications are known to have arrived — a push, or
   * a polled count that rose — so an open center can offer to show them.
   */
  arrivals: number;
  /** A push just arrived: bump `arrivals` and re-read the count. */
  signalArrival(): void;
}

const NotificationsContext = createContext<NotificationsApi | null>(null);

/**
 * Notification-center facade for the signed-in shell: owns the unread
 * badge count and keeps it fresh by polling (interval while the tab is
 * visible, plus on focus/visibility regain). The center page and push
 * handler report into it so every surface shows one number.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { apiClient } = useAuth();
  const [unread, setUnread] = useState<number | null>(null);
  const [arrivals, setArrivals] = useState(0);
  const lastKnown = useRef<number | null>(null);
  const mounted = useRef(true);

  const refreshUnread = useCallback(async () => {
    try {
      const count = await getUnreadCount(apiClient);
      if (!mounted.current) return;
      // The unread count only rises when something new arrived.
      if (lastKnown.current !== null && count > lastKnown.current) {
        setArrivals((n) => n + 1);
      }
      lastKnown.current = count;
      setUnread(count);
    } catch {
      // Keep the last known value: a transient failure must not blank the badge.
    }
  }, [apiClient]);

  const reportUnread = useCallback((count: number) => {
    lastKnown.current = count;
    setUnread(count);
  }, []);

  const signalArrival = useCallback(() => {
    setArrivals((n) => n + 1);
    void refreshUnread();
  }, [refreshUnread]);

  useEffect(() => {
    mounted.current = true;
    void refreshUnread();

    const tick = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') {
        void refreshUnread();
      }
    }, UNREAD_POLL_MS);
    const onFocus = () => void refreshUnread();
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refreshUnread();
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
  }, [refreshUnread]);

  const value = useMemo<NotificationsApi>(
    () => ({ unread, refreshUnread, reportUnread, arrivals, signalArrival }),
    [unread, refreshUnread, reportUnread, arrivals, signalArrival],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** Typed access to the notification-center facade. */
// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationsApi {
  const value = useContext(NotificationsContext);
  if (value === null) {
    throw new Error('useNotifications must be used inside <NotificationsProvider>');
  }
  return value;
}
