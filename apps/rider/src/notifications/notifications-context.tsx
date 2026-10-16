/**
 * Notification state of the signed-in rider app (M6-T4, NTF-01..03).
 *
 * Mounted inside the signed-in (app) layout, it owns:
 * - the unread badge count (`GET /notifications/unread-count?app=rider`),
 *   refreshed on mount, on foreground re-entry and whenever a push arrives
 *   while the app is open; the center screen pushes its fresher numbers in
 *   through `setUnread`;
 * - push registration after sign-in (prompting once) + a silent retry on
 *   foreground re-entry until it succeeds (a permission granted later in
 *   Settings, an API failure) + token-rotation follow-up
 *   (push-registration.ts);
 * - notification taps: the push's deep link is mapped (deep-links.ts) and
 *   opened, and the notification is marked read — including the tap that
 *   cold-started the app, which waits until the signed-in stack is mounted
 *   (navigation-settled.ts) so the deep link is not dropped;
 * - foreground presentation: banners for every push, except a chat push for
 *   the chat screen that is open on that same ride (open-chat.ts);
 * - M11: an account-state push (suspended / reactivated, received or
 *   tapped) re-reads the profile so the suspended screen follows it.
 */
import type * as ExpoNotifications from "expo-notifications";
import { useNavigationContainerRef, useRouter } from "expo-router";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";

import { getUnreadCount, markNotificationRead } from "../api/notifications";
import { ACCOUNT_STATE_EVENTS, useOptionalAuth } from "../auth/auth-context";
import { openChatRideId } from "../chat/open-chat";
import { notifications } from "./notifications-module";
import { parsePushPayload, resolveDeepLink } from "./deep-links";
import { whenSignedInStackSettled } from "./navigation-settled";
import { registerForPush, watchPushTokenRotation } from "./push-registration";

export interface NotificationsContextValue {
  /** Unread count of the rider center; null until first known. */
  unread: number | null;
  setUnread: (count: number) => void;
  refreshUnread: () => void;
}

const NotificationsContext = createContext<
  NotificationsContextValue | undefined
>(undefined);

/** Taps already handled in this JS session (cold-start + listener overlap). */
const handledResponses = new Set<string>();

/** Test hook: forget handled taps (and the configured handler) between suites. */
export function resetHandledNotificationResponses(): void {
  handledResponses.clear();
  handlerConfigured = false;
}

function notificationData(
  notification: ExpoNotifications.Notification | null | undefined,
): Record<string, unknown> {
  const request = notification?.request;
  const data = request?.content?.data;
  if (data && Object.keys(data).length > 0) {
    return data as Record<string, unknown>;
  }
  // Raw FCM messages on Android may carry their data on the trigger only.
  const remote = (
    request?.trigger as { remoteMessage?: { data?: Record<string, unknown> } } | null
  )?.remoteMessage;
  return remote?.data ?? {};
}

function responseData(
  response: ExpoNotifications.NotificationResponse,
): Record<string, unknown> {
  return notificationData(response.notification);
}

/**
 * A foreground chat push for the chat screen open on that same ride: the
 * message is landing live there, so it shows no banner, list entry or sound
 * (owner ruling 2026-10-14). The center records it either way.
 */
export function isPushForOpenChat(data: Record<string, unknown>): boolean {
  if (AppState.currentState !== "active") return false;
  const openRideId = openChatRideId();
  if (!openRideId) return false;
  const { link } = parsePushPayload(data);
  const isChat = data.event === "chat.message" || link?.screen === "chat";
  return isChat && link?.params?.rideId === openRideId;
}

let handlerConfigured = false;

/**
 * Foreground pushes are shown as banners too (the center records them
 * anyway) — except a chat push for the chat that is open on that ride.
 */
function configureForegroundPresentation(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;
  try {
    notifications().setNotificationHandler({
      handleNotification: async (notification) => {
        const show = !isPushForOpenChat(notificationData(notification));
        return {
          shouldShowBanner: show,
          shouldShowList: show,
          shouldPlaySound: show,
          shouldSetBadge: false,
        };
      },
    });
  } catch {
    // unsupported runtime — nothing to present
  }
}

export function NotificationsProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  const [unread, setUnreadState] = useState<number | null>(null);
  const mounted = useRef(true);
  const auth = useOptionalAuth();
  const refreshProfile = auth?.refreshProfile;

  // M11: an account-state push re-reads the profile (suspended screen).
  const followAccountState = useCallback(
    (data: Record<string, unknown>) => {
      if (
        typeof data.event === "string" &&
        ACCOUNT_STATE_EVENTS.includes(data.event)
      ) {
        void refreshProfile?.();
      }
    },
    [refreshProfile],
  );

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
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") refreshUnread();
      previous = next;
    });
    return () => subscription.remove();
  }, [refreshUnread]);

  // Push registration after sign-in + token rotation. Prompts once per
  // sign-in; later foregrounds only re-check (no dialog loop) and register
  // when the permission is already granted.
  useEffect(() => {
    configureForegroundPresentation();
    let registered = false;
    let inFlight = false;
    let cancelled = false;
    let prompted = false;
    const attempt = () => {
      if (registered || inFlight) return;
      const prompt = !prompted;
      prompted = true;
      inFlight = true;
      void registerForPush({ prompt })
        .then((result) => {
          if (!cancelled) registered = result === "registered";
        })
        .finally(() => {
          inFlight = false;
        });
    };
    attempt();
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && previous !== "active") attempt();
      previous = next;
    });
    const stopRotation = watchPushTokenRotation();
    return () => {
      cancelled = true;
      subscription.remove();
      stopRotation();
    };
  }, []);

  // A tap waiting for the signed-in stack to mount (cold start).
  const cancelPendingTap = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelPendingTap.current?.(), []);

  const openResponse = useCallback(
    (response: ExpoNotifications.NotificationResponse | null) => {
      if (!response) return;
      const id = response.notification.request.identifier;
      if (handledResponses.has(id)) return;
      handledResponses.add(id);
      const data = responseData(response);
      followAccountState(data);
      const { notificationId, link } = parsePushPayload(data);
      if (notificationId) {
        markNotificationRead(notificationId)
          .catch(() => {})
          .finally(() => refreshUnread());
      }
      const href = resolveDeepLink(link);
      cancelPendingTap.current?.();
      cancelPendingTap.current = whenSignedInStackSettled(navigationRef, () => {
        cancelPendingTap.current = null;
        router.push(href);
      });
    },
    [navigationRef, refreshUnread, router, followAccountState],
  );

  // Taps on pushes (warm) and the tap that launched the app (cold).
  useEffect(() => {
    let cancelled = false;
    let subscription: { remove: () => void } | null = null;
    try {
      subscription =
        notifications().addNotificationResponseReceivedListener(openResponse);
      notifications()
        .getLastNotificationResponseAsync()
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
      subscription = notifications().addNotificationReceivedListener(
        (notification) => {
          refreshUnread();
          followAccountState(notificationData(notification));
        },
      );
    } catch {
      // unsupported runtime
    }
    return () => subscription?.remove();
  }, [refreshUnread, followAccountState]);

  const value = useMemo<NotificationsContextValue>(
    () => ({ unread, setUnread, refreshUnread }),
    [unread, setUnread, refreshUnread],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}

/** Notification state, or null outside the signed-in layout (provider-less tests). */
export function useOptionalNotifications(): NotificationsContextValue | null {
  return useContext(NotificationsContext) ?? null;
}
