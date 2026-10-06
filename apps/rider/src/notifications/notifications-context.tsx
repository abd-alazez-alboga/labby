/**
 * Notification state of the signed-in rider app (M6-T4, NTF-01..03).
 *
 * Mounted inside the signed-in (app) layout, it owns:
 * - the unread badge count (`GET /notifications/unread-count?app=rider`),
 *   refreshed on mount, on foreground re-entry and whenever a push arrives
 *   while the app is open; the center screen pushes its fresher numbers in
 *   through `setUnread`;
 * - push registration after sign-in + token-rotation follow-up
 *   (push-registration.ts);
 * - notification taps: the push's deep link is mapped (deep-links.ts) and
 *   opened, and the notification is marked read — including the tap that
 *   cold-started the app.
 */
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { getUnreadCount, markNotificationRead } from '../api/notifications';
import { parsePushPayload, resolveDeepLink } from './deep-links';
import { registerForPush, watchPushTokenRotation } from './push-registration';

export interface NotificationsContextValue {
  /** Unread count of the rider center; null until first known. */
  unread: number | null;
  setUnread: (count: number) => void;
  refreshUnread: () => void;
}

const NotificationsContext = createContext<NotificationsContextValue | undefined>(undefined);

/** Taps already handled in this JS session (cold-start + listener overlap). */
const handledResponses = new Set<string>();

/** Test hook: forget handled taps between suites. */
export function resetHandledNotificationResponses(): void {
  handledResponses.clear();
}

function responseData(response: Notifications.NotificationResponse): Record<string, unknown> {
  const { content, trigger } = response.notification.request;
  if (content.data && Object.keys(content.data).length > 0) {
    return content.data as Record<string, unknown>;
  }
  // Raw FCM messages on Android may carry their data on the trigger only.
  const remote = (trigger as { remoteMessage?: { data?: Record<string, unknown> } } | null)
    ?.remoteMessage;
  return remote?.data ?? {};
}

let handlerConfigured = false;

/** Foreground pushes are shown as banners too (the center records them anyway). */
function configureForegroundPresentation(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // unsupported runtime — nothing to present
  }
}

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [unread, setUnreadState] = useState<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const setUnread = useCallback((count: number) => {
    if (mounted.current) setUnreadState(Math.max(0, count));
  }, []);

  const refreshUnread = useCallback(() => {
    getUnreadCount()
      .then((count) => setUnread(count))
      .catch(() => {
        // keep the last known badge; the center shows its own error state
      });
  }, [setUnread]);

  // Badge on mount and on foreground re-entry.
  useEffect(() => {
    refreshUnread();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active' && previous !== 'active') refreshUnread();
      previous = next;
    });
    return () => subscription.remove();
  }, [refreshUnread]);

  // Push registration after sign-in + token rotation.
  useEffect(() => {
    configureForegroundPresentation();
    void registerForPush();
    return watchPushTokenRotation();
  }, []);

  const openResponse = useCallback(
    (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledResponses.has(id)) return;
      handledResponses.add(id);
      const { notificationId, link } = parsePushPayload(responseData(response));
      if (notificationId) {
        markNotificationRead(notificationId)
          .catch(() => {})
          .finally(() => refreshUnread());
      }
      router.push(resolveDeepLink(link));
    },
    [refreshUnread, router],
  );

  // Taps on pushes (warm) and the tap that launched the app (cold).
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
      Notifications.getLastNotificationResponseAsync()
        .then((response) => {
          if (!cancelled) openResponse(response);
        })
        .catch(() => {});
    } catch {
      // unsupported runtime
    }
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [openResponse]);

  // A push received while the app is open bumps the badge.
  useEffect(() => {
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = Notifications.addNotificationReceivedListener(() => refreshUnread());
    } catch {
      // unsupported runtime
    }
    return () => subscription?.remove();
  }, [refreshUnread]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ unread, setUnread, refreshUnread }),
    [unread, setUnread, refreshUnread],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** Notification state, or null outside the signed-in layout (provider-less tests). */
export function useOptionalNotifications(): NotificationsContextValue | null {
  return useContext(NotificationsContext) ?? null;
}
