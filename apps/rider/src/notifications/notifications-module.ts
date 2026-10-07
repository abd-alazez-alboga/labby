import type * as ExpoNotifications from "expo-notifications";

import { isRemotePushSupported } from "./push-support";

/**
 * expo-notifications, loaded lazily. A static import crashes Expo Go on
 * Android at import time (remote push was removed from Expo Go in SDK 53),
 * so the module is only required in runtimes that support remote push.
 * Throws when unavailable — every caller treats that as "unsupported".
 */
let loadedNotifications: typeof ExpoNotifications | null = null;
export function notifications(): typeof ExpoNotifications {
  if (loadedNotifications) return loadedNotifications;
  if (!isRemotePushSupported()) {
    throw new Error("expo-notifications is unavailable in this runtime");
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require("expo-notifications") as typeof ExpoNotifications;
  loadedNotifications = loaded;
  return loaded;
}
