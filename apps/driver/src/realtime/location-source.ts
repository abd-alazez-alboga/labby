import Constants, { ExecutionEnvironment } from "expo-constants";
import { t } from "i18next";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { runExclusive } from "../permissions/permission-queue";
import { colors } from "../theme/tokens";

import {
  BACKGROUND_LOCATION_TASK,
  setBackgroundFixListener,
} from "./background-location-task";
import type { GpsFix } from "./protocol";

/**
 * Where GPS fixes come from while the driver is online. The streamer only
 * depends on this interface, so the BACKGROUND source (M6-X2) replaces the
 * foreground one without touching the protocol code.
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
 * Fixes stop when the app leaves the foreground.
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

/**
 * Background updates through the `expo-task-manager` task (M6-X2): fixes keep
 * coming with the app in the background or the screen off. Android runs them
 * under a location foreground service whose ongoing notification tells the
 * driver they are online (owner-approved copy, EN + AR); iOS shows its
 * background-location indicator. Needs a native dev build and the
 * background ("Allow all the time") permission — see driverLocationSource.
 */
export function backgroundLocationSource(
  intervalSeconds: number,
): LocationSource {
  return {
    async start(onFix) {
      setBackgroundFixListener(onFix);
      try {
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: intervalSeconds * 1000,
          distanceInterval: 0,
          deferredUpdatesInterval: intervalSeconds * 1000,
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: t("backgroundLocation.noticeTitle"),
            notificationBody: t("backgroundLocation.noticeBody"),
            notificationColor: colors.accent,
          },
        });
      } catch (error) {
        setBackgroundFixListener(null);
        throw error;
      }
      return () => {
        setBackgroundFixListener(null);
        Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
          .then((started) =>
            started
              ? Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)
              : undefined,
          )
          .catch(() => {
            // Already stopped (e.g. the OS killed the service) — nothing to do.
          });
      };
    },
  };
}

/**
 * Why the driver streams in the background or not, for the online banner:
 * `active` background streaming; `denied` the driver refused "Allow all the
 * time" (owner decision 2026-10-08: they may stay online foreground-only and
 * see a persistent warning with a settings button); `unsupported` Expo Go or
 * no task manager (development only — no warning); `idle` not streaming.
 */
export type BackgroundLocationStatus =
  | "idle"
  | "active"
  | "denied"
  | "unsupported";

let status: BackgroundLocationStatus = "idle";
const statusListeners = new Set<(next: BackgroundLocationStatus) => void>();

export function getBackgroundLocationStatus(): BackgroundLocationStatus {
  return status;
}

export function subscribeBackgroundLocationStatus(
  listener: (next: BackgroundLocationStatus) => void,
): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(next: BackgroundLocationStatus): void {
  if (status === next) return;
  status = next;
  statusListeners.forEach((listener) => listener(next));
}

async function backgroundSupported(): Promise<boolean> {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return false; // Expo Go cannot run background location tasks.
  }
  try {
    return await TaskManager.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Asks for "Allow all the time" through the shared permission queue. */
async function backgroundPermissionGranted(): Promise<boolean> {
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.granted) return true;
    if (current.canAskAgain === false) return false;
    const asked = await runExclusive(() =>
      Location.requestBackgroundPermissionsAsync(),
    );
    return asked.granted;
  } catch {
    return false;
  }
}

/**
 * The source the driver app streams with while online (TRK-01): background
 * when the build supports it and the driver allowed "all the time",
 * otherwise the foreground watch (Expo Go, refusal, or a background start
 * failure). The foreground permission is already granted by the online flow
 * before this runs.
 */
export function driverLocationSource(intervalSeconds: number): LocationSource {
  return {
    async start(onFix) {
      if (!(await backgroundSupported())) {
        setStatus("unsupported");
        return withIdleOnStop(
          await foregroundLocationSource(intervalSeconds).start(onFix),
        );
      }
      if (await backgroundPermissionGranted()) {
        try {
          const stop = await backgroundLocationSource(intervalSeconds).start(
            onFix,
          );
          setStatus("active");
          return withIdleOnStop(stop);
        } catch {
          // e.g. the OS refused the foreground service: fall back below.
        }
      }
      setStatus("denied");
      return withIdleOnStop(
        await foregroundLocationSource(intervalSeconds).start(onFix),
      );
    },
  };
}

function withIdleOnStop(stop: () => void): () => void {
  return () => {
    stop();
    setStatus("idle");
  };
}
