import AsyncStorage from '@react-native-async-storage/async-storage';
import { isRunningInExpoGo } from 'expo';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { registerDevice, unregisterDevice } from '../api/notifications';
import type { DevicePlatform } from '../api/realtime-types';

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

export const PUSH_TOKEN_STORAGE_KEY = 'labby-driver.push-token';

export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unsupported';

/** Remote push can work in this runtime (native build on Android/iOS). */
export function pushSupported(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    return !isRunningInExpoGo();
  } catch {
    return false;
  }
}

function toPermission(status: string | undefined, granted: boolean): PushPermission {
  if (granted) return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/** Current OS permission without prompting. */
export async function getPushPermission(): Promise<PushPermission> {
  if (!pushSupported()) return 'unsupported';
  try {
    const result = await Notifications.getPermissionsAsync();
    return toPermission(result.status, result.granted);
  } catch {
    return 'unsupported';
  }
}

/** Asks for permission when still undetermined (shows the OS prompt once). */
export async function ensurePushPermission(): Promise<PushPermission> {
  const current = await getPushPermission();
  if (current !== 'undetermined') return current;
  try {
    const result = await Notifications.requestPermissionsAsync();
    return toPermission(result.status, result.granted);
  } catch {
    return 'unsupported';
  }
}

function platform(): DevicePlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
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
  await registerDevice({ token, platform: platform(), app: 'driver' });
  await rememberToken(token);
}

/**
 * After login / on app start while signed in: permission → native token →
 * `PUT /devices`. Resolves true when registered, false when push is
 * unavailable here (Expo Go, denied, no token). Rejects only when the API
 * call itself failed (the caller retries later).
 */
export async function registerThisDevice(): Promise<boolean> {
  if ((await ensurePushPermission()) !== 'granted') return false;
  let token: string;
  try {
    const result = await Notifications.getDevicePushTokenAsync();
    token = typeof result.data === 'string' ? result.data : '';
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
export function onPushTokenChange(listener: (token: string) => void): () => void {
  if (!pushSupported()) return () => {};
  try {
    const subscription = Notifications.addPushTokenListener((token) => {
      if (typeof token.data === 'string' && token.data) listener(token.data);
    });
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** The data payload of a tapped notification. */
export function onNotificationTap(listener: (data: unknown) => void): () => void {
  try {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) =>
      listener(response.notification.request.content.data),
    );
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** A notification tapped while the app was closed (cold start), once. */
export async function takeLaunchTap(): Promise<unknown | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    await Notifications.clearLastNotificationResponseAsync().catch(() => {});
    return response.notification.request.content.data;
  } catch {
    return null;
  }
}

/** A push arrived while the app is open. */
export function onNotificationReceived(listener: () => void): () => void {
  try {
    const subscription = Notifications.addNotificationReceivedListener(() => listener());
    return () => subscription.remove();
  } catch {
    return () => {};
  }
}

/** Foreground pushes show as a banner (the center records them anyway). */
export function configureForegroundPresentation(): void {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // unsupported runtime
  }
}
