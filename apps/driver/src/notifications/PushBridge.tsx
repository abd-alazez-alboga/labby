import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { markNotificationRead } from "../api/notifications";
import { useAuth } from "../auth/AuthProvider";
import { addSignOutTask } from "../auth/sign-out-tasks";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";
import { useOptionalDriverMoney } from "../money/DriverMoneyProvider";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";
import {
  hrefForLink,
  isAccountStateEvent,
  isBalanceEvent,
  isRideLink,
  isScheduledConversion,
  parsePushPayload,
  scheduledNoticeFor,
} from "./deep-links";
import {
  configureForegroundPresentation,
  onNotificationReceived,
  onNotificationTap,
  onPushTokenChange,
  registerThisDevice,
  registerToken,
  takeLaunchTap,
  unregisterThisDevice,
} from "./push";
import { refreshUnread } from "./unread-store";

/**
 * Root-level push wiring (renders nothing), active for ANY signed-in
 * account — applicants receive their application-stage pushes here too:
 * - registers the device after login / on start, and re-registers when FCM
 *   rotates the token; an unsuccessful registration (API failure, or
 *   permission granted later in Settings) retries on the next foreground;
 * - unregisters it on sign-out (a sign-out task, while the session lives);
 * - routes notification taps (warm and cold start) through the shared
 *   deep-link mapper and marks the tapped notification read; a `ride_offer`
 *   / `ride` tap also makes the ride facade resync (the offer may be gone);
 * - refreshes the unread badge when a push arrives in the foreground, and
 *   re-reads balance + availability on a `driver.balance_*` push (W16);
 * - re-reads the profile on an M11 account push (role / account suspended
 *   or reactivated), so the gate follows without a restart.
 */
export function PushBridge() {
  const router = useRouter();
  const { status, isDriver, refreshProfile } = useAuth();
  const signedIn = status === "signedIn";
  const rides = useOptionalDriverRide();
  const openRideLink = rides?.openLink;
  const showRideNotice = rides?.showNotice;
  const resyncRides = rides?.resync;
  const reloadBalance = useOptionalDriverMoney()?.reload;
  const reloadAvailability = useOptionalAvailability()?.reload;
  const context = useRef({
    signedIn,
    isDriver,
    openRideLink,
    showRideNotice,
    resyncRides,
    reloadBalance,
    reloadAvailability,
    refreshProfile,
  });
  context.current = {
    signedIn,
    isDriver,
    openRideLink,
    showRideNotice,
    resyncRides,
    reloadBalance,
    reloadAvailability,
    refreshProfile,
  };

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
    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") attempt();
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
      const { link, notificationId, event } = parsePushPayload(data);
      // M11: a suspension / reactivation changes the gate — re-read it.
      if (isAccountStateEvent(event)) void context.current.refreshProfile();
      if (notificationId) {
        markNotificationRead(notificationId)
          .catch(() => {})
          .finally(() => void refreshUnread());
      }
      if (context.current.isDriver && isRideLink(link))
        context.current.openRideLink?.(link);
      router.navigate(
        hrefForLink(link, { isDriver: context.current.isDriver }),
      );
    };
    const removeTap = onNotificationTap(open);
    let cancelled = false;
    void takeLaunchTap().then((data) => {
      if (!cancelled && data) open(data);
    });
    const removeReceived = onNotificationReceived((data) => {
      void refreshUnread();
      if (
        context.current.signedIn &&
        isAccountStateEvent(parsePushPayload(data).event)
      ) {
        void context.current.refreshProfile();
      }
      // W16: a floor change (blocked / unblocked / warning) re-reads the
      // balance AND availability, so the home updates without a poll.
      if (
        context.current.signedIn &&
        context.current.isDriver &&
        isBalanceEvent(parsePushPayload(data).event)
      ) {
        void context.current.reloadBalance?.();
        void context.current.reloadAvailability?.();
      }
      // M12: scheduled-ride pushes — a notice on the home sheet, or the
      // conversion's live ride picked up at once.
      if (context.current.signedIn && context.current.isDriver) {
        const { event } = parsePushPayload(data);
        const notice = scheduledNoticeFor(event);
        if (notice) context.current.showRideNotice?.(notice);
        if (isScheduledConversion(event)) void context.current.resyncRides?.();
      }
    });
    return () => {
      cancelled = true;
      removeTap();
      removeReceived();
    };
  }, [router]);

  return null;
}
