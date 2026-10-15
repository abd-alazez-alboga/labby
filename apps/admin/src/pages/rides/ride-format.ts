import type { RideState } from '../../api/rides';
import type { ChipTone } from '../../ui';

/**
 * Ride display helpers shared by the rides search, the ride detail and the
 * live ops surfaces (UC-A-18/19/20).
 */

/** A short human ride reference ("R-1A2B3C4D") from the ride's UUID. */
export function rideRef(rideId: string): string {
  return `R-${rideId.slice(0, 8).toUpperCase()}`;
}

/** The status-chip tone per ride state (status colours live in chips only). */
export function rideStateTone(state: RideState): ChipTone {
  switch (state) {
    case 'completed':
      return 'success';
    case 'cancelled_by_rider':
    case 'cancelled_by_driver':
      return 'danger';
    case 'no_driver_found':
      return 'warning';
    case 'accepted':
    case 'driver_arrived':
    case 'in_progress':
      return 'accent';
    default:
      // requested / offering — still looking.
      return 'neutral';
  }
}

/**
 * "Pickup → destination", from the places' labels. The arrow follows the
 * reading direction (`←` in RTL, the DriverApplicationDetailPage pattern),
 * so it always points from the pickup to the destination.
 */
export function routeLabel(
  pickup: { label?: string | null },
  destination: { label?: string | null },
  fallback: string,
  dir: 'ltr' | 'rtl' = 'ltr',
): string {
  const arrow = dir === 'rtl' ? '←' : '→';
  return `${pickup.label ?? fallback} ${arrow} ${destination.label ?? fallback}`;
}

/**
 * The live map opened on one SOS alert (UC-A-20 click-throughs): the alert's
 * region, and the ride whose pin the map centres on (LiveOpsPage honours both).
 */
export function liveOpsLink(event: { regionId: string; rideId: string }): string {
  const params = new URLSearchParams({ region: event.regionId, ride: event.rideId });
  return `/live-ops?${params.toString()}`;
}
