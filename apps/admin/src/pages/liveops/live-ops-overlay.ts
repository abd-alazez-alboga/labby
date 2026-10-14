import type { LiveOpsSurgeZone } from '../../api/comms';
import type { SurgeOverlayZone } from '../surge';

/**
 * The live-ops snapshot's surge zones in the M9 surge facade's overlay shape
 * (SurgeOverlayZone), so the live map renders the SAME zone overlay the surge
 * slice defines — tint strength from the backend `level`, label from the
 * multiplier. The feed serves only multiplier + level (no caps or overrides:
 * those need pricing:view, the live map only rides:view), so `band` is
 * surging/none and `strength` is scaled by level against the usual
 * three-step ladder, saturating at step 3.
 */

/** The level treated as full strength (the standard 3-step threshold ladder). */
export const FULL_STRENGTH_LEVEL = 3;

export function toLiveOpsOverlay(zones: readonly LiveOpsSurgeZone[]): SurgeOverlayZone[] {
  return zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    polygon: zone.polygon,
    multiplier: zone.multiplier,
    level: zone.level,
    band: zone.level > 0 && zone.multiplier > 1 ? 'surging' : 'none',
    strength:
      zone.level <= 0 || zone.multiplier <= 1 ? 0 : Math.min(1, zone.level / FULL_STRENGTH_LEVEL),
    overridden: false,
    pending: false,
  }));
}
