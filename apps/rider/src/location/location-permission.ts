/**
 * Single-flight foreground location permission request.
 *
 * The region resolver and the home map both need the permission on the same
 * screen at the same time. Funnelling them through one in-flight request
 * guarantees the OS shows at most one prompt and both get the same answer.
 */
import * as Location from 'expo-location';

let inFlight: Promise<Location.LocationPermissionResponse> | null = null;

export function requestLocationPermission(): Promise<Location.LocationPermissionResponse> {
  if (!inFlight) {
    inFlight = Location.requestForegroundPermissionsAsync().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
