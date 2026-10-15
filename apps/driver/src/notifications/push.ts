import AsyncStorage from "@react-native-async-storage/async-storage";
import { isRunningInExpoGo } from "expo";
import type * as ExpoNotifications from "expo-notifications";
import { AppState, Platform } from "react-native";

import { registerDevice, unregisterDevice } from "../api/notifications";
import type { DevicePlatform } from "../api/realtime-types";
import { runExclusive } from "../permissions/permission-queue";
import { parsePushPayload } from "./deep-links";
import { openChatRideId } from "./open-chat";

/**
 * Push plumbing (NTF-01, UC-S-25) — the ONLY module touching
 * expo-notifications. Every call degrades to a no-op instead of throwing:
 *
 * - Expo Go cannot receive remote pushes (Android support was removed in
 *   SDK 53; on iOS it would hand out Expo Go's own APNs token), so device
 *   registration is skipped there. Real FCM delivery needs a native dev
 *   build plus the owner's Firebase config (M6-T5).
 * - `getDevicePushTokenAsync` returns the native token: the FCM token on
 *   Android, the APNs token on iOS (see the M6-T4 report — the backend's
 *   FCM sender needs an FCM token, so iOS needs a decision at T5).
 */

export const PUSH_TOKEN_STORAGE_KEY = "labby-driver.push-token";
/** Android notification channel for every push (same id as the rider app). */
export const ANDROID_CHANNEL_ID = "default";

export type PushPermission =
  "granted" | "denied" | "undetermined" | "unsupported";

/** Remote push can work in this runtime (native build on Android/iOS). */
export function pushSupported(): boolean {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return false;
  try {
    return !isRunningInExpoGo();
  } catch {
    return false;
  }
}

/**
 * expo-notifications, loaded lazily. A static import crashes Expo Go on
 * Android at import time (remote push was removed from Expo Go in SDK 53),
 * so the module is only required in runtimes that support remote push.
 * Throws when unavailable — every caller treats that as "unsupported".
 */
let loadedNotifications: typeof ExpoNotifications | null = null;
function notifications(): typeof ExpoNotifications {
  if (loadedNotifications) return loadedNotifications;
  if (!pushSupported()) {
    throw new Error("expo-notifications is unavailable in this runtime");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require("expo-notifications") as typeof ExpoNotifications;
  loadedNotifications = loaded;
  return loaded;
}

/**
 * Android 13+ reports POST_NOTIFICATIONS as `denied` before the app has EVER asked
 * (with `canAskAgain: true`); only `canAskAgain: false` is a real, final denial.
 * Treating the first state as denied meant the app never prompted (found on a
 * fresh Android 15 install, M6-T5).
 */
function toPermission(
  status: string | undefined,
  granted: boolean,
  canAskAgain: boolean | undefined,
): PushPermission {
  if (granted) return "granted";
  if (status === "denied" && canAskAgain === false) return "denied";
  return "undetermined";
}

/** Current OS permission without prompting. */
export async function getPushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return "unsupported";
  try {
    const result = await notifications().getPermissionsAsync();
    return toPermission(result.status, result.granted, result.canAskAgain);
  } catch {
    return "unsupported";
  }
}

/**
 * Asks for permission when still undetermined (shows the OS prompt once).
 * Queued behind any other permission dialog (Android drops a prompt made
 * while another is showing) and re-checked once its turn comes.
 */
export function ensurePushPermission(): Promise<PushPermission> {
  return runExclusive(async () => {
    const current = await getPushPermission();
    if (current !== "undetermined") return current;
    try {
      const result = await notifications().requestPermissionsAsync();
      return toPermission(result.status, result.granted, result.canAskAgain);
    } catch {
      return "unsupported";
    }
  });
}

/**
 * Android 13+ only shows the permission prompt once a channel exists, and
 * without one pushes land in the fallback channel (no heads-up banner).
 * Idempotent; best-effort.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android" || !pushSupported()) return;
  try {
    await notifications().setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Labby",
      importance: notifications().AndroidImportance.HIGH,
    });
  } catch {
    // best-effort: registration still proceeds
  }
}

function platform(): DevicePlatform {
  return Platform.OS === "ios" ? "ios" : "android";
}

async function rememberToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(PUSH_TOKEN_STORAGE_KEY, token);
    else await AsyncStorage.removeItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    // best-effort
  }
}

async function rememberedToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** `PUT /devices` for a token (login, rotation). Rejects on API failure. */
export async function registerToken(token: string): Promise<void> {
  await registerDevice({ token, platform: platform(), app: "driver" });
  await rememberToken(token);
}

