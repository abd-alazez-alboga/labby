import type { GeoJsonPolygon, SurgeState } from '../../api/regions';

/** How hard a zone is surging, for chips now and the M10 live-ops map tint. */
export type SurgeLevel = 'none' | 'surging' | 'max';

/**
 * One zone of the surge overlay — the shape the M10 live operations map
 * consumes (UC-A-09 "override state visible on the live map"). Built from
 * the same surge-state the zone list shows, so map and list never disagree.
 */
export interface SurgeOverlayZone {
  id: string;
  name: string;
  /** GeoJSON, [lng, lat] rings. */
  polygon: GeoJsonPolygon;
  /** What pricing reads now. */
  multiplier: number;
  level: SurgeLevel;
  /** 0 (no surge) … 1 (at the cap); a fill-opacity-ready strength. */
  strength: number;
  /** A manual override is set (applied or pending). */
  overridden: boolean;
  /** An override change lands at the next cycle. */
  pending: boolean;
}

export function surgeLevel(multiplier: number, cap: number | null): SurgeLevel {
  if (multiplier <= 1) {
    return 'none';
  }
  return cap !== null && multiplier >= cap ? 'max' : 'surging';
}

export function surgeStrength(multiplier: number, cap: number | null): number {
  if (multiplier <= 1) {
    return 0;
  }
  if (cap === null || cap <= 1) {
    return 1;
  }
  return Math.min(1, (multiplier - 1) / (cap - 1));
}

/** The overlay for a region's surge state, scaled against the region cap. */
export function toSurgeOverlay(state: SurgeState): SurgeOverlayZone[] {
  return state.zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    polygon: zone.polygon,
    multiplier: zone.currentMultiplier,
    level: surgeLevel(zone.currentMultiplier, state.surgeCap),
    strength: surgeStrength(zone.currentMultiplier, state.surgeCap),
    overridden: zone.overrideMultiplier !== null,
    pending: zone.overridePending,
  }));
}
