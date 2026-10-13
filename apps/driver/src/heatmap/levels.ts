import type { TFunction } from "i18next";

import type { HeatmapZone } from "../api/heatmap";
import { polygonToLatLngs, ringCentroid } from "../map/geojson";
import type { BridgeZone } from "../map/leaflet-bridge";
import { colors } from "../theme/tokens";

/**
 * Heatmap level → look (owner-approved canvas "Demand heatmap", M9-T2).
 * Three purple strengths that also differ in lightness AND border style,
 * so they read apart without colour: level 1 "Busy" (light fill, dashed
 * border), level 2 "Very busy", level 3 and above "Highest" (strong fill,
 * solid accent border). Level 0 (no surge) is never drawn. One table for
 * the map polygons, their multiplier chips and the legend swatches.
 */

export type HeatTier = 1 | 2 | 3;
export const HEAT_TIERS: readonly HeatTier[] = [1, 2, 3];

export interface HeatTierStyle {
  /** Fill: the accent at this opacity. */
  fillOpacity: number;
  /** Border: the accent at this opacity, 2 px. */
  strokeOpacity: number;
  dashed: boolean;
  /** The multiplier chip on the zone. */
  chipBackground: string;
  chipText: string;
  /** i18n key of the legend label. */
  labelKey: string;
}

export const HEAT_TIER_STYLES: Record<HeatTier, HeatTierStyle> = {
  1: {
    fillOpacity: 0.12,
    strokeOpacity: 0.55,
    dashed: true,
    chipBackground: colors.surface,
    chipText: colors.textSecondary,
    labelKey: "heatmap.level.busy",
  },
  2: {
    fillOpacity: 0.28,
    strokeOpacity: 0.7,
    dashed: false,
    chipBackground: colors.surface,
    chipText: colors.accentPressed,
    labelKey: "heatmap.level.veryBusy",
  },
  3: {
    fillOpacity: 0.5,
    strokeOpacity: 1,
    dashed: false,
    chipBackground: colors.accent,
    chipText: colors.onAccent,
    labelKey: "heatmap.level.highest",
  },
};

/** The drawn tier of a level; null for level 0 (no surge — not drawn). */
export function tierOf(level: number): HeatTier | null {
  if (!Number.isFinite(level) || level < 1) return null;
  if (level >= 3) return 3;
  return level >= 2 ? 2 : 1;
}

/** `#RRGGBB` + alpha → `rgba(r,g,b,a)` (token colours only). */
export function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Western digits in BOTH languages (owner ruling 2026-10-11). */
function locale(language: string): string {
  return language === "ar" ? "ar-u-nu-latn" : "en-GB";
}

/** "1.5" / "2.0" — one decimal at least, two at most. */
function formatFactor(value: number, language: string): string {
  try {
    return new Intl.NumberFormat(locale(language), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return value.toFixed(1);
  }
}

/** "1.5×" — the plain label (the map chip sets `dir="ltr"` itself). */
export function formatMultiplier(
  t: TFunction,
  value: number,
  language: string,
): string {
  return t("heatmap.multiplier", { value: formatFactor(value, language) });
}

/** Left-to-right isolate: keeps "1.5×" in reading order inside Arabic text. */
export function isolateLtr(text: string): string {
  return `\u2066${text}\u2069`;
}

/** The zones that are drawn (level ≥ 1), with their tier. */
export function drawnZones(
  zones: HeatmapZone[],
): { zone: HeatmapZone; tier: HeatTier }[] {
  const drawn: { zone: HeatmapZone; tier: HeatTier }[] = [];
  for (const zone of zones) {
    const tier = tierOf(zone.level);
    if (tier) drawn.push({ zone, tier });
  }
  return drawn;
}

/**
 * The multiplier the legend shows for a tier: the zones' value, or the
 * range when zones of one tier carry different values (e.g. an override);
 * null when no zone is at that tier right now.
 */
export function tierMultiplierLabel(
  t: TFunction,
  zones: HeatmapZone[],
  tier: HeatTier,
  language: string,
): string | null {
  const values = drawnZones(zones)
    .filter((entry) => entry.tier === tier)
    .map((entry) => entry.zone.multiplier);
  if (values.length === 0) return null;
  const low = Math.min(...values);
  const high = Math.max(...values);
  if (low === high) return formatMultiplier(t, low, language);
  return t("heatmap.multiplierRange", {
    low: formatFactor(low, language),
    high: formatFactor(high, language),
  });
}

/**
 * The zones the map draws: level ≥ 1 only, the ring flipped to Leaflet
 * order, the multiplier chip at the ring's centroid.
 */
export function mapZones(
  t: TFunction,
  zones: HeatmapZone[],
  language: string,
): BridgeZone[] {
  const result: BridgeZone[] = [];
  for (const { zone, tier } of drawnZones(zones)) {
    const ring = polygonToLatLngs(zone.polygon);
    const labelAt = ringCentroid(ring);
    if (ring.length < 3 || !labelAt) continue;
    result.push({
      id: zone.id,
      ring,
      tier,
      label: formatMultiplier(t, zone.multiplier, language),
      labelAt,
    });
  }
  return result;
}
