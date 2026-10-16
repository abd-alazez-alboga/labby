import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, StyleSheet, View } from "react-native";

import { getDriverPerformance } from "../../api/trust";
import type {
  DriverPerformance,
  MetricWarning,
  MetricWindow,
  OwnRatingAggregate,
  Percentage,
  RatingRule,
  WindowDays,
} from "../../api/trust-types";
import { formatMoney } from "../../money/format";
import { useRemote } from "../../onboarding/use-remote";
import { useOptionalRegion } from "../../region/RegionProvider";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  countCopy,
  formatCount,
  formatPercent,
  formatRating,
  formatThreshold,
} from "../../trust/format";
import {
  AppText,
  FailureState,
  Icon,
  LoadingState,
  Muted,
  Screen,
  useDirection,
} from "../ui";

const WINDOWS: WindowDays[] = [7, 30];
/** The approved rating scale of the "Where you stand" bar. */
const SCALE_MIN = 1;
const SCALE_MAX = 5;
const NOT_APPROVED = [403] as const;

type Metric = "acceptance" | "cancellation" | "onTime";

const OF_KEYS: Record<Metric, string> = {
  acceptance: "trust.performance.acceptanceOf",
  cancellation: "trust.performance.cancellationOf",
  onTime: "trust.performance.onTimeOf",
};
const EMPTY_KEYS: Record<Metric, string> = {
  acceptance: "trust.performance.noOffers",
  cancellation: "trust.performance.noAccepted",
  onTime: "trust.performance.noPickups",
};

