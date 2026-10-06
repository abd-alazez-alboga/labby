/**
 * Push registration lifecycle (ES-03, realtime-v1.yaml `Devices`).
 *
 * - After sign-in (and on every signed-in launch, which also covers a token
 *   that rotated while the app was closed) the native FCM token is read with
 *   `getDevicePushTokenAsync` and sent with `PUT /api/v1/devices`
 *   (`app: 'rider'`). The registered token is remembered locally.
 * - When FCM rotates the token while the app runs, the new one is PUT again.
 * - On logout the remembered token is DELETEd while the session is still
 *   valid; the local record is always cleared.
 *
 * Registration is best-effort by design: a refused permission, an
 * unsupported runtime (Expo Go, see push-support.ts) or a network failure
 * never blocks the app — the center still records everything (NFR-A3).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { type DevicePlatform, registerDevice, unregisterDevice } from '../api/devices';
import { runExclusive } from '../permissions/permission-queue';
import { notifications } from './notifications-module';
import { isRemotePushSupported } from './push-support';

export const PUSH_TOKEN_KEY = 'labby.rider.pushToken';
export const ANDROID_CHANNEL_ID = 'default';

export type PushRegistrationResult =
  | 'registered'
  | 'unsupported'
  | 'permissionDenied'
  | 'failed';

async function readRegisteredToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function writeRegisteredToken(token: string | null): Promise<void> {
  try {
    if (token) await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    else await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  } catch {
    // best-effort
  }
}

function devicePlatform(): DevicePlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/** Android 13+ only shows the permission prompt once a channel exists. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await notifications().setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Labby',
    importance: notifications().AndroidImportance.HIGH,
  });
}

async function ensurePermission(): Promise<boolean> {
  const current = await notifications().getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  // Queued behind any other runtime prompt: fired alongside the location
  // prompt after sign-in, Android would otherwise drop one of them.
  const requested = await runExclusive(() => notifications().requestPermissionsAsync());
  return requested.granted;
}

/** Sends one token to the backend and remembers it. */
export async function registerToken(token: string): Promise<void> {
  await registerDevice(token, devicePlatform());
  await writeRegisteredToken(token);
}

/** Permission → native token → `PUT /api/v1/devices`. */
export async function registerForPush(): Promise<PushRegistrationResult> {
  if (!isRemotePushSupported()) return 'unsupported';
  try {
    await ensureAndroidChannel();
    if (!(await ensurePermission())) return 'permissionDenied';
    const { data } = await notifications().getDevicePushTokenAsync();
    if (typeof data !== 'string' || !data) return 'failed';
    await registerToken(data);
    return 'registered';
  } catch {
    return 'failed';
  }
}

/**
 * Follows FCM token rotation while signed in. Returns the unsubscribe
 * function (a no-op where push is unsupported).
 */
export function watchPushTokenRotation(): () => void {
  if (!isRemotePushSupported()) return () => {};
  const subscription = notifications().addPushTokenListener(({ data }) => {
    if (typeof data === 'string' && data) {
      registerToken(data).catch(() => {});
    }
  });
  return () => subscription.remove();
}

/**
 * Logout: unregister the remembered token while the session is still valid
 * (best-effort), then forget it locally.
 */
export async function unregisterPushToken(): Promise<void> {
  const token = await readRegisteredToken();
  if (!token) return;
  try {
    await unregisterDevice(token);
  } catch {
    // offline — the next login on this device re-assigns the token anyway
  }
  await writeRegisteredToken(null);
}

/** Session ended without a usable session (expiry, deletion): local only. */
export async function forgetPushToken(): Promise<void> {
  await writeRegisteredToken(null);
}
