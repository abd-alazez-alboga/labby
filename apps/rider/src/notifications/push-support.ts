/**
 * Whether this runtime can receive remote push at all.
 *
 * Remote push needs the native FCM/APNs setup of a development or store
 * build (Firebase app configs arrive in M6-T5). Expo Go cannot receive it —
 * on Android it even throws — and the rider app has no web push. In those
 * runtimes registration is skipped silently; the notification center keeps
 * working (it is server-side, NTF-03).
 */
import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

export function isRemotePushSupported(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  try {
    return !isRunningInExpoGo();
  } catch {
    return false;
  }
}
