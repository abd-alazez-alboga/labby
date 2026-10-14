import { postSos } from "../api/comms";
import type { LocationSample } from "../api/realtime-types";
import type { Place } from "../api/ride-types";

/**
 * SOS (UC-S-16, SAFE-01): the silent half fired alongside the OS dialer.
 * Fire-and-forget with exactly one retry — it must NEVER block or delay
 * the emergency call; a repeat tap creates a repeat event by design.
 */

/**
 * The position the event records: the latest own GPS fix. While online a
 * fix is virtually always present; the pickup is the honest last resort so
 * the alert is never dropped for want of coordinates (`recordedAt` stays
 * the device moment — the server clamps it).
 */
export function sosSample(
  position: LocationSample | null,
  pickup: Place,
): { lat: number; lng: number; recordedAt: string } {
  if (position) {
    return {
      lat: position.lat,
      lng: position.lng,
      recordedAt: position.recordedAt,
    };
  }
  return {
    lat: pickup.lat,
    lng: pickup.lng,
    recordedAt: new Date().toISOString(),
  };
}

/** Records the SOS event; swallows failure after one retry (never throws). */
export async function sendSosEvent(
  rideId: string,
  sample: { lat: number; lng: number; recordedAt: string },
): Promise<boolean> {
  try {
    await postSos(rideId, sample);
    return true;
  } catch {
    try {
      await postSos(rideId, sample);
      return true;
    } catch {
      // The dialer side already ran; support alerting lost this one event.
      return false;
    }
  }
}