/** 7 days / 30 days segmented toggle (48 px touch targets). */
function WindowToggle({
  value,
  onChange,
}: {
  value: WindowDays;
  onChange: (next: WindowDays) => void;
}) {
  const { t } = useTranslation();
  const { flipRows, language } = useDirection();
  return (
    <View
      style={[styles.toggle, flipRows && styles.rowReverse]}
      accessibilityRole="tablist"
      accessibilityLabel={t("trust.performance.windowLabel")}
    >
      {WINDOWS.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[styles.toggleButton, selected && styles.toggleSelected]}
            testID={`performance-window-${option}`}
          >
            <AppText
              variant="caption"
              weight={selected ? "800" : "700"}
              color={selected ? colors.text : colors.textSecondary}
              align="center"
            >
              {t(`trust.performance.days.${option}`, {
                value: formatCount(option, language),
              })}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/** One active DRV-07 warning with the rule that raised it — never a suspension. */
function WarningCard({ warning }: { warning: MetricWarning }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const values = {
    threshold: formatPercent(warning.thresholdPercent, language),
    value: formatPercent(warning.valuePercent, language),
    sample: formatCount(warning.sampleSize, language),
    days: formatCount(warning.windowDays, language),
  };
  return (
    <View style={styles.warning} testID={`performance-warning-${warning.metric}`}>
      <View style={[styles.warningHead, flipRows && styles.rowReverse]}>
        <Icon name="warning-outline" size={18} color={colors.warning} />
        <AppText variant="bodyStrong" weight="800" color={colors.warning} style={styles.grow}>
          {t(`trust.performance.warning.${warning.metric}Title`, values)}
        </AppText>
      </View>
      <AppText variant="caption" weight="400" color={colors.warning}>
        {t(`trust.performance.warning.${warning.metric}Body`, values)}
      </AppText>
    </View>
  );
}

function percentTile(
  t: (key: string, options?: Record<string, unknown>) => string,
  metric: Metric,
  value: Percentage,
  language: string,
): { big: string; small: string } {
  if (value.percent === null || value.percent === undefined || value.denominator === 0) {
    return { big: "—", small: t(EMPTY_KEYS[metric]) };
  }
  return {
    big: formatPercent(value.percent, language),
    small: t(OF_KEYS[metric], {
      n: formatCount(value.numerator, language),
      d: formatCount(value.denominator, language),
    }),
  };
}

function Tile({
  label,
  big,
  small,
  warned,
  testID,
}: {
  label: string;
  big: string;
  small: string | null;
  warned?: boolean;
  testID: string;
}) {
  return (
    <View style={[styles.tile, warned && styles.tileWarned]} testID={testID}>
      <AppText variant="caption" weight="700" color={colors.textSecondary}>
        {label}
      </AppText>
      <AppText style={styles.tileValue} testID={`${testID}-value`}>
        {big}
      </AppText>
      {small ? (
        <AppText variant="caption" weight="400" color={colors.textMuted} testID={`${testID}-detail`}>
          {small}
        </AppText>
      ) : null}
    </View>
  );
}

/** The four metric tiles of the chosen window. */
function Tiles({
  window,
  warnings,
}: {
  window: MetricWindow;
  warnings: MetricWarning[];
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const warned = new Set(warnings.map((warning) => warning.metric));
  const acceptance = percentTile(t, "acceptance", window.acceptance, language);
  const cancellation = percentTile(t, "cancellation", window.cancellation, language);
  const onTime = percentTile(t, "onTime", window.onTime, language);
  const earned = window.earnings
    .map((money) => formatMoney(money.amount, money.currency, language))
    .join(" · ");
  return (
    <View style={styles.grid} testID="performance-tiles">
      <View style={[styles.gridRow, flipRows && styles.rowReverse]}>
        <Tile
          label={t("trust.performance.acceptance")}
          {...acceptance}
          warned={warned.has("acceptance")}
          testID="tile-acceptance"
        />
        <Tile
          label={t("trust.performance.cancellation")}
          {...cancellation}
          warned={warned.has("cancellation")}
          testID="tile-cancellation"
        />
      </View>
      <View style={[styles.gridRow, flipRows && styles.rowReverse]}>
        <Tile label={t("trust.performance.onTime")} {...onTime} testID="tile-on-time" />
        <Tile
          label={t("trust.performance.trips")}
          big={formatCount(window.trips, language)}
          small={
            earned
              ? t("trust.performance.earned", { amount: earned })
              : t("trust.performance.noEarnings")
          }
          testID="tile-trips"
        />
      </View>
    </View>
  );
}

/** The LIFETIME snapshot average (never per window) — RATE-02. */
function RatingCard({
  rating,
  large,
}: {
  rating: OwnRatingAggregate;
  large?: boolean;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const average = rating.average;
  return (
    <View style={[styles.ratingCard, flipRows && styles.rowReverse]} testID="performance-rating">
      <Icon name="star" size={large ? 32 : 28} color={colors.accent} />
      <View style={styles.grow}>
        <AppText style={large ? styles.ratingLarge : styles.ratingValue}>
          <AppText style={large ? styles.ratingLarge : styles.ratingValue} testID="performance-rating-value">
            {average !== null && average !== undefined
              ? formatRating(average, language)
              : "—"}
          </AppText>
          {" "}
          <AppText variant="secondary" weight="700" color={colors.textSecondary}>
            {t("trust.performance.averageLabel")}
          </AppText>
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted} testID="performance-rating-meta">
          {average !== null && average !== undefined
            ? t("trust.performance.ratingMeta", {
                count: countCopy(t, "trust.performance.ratingCount", rating.ratingCount, language),
              })
            : t("trust.performance.ratingNone")}
        </AppText>
      </View>
    </View>
  );
}

/** UC-D-20 A1: the explicit warning with the exact suspension rule. */
function RatingWarning({
  average,
  rule,
}: {
  average: number;
  rule: RatingRule;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const region = useOptionalRegion();
  const regionName =
    region?.status === "resolved" ? region.config?.name ?? null : null;
  const values = {
    average: formatRating(average, language),
    min: formatThreshold(rule.minAvgRating, language),
    count: formatCount(rule.minRatedRides, language),
    region: regionName,
  };
  return (
    <View style={[styles.warning, styles.ratingWarning]} testID="performance-rating-warning">
      <View style={[styles.warningHead, flipRows && styles.rowReverse]}>
        <Icon name="warning-outline" size={18} color={colors.warning} />
        <AppText variant="bodyStrong" weight="800" color={colors.warning} style={styles.grow}>
          {t("trust.performance.ratingWarning.title")}
        </AppText>
      </View>
      <AppText variant="secondary" color={colors.warning} testID="performance-rating-rule">
        {t(
          regionName
            ? "trust.performance.ratingWarning.body"
            : "trust.performance.ratingWarning.bodyNoRegion",
          values,
        )}
      </AppText>
      <AppText variant="caption" weight="400" color={colors.warning}>
        {t("trust.performance.ratingWarning.tips")}
      </AppText>
    </View>
  );
}

/** "Where you stand": 1.0 … 5.0 scale, the suspension zone and the average. */
function StandingBar({ average, rule }: { average: number; rule: RatingRule }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const span = SCALE_MAX - SCALE_MIN;
  const fraction = (value: number) =>
    Math.min(1, Math.max(0, (value - SCALE_MIN) / span));
  const start = flipRows ? "right" : "left";
  return (
    <View style={styles.standing} testID="performance-standing">
      <AppText variant="caption" weight="700" color={colors.textSecondary}>
        {t("trust.performance.ratingWarning.whereYouStand")}
      </AppText>
      <View style={styles.bar}>
        <View
          style={[
            styles.barZone,
            { [start]: 0, width: `${fraction(rule.minAvgRating) * 100}%` },
          ]}
        />
        <View
          style={[
            styles.barMarker,
            { [start]: `${fraction(average) * 100}%` },
          ]}
          testID="performance-standing-marker"
        />
      </View>
      <View style={[styles.scale, flipRows && styles.rowReverse]}>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {formatThreshold(SCALE_MIN, language)}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {t("trust.performance.ratingWarning.limit", {
            min: formatThreshold(rule.minAvgRating, language),
          })}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {formatThreshold(SCALE_MAX, language)}
        </AppText>
      </View>
    </View>
  );
}

function Dashboard({ data }: { data: DriverPerformance }) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const [days, setDays] = useState<WindowDays>(30);
  const window =
    data.windows.find((entry) => entry.days === days) ?? data.windows[0];
  const average = data.rating.average;
  const nearLimit =
    data.ratingWarning &&
    !!data.ratingRule &&
    average !== null &&
    average !== undefined;

  return (
    <>
      <View style={[styles.titleRow, flipRows && styles.rowReverse]}>
        <AppText variant="display" accessibilityRole="header" testID="performance-title">
          {t("trust.performance.title")}
        </AppText>
        <WindowToggle value={days} onChange={setDays} />
      </View>

      {nearLimit && data.ratingRule ? (
        <>
          <RatingWarning average={average} rule={data.ratingRule} />
          <RatingCard rating={data.rating} large />
          <StandingBar average={average} rule={data.ratingRule} />
        </>
      ) : null}

      {data.warnings.map((warning) => (
        <WarningCard key={warning.metric} warning={warning} />
      ))}

      {window ? <Tiles window={window} warnings={data.warnings} /> : null}

      {nearLimit ? null : <RatingCard rating={data.rating} />}

      <AppText variant="caption" weight="400" color={colors.textMuted} testID="performance-on-time-note">
        {t("trust.performance.onTimeNote")}
      </AppText>
    </>
  );
}

/**
 * UC-D-20 — the performance dashboard (artboards "Driver Performance" /
 * "Driver Performance AR" / "Driver Rating warning"): the 7 / 30-day
 * toggle, active metric warnings with the rule that raised them (warnings
 * never suspend), the acceptance / cancellation / on-time / trips tiles of
 * the window, the LIFETIME snapshot rating, the rating-near-limit variant
 * with the exact suspension rule, and the on-time definition.
 */
export function PerformanceScreen() {
  const { t } = useTranslation();
  const { state, refreshing, reload } = useRemote(getDriverPerformance, NOT_APPROVED);
  return (
    <Screen
      testID="performance-screen"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
      }
    >
      {state.status === "loading" ? (
        <>
          <AppText variant="display" accessibilityRole="header">
            {t("trust.performance.title")}
          </AppText>
          <LoadingState testID="performance-loading" />
        </>
      ) : null}
      {state.status === "error" ? (
        <>
          <AppText variant="display" accessibilityRole="header">
            {t("trust.performance.title")}
          </AppText>
          <FailureState
            kind={state.kind}
            onRetry={() => void reload()}
            testID="performance-error"
          />
        </>
      ) : null}
      {state.status === "absent" ? (
        <>
          <AppText variant="display" accessibilityRole="header">
            {t("trust.performance.title")}
          </AppText>
          <Muted testID="performance-unavailable">
            {t("trust.performance.unavailable")}
          </Muted>
        </>
      ) : null}
      {state.status === "loaded" ? <Dashboard data={state.data} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.ms,
    flexWrap: "wrap",
  },
  toggle: {
    flexDirection: "row",
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    padding: spacing.xs,
  },
  toggleButton: {
    minHeight: 48,
    minWidth: 64,
    paddingHorizontal: spacing.ms,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  toggleSelected: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 1,
  },
  warning: {
    gap: 6,
    backgroundColor: colors.warningBg,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  ratingWarning: { gap: 10, padding: spacing.md },
  warningHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grid: { gap: 10 },
  gridRow: { flexDirection: "row", gap: 10 },
  tile: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 2,
  },
  tileWarned: { borderWidth: 2, borderColor: colors.warning },
  tileValue: { fontSize: 30, lineHeight: 36, fontWeight: "800" },
  ratingCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  ratingValue: { fontSize: 20, lineHeight: 26, fontWeight: "800" },
  ratingLarge: { fontSize: 22, lineHeight: 28, fontWeight: "800" },
  standing: { gap: spacing.xs },
  bar: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceFill,
    marginTop: 6,
  },
  barZone: {
    position: "absolute",
    top: 0,
    bottom: 0,
    borderRadius: 6,
    backgroundColor: colors.warning,
    opacity: 0.35,
  },
  barMarker: {
    position: "absolute",
    top: -6,
    width: 4,
    height: 24,
    marginHorizontal: -2,
    borderRadius: 2,
    backgroundColor: colors.text,
  },
  scale: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: spacing.xs,
  },
});