/**
 * After login / on app start while signed in: Android channel → permission →
 * native token → `PUT /devices`. Resolves true when registered, false when push is
 * unavailable here (Expo Go, denied, no token). Rejects only when the API
 * call itself failed (the caller retries later).
 *
 * `prompt: false` only checks the permission. Callers re-checking on every
 * foreground MUST pass it: the OS dialog itself backgrounds the app, and a
 * dismissed dialog leaves the permission "undetermined", so prompting on
 * each foreground loops the dialog forever (found on a fresh Android 15
 * install, M6-T5).
 */
export async function registerThisDevice(
  options: { prompt?: boolean } = {},
): Promise<boolean> {
  await ensureAndroidChannel();
  const permission =
    options.prompt === false
      ? await getPushPermission()
      : await ensurePushPermission();
  if (permission !== "granted") return false;
  let token: string;
  try {
    const result = await notifications().getDevicePushTokenAsync();
    token = typeof result.data === "string" ? result.data : "";
  } catch {
    return false;
  }
  if (!token) return false;
  await registerToken(token);
  return true;
}

/** Logout: `DELETE /devices/{token}` for the token this device registered. */
export async function unregisterThisDevice(): Promise<void> {
  const token = await rememberedToken();
  if (!token) return;
  try {
    await unregisterDevice(token);
  } finally {
    await rememberToken(null);
  }
}

/** FCM rotated the token: re-register it. */
export function onPushTokenChange(
  listener: (token: string) => void,
): () => void {
  if (!pushSupported()) return () => {};
  try {
    const subscription = notifications().addPushTokenListener((token) => {
      if (typeof token.data === "string" && token.data) listener(token.data);
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/**
 * A notification's data payload. Raw FCM messages on Android may carry it
 * on the trigger only (e.g. tapped from a killed app), so that is the fallback.
 */
function notificationData(
  notification: ExpoNotifications.Notification | null | undefined,
): unknown {
  const request = notification?.request;
  const data = request?.content?.data;
  if (data && typeof data === "object" && Object.keys(data).length > 0) {
    return data;
  }
  const remote = (
    request?.trigger as { remoteMessage?: { data?: unknown } } | null | undefined
  )?.remoteMessage;
  return remote?.data ?? data ?? null;
}

/** The data payload of a tapped notification. */
export function onNotificationTap(
  listener: (data: unknown) => void,
): () => void {
  try {
    const subscription =
      notifications().addNotificationResponseReceivedListener((response) =>
        listener(notificationData(response.notification)),
      );
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** A notification tapped while the app was closed (cold start), once. */
export async function takeLaunchTap(): Promise<unknown | null> {
  try {
    const response = await notifications().getLastNotificationResponseAsync();
    if (!response) return null;
    await notifications()
      .clearLastNotificationResponseAsync()
      .catch(() => {});
    return notificationData(response.notification);
  } catch {
    return null;
  }
}

/** A push arrived while the app is open (with its data payload). */
export function onNotificationReceived(
  listener: (data: unknown) => void,
): () => void {
  try {
    const subscription = notifications().addNotificationReceivedListener(
      (notification) => listener(notificationData(notification)),
    );
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/**
 * A foreground chat push for the thread already on screen (open-chat.ts):
 * the message is landing live there, so no banner/list entry/sound.
 */
export function isPushForOpenChat(data: unknown): boolean {
  if (AppState.currentState !== "active") return false;
  const openRideId = openChatRideId();
  if (!openRideId) return false;
  const { link, event } = parsePushPayload(data);
  const isChat = event === "chat.message" || link?.screen === "chat";
  return isChat && link?.params?.rideId === openRideId;
}

/**
 * Foreground pushes show as a banner (the center records them anyway) —
 * except a chat push for the chat screen that is open on that same ride.
 */
export function configureForegroundPresentation(): void {
  try {
    notifications().setNotificationHandler({
      handleNotification: async (notification) => {
        const show = !isPushForOpenChat(notificationData(notification));
        return {
          shouldShowBanner: show,
          shouldShowList: show,
          shouldPlaySound: false,
          shouldSetBadge: false,
        };
      },
    });
  } catch {
    // unsupported runtime
  }
}
