import * as TaskManager from "expo-task-manager";

import type { GpsFix } from "./protocol";

/**
 * The background GPS task (M6-X2, TRK-01 "whenever online"). Android runs it
 * under a location foreground service while the driver is online, so fixes
 * keep arriving with the app in the background or the screen off. A task
 * must be defined at module load — before React mounts — so the root layout
 * imports this module for its side effect.
 *
 * The task only forwards fixes: whoever started the updates (the background
 * location source) registered a listener, which is the streamer's `onFix`.
 */
export const BACKGROUND_LOCATION_TASK = "labby-driver-background-location";

type FixListener = (fix: GpsFix) => void;

let listener: FixListener | null = null;

/** Registers (or clears, with null) where the task's fixes go. */
export function setBackgroundFixListener(next: FixListener | null): void {
  listener = next;
}

/**
 * Hands a task payload's fixes to the listener, oldest first (Android may
 * batch several fixes into one delivery while the app is in the background).
 * Exported for tests.
 */
export function deliverBackgroundLocations(data: unknown): void {
  const locations = (data as { locations?: unknown } | null)?.locations;
  if (!listener || !Array.isArray(locations)) return;
  [...(locations as GpsFix[])]
    .filter((fix) => typeof fix?.timestamp === "number" && fix.coords != null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach((fix) => listener?.(fix));
}

if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) return; // A failed delivery: the next one (≤ one interval later) retries naturally.
    deliverBackgroundLocations(data);
  });
}
