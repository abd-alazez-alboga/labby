/**
 * Single-flight foreground location permission request.
 *
 * The region resolver and the home map both need the permission on the same
 * screen at the same time. Funnelling them through one in-flight request
 * guarantees the OS shows at most one prompt and both get the same answer.
 */
import * as Location from "expo-location";

import { runExclusive } from "../permissions/permission-queue";

let inFlight: Promise<Location.LocationPermissionResponse> | null = null;

export function requestLocationPermission(): Promise<Location.LocationPermissionResponse> {
  if (!inFlight) {
    // Queued behind any other runtime prompt (Android shows one at a time).
    inFlight = runExclusive(() =>
      Location.requestForegroundPermissionsAsync(),
    ).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Reads the permission WITHOUT prompting — for foreground re-entry checks. Prompting there
 * loops the OS dialog: the dialog itself backgrounds the app, and a dismissed dialog leaves
 * the permission askable, so every return to the foreground would prompt again (M6-T5).
 */
export function readLocationPermission(): Promise<Location.LocationPermissionResponse> {
  return Location.getForegroundPermissionsAsync();
}
