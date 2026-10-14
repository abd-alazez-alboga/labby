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

/** "Pickup → destination", from the places' labels (RTL-safe arrow via CSS order). */
export function routeLabel(
  pickup: { label?: string | null },
  destination: { label?: string | null },
  fallback: string,
): string {
  return `${pickup.label ?? fallback} → ${destination.label ?? fallback}`;
}
