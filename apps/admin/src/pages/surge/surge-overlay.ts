import type { GeoJsonPolygon, SurgeState, SurgeZoneState } from '../../api/regions';

/** How hard a zone is surging, for chips now and the M10 live-ops map tint. */
export type SurgeBand = 'none' | 'surging' | 'max';

/**
 * One zone of the surge overlay — the shape the M10 live operations map
 * consumes (UC-A-09 "override state visible on the live map"). Built from
 * the same surge-state the zone list shows, with the backend's `level` and
 * effective cap, so map, list and the driver heatmap never disagree.
 */
export interface SurgeOverlayZone {
  id: string;
  name: string;
  /** GeoJSON, [lng, lat] rings. */
  polygon: GeoJsonPolygon;
  /** What pricing reads now. */
  multiplier: number;
  /** The backend level: 0 = no surge; n = the n-th threshold step (the driver heatmap's scale). */
  level: number;
  band: SurgeBand;
  /** 0 (no surge) … 1 (at the effective cap); a fill-opacity-ready strength. */
  strength: number;
  /** A manual override is set (applied or pending). */
  overridden: boolean;
  /** An override change lands at the next cycle. */
  pending: boolean;
}

type ZoneLevel = Pick<SurgeZoneState, 'currentMultiplier' | 'level' | 'effectiveCap'>;

/** None at level 0, max at the zone's effective cap (zone or region), else surging. */
export function surgeBand(zone: ZoneLevel): SurgeBand {
  if (zone.level <= 0 || zone.currentMultiplier <= 1) {
    return 'none';
  }
  return zone.effectiveCap !== null && zone.currentMultiplier >= zone.effectiveCap
    ? 'max'
    : 'surging';
}

/** 0 … 1 against the zone's effective cap (1 when uncapped and surging). */
export function surgeStrength(zone: ZoneLevel): number {
  if (surgeBand(zone) === 'none') {
    return 0;
  }
  const cap = zone.effectiveCap;
  if (cap === null || cap <= 1) {
    return 1;
  }
  return Math.min(1, (zone.currentMultiplier - 1) / (cap - 1));
}

/** The overlay for a region's surge state, scaled against each zone's effective cap. */
export function toSurgeOverlay(state: SurgeState): SurgeOverlayZone[] {
  return state.zones.map((zone) => ({
    id: zone.id,
    name: zone.name,
    polygon: zone.polygon,
    multiplier: zone.currentMultiplier,
    level: zone.level,
    band: surgeBand(zone),
    strength: surgeStrength(zone),
    overridden: zone.overrideMultiplier !== null,
    pending: zone.overridePending,
  }));
}
