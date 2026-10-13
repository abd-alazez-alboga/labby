import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type { Heatmap } from "../../api/heatmap";
import {
  drawnZones,
  HEAT_TIER_STYLES,
  HEAT_TIERS,
  isolateLtr,
  tierMultiplierLabel,
  withAlpha,
} from "../../heatmap/levels";
import type { HeatTier } from "../../heatmap/levels";
import type { HeatmapContextValue } from "../../heatmap/HeatmapProvider";
import { useLocale } from "../../i18n/LocaleProvider";
import { formatTime } from "../../rides/format";
import { colors, spacing } from "../../theme/tokens";
import { AppText, MapFab, useDirection } from "../ui";

/**
 * The heatmap's on/off toggle (canvas "Demand heatmap": the layers FAB,
 * top-right, accent while on). Only while the driver is online.
 */
export function HeatmapToggle({ ctx }: { ctx: HeatmapContextValue | null }) {
  const { t } = useTranslation();
  if (!ctx?.online) return null;
  return (
    <MapFab
      icon={ctx.enabled ? "layers" : "layers-outline"}
      accessibilityLabel={t(ctx.enabled ? "heatmap.hide" : "heatmap.show")}
      selected={ctx.enabled}
      onPress={ctx.toggle}
      testID="heatmap-toggle"
    />
  );
}

/** "Updated 12:40 · next update 12:42" (each part only when known). */
function updatedLine(
  t: ReturnType<typeof useTranslation>["t"],
  heatmap: Heatmap,
  language: string,
): string | null {
  const updated = heatmap.computedAt
    ? formatTime(heatmap.computedAt, language)
    : null;
  const next = heatmap.nextCycleAt
    ? formatTime(heatmap.nextCycleAt, language)
    : null;
  if (updated && next) return t("heatmap.updatedNext", { updated, next });
  if (updated) return t("heatmap.updated", { updated });
  if (next) return t("heatmap.nextUpdate", { next });
  return null;
}

/** One legend chip: the tier's swatch, its label and (when present) multiplier. */
function LegendChip({
  tier,
  multiplier,
}: {
  tier: HeatTier;
  multiplier: string | null;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const look = HEAT_TIER_STYLES[tier];
  return (
    <View
      style={[styles.chip, flipRows && styles.rowReverse]}
      testID={`heatmap-legend-${tier}`}
    >
      <View
        style={[
          styles.swatch,
          {
            backgroundColor: withAlpha(colors.accent, look.fillOpacity),
            borderColor: withAlpha(colors.accent, look.strokeOpacity),
            borderStyle: look.dashed ? "dashed" : "solid",
          },
        ]}
        testID={`heatmap-swatch-${tier}`}
      />
      <AppText variant="caption" weight="700">
        {t(look.labelKey)}
        {multiplier ? ` ${isolateLtr(multiplier)}` : ""}
      </AppText>
    </View>
  );
}

/**
 * "Demand near you" (UC-D-14) in the home sheet while the heatmap is on:
 * when it was computed and when it refreshes, the three-level legend with
 * the live multipliers, and what the shading means. Moving is the
 * driver's choice — the copy says so.
 */
export function HeatmapSheetSection({
  heatmap,
  regionName,
}: {
  heatmap: Heatmap;
  regionName?: string | null;
}) {
  const { t } = useTranslation();
  const { language } = useLocale();
  const { flipRows } = useDirection();
  const updated = updatedLine(t, heatmap, language);
  const anyDrawn = drawnZones(heatmap.zones).length > 0;
  return (
    <View style={styles.group} testID="heatmap-sheet">
      <View style={[styles.header, flipRows && styles.rowReverse]}>
        <View style={styles.headerText}>
          <AppText variant="heading">{t("heatmap.title")}</AppText>
          {updated ? (
            <AppText
              variant="caption"
              weight="400"
              color={colors.textSecondary}
              testID="heatmap-updated"
            >
              {updated}
            </AppText>
          ) : null}
        </View>
        {regionName ? (
          <AppText
            variant="caption"
            weight="700"
            color={colors.textMuted}
            testID="heatmap-region"
          >
            {regionName}
          </AppText>
        ) : null}
      </View>
      <View
        style={[styles.legend, flipRows && styles.rowReverse]}
        testID="heatmap-legend"
      >
        {HEAT_TIERS.map((tier) => (
          <LegendChip
            key={tier}
            tier={tier}
            multiplier={tierMultiplierLabel(t, heatmap.zones, tier, language)}
          />
        ))}
      </View>
      {!anyDrawn ? (
        <AppText
          variant="caption"
          weight="600"
          color={colors.textSecondary}
          testID="heatmap-calm"
        >
          {t("heatmap.calm")}
        </AppText>
      ) : null}
      <AppText
        variant="caption"
        weight="400"
        color={colors.textMuted}
        style={styles.explain}
      >
        {t("heatmap.explain")}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: 14 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.ms,
  },
  headerText: { flex: 1, gap: 2 },
  rowReverse: { flexDirection: "row-reverse" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 36,
    paddingHorizontal: spacing.ms,
    borderRadius: 18,
    backgroundColor: colors.surfaceFill,
  },
  swatch: { width: 16, height: 16, borderRadius: 4, borderWidth: 2 },
  explain: { lineHeight: 20 },
});
