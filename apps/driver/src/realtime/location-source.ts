import * as Location from "expo-location";

import type { GpsFix } from "./protocol";

/**
 * Where GPS fixes come from while the driver is online. The streamer only
 * depends on this interface, so a BACKGROUND source can replace the
 * foreground one without touching the protocol code.
 *
 * V1 (M6-T4) ships the FOREGROUND source only: `watchPositionAsync` runs
 * while the app is open. Background tracking per platform rules needs
 * `Location.startLocationUpdatesAsync` + an `expo-task-manager` task, the
 * `ACCESS_BACKGROUND_LOCATION` / "Always" permission (iOS
 * `UIBackgroundModes: location`, an Android foreground-service notice) —
 * all of which require a native dev build (not Expo Go). A background
 * source would push fixes from the task into the same `onFix` callback.
 */
export interface LocationSource {
  /** Starts delivering fixes; resolves a stop function. Rejects when GPS can't start. */
  start(onFix: (fix: GpsFix) => void): Promise<() => void>;
}

/**
 * Foreground watch tuned to the stream cadence: high accuracy, a fix at
 * most every `intervalSeconds` (Android honors it; iOS delivers on its own
 * schedule and the streamer still sends only once per interval), and no
 * distance filter so a waiting (stationary) driver keeps producing fresh fixes.
 */
export function foregroundLocationSource(
  intervalSeconds: number,
): LocationSource {
  return {
    async start(onFix) {
      const subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: intervalSeconds * 1000,
          distanceInterval: 0,
        },
        (position) => onFix(position),
      );
      return () => subscription.remove();
    },
  };
}
