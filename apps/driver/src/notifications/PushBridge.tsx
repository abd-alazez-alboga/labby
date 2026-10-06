import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { markNotificationRead } from '../api/notifications';
import { useAuth } from '../auth/AuthProvider';
import { addSignOutTask } from '../auth/sign-out-tasks';
import { hrefForLink, parsePushPayload } from './deep-links';
import {
  configureForegroundPresentation,
  onNotificationReceived,
  onNotificationTap,
  onPushTokenChange,
  registerThisDevice,
  registerToken,
  takeLaunchTap,
  unregisterThisDevice,
} from './push';
import { refreshUnread } from './unread-store';

/**
 * Root-level push wiring (renders nothing), active for ANY signed-in
 * account — applicants receive their application-stage pushes here too:
 * - registers the device after login / on start, and re-registers when FCM
 *   rotates the token; an unsuccessful registration (API failure, or
 *   permission granted later in Settings) retries on the next foreground;
 * - unregisters it on sign-out (a sign-out task, while the session lives);
 * - routes notification taps (warm and cold start) through the shared
 *   deep-link mapper and marks the tapped notification read;
 * - refreshes the unread badge when a push arrives in the foreground.
 */
export function PushBridge() {
  const router = useRouter();
  const { status, isDriver } = useAuth();
  const signedIn = status === 'signedIn';
  const context = useRef({ signedIn, isDriver });
  context.current = { signedIn, isDriver };

  useEffect(() => {
    configureForegroundPresentation();
  }, []);

  // Registration lifecycle.
  useEffect(() => {
    if (!signedIn) return undefined;
    let registered = false;
    let cancelled = false;
    // Prompt once per sign-in; later foregrounds only re-check (no dialog loop).
    let prompted = false;
    const attempt = () => {
      if (registered) return;
      const prompt = !prompted;
      prompted = true;
      registerThisDevice({ prompt })
        .then((done) => {
          // false = unavailable right now (Expo Go, permission denied, no
          // token): the next foreground checks again — cheap, never re-prompts.
          if (!cancelled) registered = done;
        })
        .catch(() => {
          // API trouble: retried on the next foreground.
        });
    };
    attempt();
    const appState = AppState.addEventListener('change', (next) => {
      if (next === 'active') attempt();
    });
    const tokenListener = onPushTokenChange((token) => {
      registerToken(token).catch(() => {});
    });
    const removeTask = addSignOutTask(unregisterThisDevice);
    return () => {
      cancelled = true;
      appState.remove();
      tokenListener();
      removeTask();
    };
  }, [signedIn]);

  // Taps → deep links.
  useEffect(() => {
    const open = (data: unknown) => {
      if (!context.current.signedIn) return;
      const { link, notificationId } = parsePushPayload(data);
      if (notificationId) {
        markNotificationRead(notificationId)
          .catch(() => {})
          .finally(() => void refreshUnread());
      }
      router.navigate(hrefForLink(link, { isDriver: context.current.isDriver }));
    };
    const removeTap = onNotificationTap(open);
    let cancelled = false;
    void takeLaunchTap().then((data) => {
      if (!cancelled && data) open(data);
    });
    const removeReceived = onNotificationReceived(() => {
      void refreshUnread();
    });
    return () => {
      cancelled = true;
      removeTap();
      removeReceived();
    };
  }, [router]);

  return null;
}
