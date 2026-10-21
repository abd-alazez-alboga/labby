import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";

import { getIncentives } from "../../api/incentives";
import type {
  IncentiveAward,
  IncentiveProgress,
  IncentiveTier,
  PeakProgress,
  RatingProgress,
  WeeklyTripsProgress,
} from "../../api/incentives-types";
import {
  addDays,
  clockTime,
  dateInZone,
  daysLabel,
  formatCalendarDay,
  weekRange,
  windowTimes,
} from "../../incentives/format";
import {
  formatMoney,
  formatSignedMoney,
  isolateDigits,
} from "../../money/format";
import { useRemote } from "../../onboarding/use-remote";
import { useOptionalRegion } from "../../region/RegionProvider";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  countCopy,
  formatCount,
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

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The board's 10 px progress bar on the accent tint, with an optional
 * marker (the next tier) — both follow the reading direction. `label` is
 * what a screen reader announces ("26 of 60 trips").
 */
function TierBar({
  fraction,
  label,
  marker,
  testID,
}: {
  fraction: number;
  label: string;
  marker?: number | null;
  testID?: string;
}) {
  const { flipRows } = useDirection();
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const percent = Math.round(clamp(fraction) * 100);
  const markerAt =
    marker != null ? (`${Math.round(clamp(marker) * 100)}%` as const) : null;
  return (
    <View
      style={[styles.bar, flipRows && styles.rowReverse]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      testID={testID}
    >
      <View style={[styles.barFill, { width: `${percent}%` }]} />
      {markerAt ? (
        <View
          style={[
            styles.marker,
            flipRows ? { end: markerAt } : { start: markerAt },
          ]}
          testID={testID ? `${testID}-marker` : undefined}
        />
      ) : null}
    </View>
  );
}

/** Card head: title + one-line rule on the start side, the value chip opposite. */
function CardHead({
  title,
  subtitle,
  chip,
  testID,
}: {
  title: string;
  subtitle: string;
  chip: string;
  testID: string;
}) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.cardHead, flipRows && styles.rowReverse]}>
      <View style={styles.grow}>
        <AppText variant="rowTitle" weight="800">
          {title}
        </AppText>
        <AppText variant="caption" weight="400" color={colors.textMuted}>
          {subtitle}
        </AppText>
      </View>
      <View style={styles.valueChip}>
        <AppText
          variant="caption"
          weight="800"
          color={colors.accentPressed}
          testID={`${testID}-chip`}
        >
          {chip}
        </AppText>
      </View>
    </View>
  );
}

function tripsCopy(t: Translate, count: number, language: string): string {
  return countCopy(t, "incentives.trips", count, language);
}

/**
 * Weekly trip bonus — the highest tier reached pays (ruling Q2). Between
 * tiers, the tier already secured shows under the next-tier progress (board
 * "D15IncentivesSecured").
 */
function WeeklyCard({
  weekly,
  currency,
}: {
  weekly: WeeklyTripsProgress;
  currency: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const top = weekly.tiers[weekly.tiers.length - 1];
  const next = weekly.nextTier ?? null;
  const reached = weekly.reachedTier ?? null;
  // The labelled tier is the one being worked toward (or the top one once
  // every tier is reached), with the tier after it greyed beside it.
  const focus: IncentiveTier = next ?? reached ?? top;
  // Reached but not the top tier: that amount pays even if no more trips come.
  const secured = next && reached ? reached : null;
  const following =
    weekly.tiers.find((tier) => tier.trips > focus.trips) ?? null;
  const money = (amount: number) => formatMoney(amount, currency, language);
  return (
    <View style={[styles.card, styles.cardFocus]} testID="incentives-weekly">
      <CardHead
        title={t("incentives.weekly.title")}
        subtitle={t("incentives.weekly.subtitle")}
        chip={tripsCopy(t, weekly.trips, language)}
        testID="incentives-weekly"
      />
      <TierBar
        fraction={top.trips > 0 ? weekly.trips / top.trips : 1}
        label={t("incentives.of", {
          n: formatCount(weekly.trips, language),
          d: tripsCopy(t, top.trips, language),
        })}
        marker={next && next.trips < top.trips ? next.trips / top.trips : null}
        testID="incentives-weekly-progress"
      />
      <View style={[styles.spread, flipRows && styles.rowReverse]}>
        <AppText variant="caption" weight="800" testID="incentives-weekly-tier">
          {t("incentives.weekly.tier", {
            trips: tripsCopy(t, focus.trips, language),
            amount: money(focus.amount),
          })}
        </AppText>
        {following ? (
          <AppText
            variant="caption"
            weight="400"
            color={colors.textMuted}
            testID="incentives-weekly-following"
          >
            {t("incentives.weekly.tier", {
              trips: formatCount(following.trips, language),
              amount: money(following.amount),
            })}
          </AppText>
        ) : null}
      </View>
      <AppText
        variant="caption"
        weight="400"
        color={colors.textSecondary}
        testID="incentives-weekly-next"
      >
        {next ? (
          <>
            <AppText
              variant="caption"
              weight="800"
              color={colors.textSecondary}
            >
              {countCopy(
                t,
                "incentives.weekly.more",
                Math.max(0, next.trips - weekly.trips),
                language,
              )}
            </AppText>
            {` ${t("incentives.weekly.forAmount", { amount: money(next.amount) })}`}
          </>
        ) : (
          t("incentives.weekly.topReached", { amount: money(focus.amount) })
        )}
      </AppText>
      {secured ? (
        <View
          style={[styles.secured, flipRows && styles.rowReverse]}
          testID="incentives-weekly-secured"
        >
          <Icon name="checkmark" size={14} color={colors.success} />
          <AppText
            variant="caption"
            weight="800"
            color={colors.success}
            style={styles.grow}
            testID="incentives-weekly-secured-text"
          >
            {t("incentives.weekly.secured", { amount: money(secured.amount) })}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Peak hours — a trip REQUESTED inside a window earns the bonus. */
function PeakCard({
  peak,
  currency,
}: {
  peak: PeakProgress;
  currency: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  return (
    <View style={styles.card} testID="incentives-peak">
      <CardHead
        title={t("incentives.peak.title")}
        subtitle={t("incentives.peak.subtitle", {
          amount: formatSignedMoney(peak.bonusPerTrip, currency, language, {
            alwaysSign: true,
          }),
        })}
        chip={t("incentives.peak.earned", {
          trips: tripsCopy(t, peak.trips, language),
          amount: formatMoney(peak.earned, currency, language),
        })}
        testID="incentives-peak"
      />
      {peak.activeNow && peak.activeUntil ? (
        <View
          style={[styles.liveChip, flipRows && styles.rowReverse]}
          testID="incentives-peak-now"
        >
          <View style={styles.liveDot} />
          <AppText variant="caption" weight="800" color={colors.success}>
            {t("incentives.peak.now", {
              time: isolateDigits(clockTime(peak.activeUntil), language),
            })}
          </AppText>
        </View>
      ) : null}
      <View style={styles.windows}>
        {peak.windows.map((window, index) => (
          <View
            key={`${window.daysOfWeek.join("-")}-${window.startsAt}-${index}`}
            style={[styles.windowRow, flipRows && styles.rowReverse]}
            testID={`incentives-peak-window-${index}`}
          >
            <AppText variant="caption" weight="700">
              {daysLabel(t, window.daysOfWeek)}
            </AppText>
            <AppText variant="caption" weight="800">
              {windowTimes(window.startsAt, window.endsAt, language)}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Weekly rating reward (ruling Q4) — the nightly average only, never a
 * count, so a single rating cannot be traced to a ride (RATE-02, owner
 * ruling 2026-10-20; board "V1FD15IncentivesNightly").
 */
function RatingCard({
  rating,
  currency,
}: {
  rating: RatingProgress;
  currency: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const missing = Math.max(0, rating.minWeeklyTrips - rating.trips);
  const status = rating.qualifies
    ? t("incentives.rating.qualifies")
    : missing > 0
      ? t("incentives.rating.notYetTrips", {
          more: countCopy(t, "incentives.weekly.more", missing, language),
        })
      : t("incentives.rating.notYet");
  const averageMet =
    rating.average != null && rating.average >= rating.minAvgRating;
  return (
    <View style={styles.card} testID="incentives-rating">
      <CardHead
        title={t("incentives.rating.title")}
        subtitle={t("incentives.rating.subtitle", {
          rating: formatThreshold(rating.minAvgRating, language),
          count: formatCount(rating.minWeeklyTrips, language),
          trips: tripsCopy(t, rating.minWeeklyTrips, language),
        })}
        chip={formatMoney(rating.amount, currency, language)}
        testID="incentives-rating"
      />
      <View style={[styles.statusRow, flipRows && styles.rowReverse]}>
        <View
          style={[styles.statusChip, rating.qualifies && styles.statusChipMet]}
        >
          <AppText
            variant="caption"
            weight="800"
            color={rating.qualifies ? colors.success : colors.textSecondary}
            testID="incentives-rating-status"
          >
            {status}
          </AppText>
        </View>
        <AppText
          variant="caption"
          weight="800"
          color={colors.textSecondary}
          testID="incentives-rating-target"
        >
          {t("incentives.rating.target", {
            rating: formatThreshold(rating.minAvgRating, language),
          })}
        </AppText>
      </View>
      <View style={[styles.spread, flipRows && styles.rowReverse]}>
        <View
          style={[styles.secured, flipRows && styles.rowReverse]}
          testID="incentives-rating-average"
        >
          {rating.average != null ? (
            <>
              <AppText variant="caption" color={colors.textSecondary}>
                {t("incentives.rating.average")}
              </AppText>
              <AppText weight="800">
                {formatRating(rating.average, language)}
              </AppText>
              {averageMet ? (
                <Icon
                  name="checkmark"
                  size={14}
                  color={colors.success}
                  testID="incentives-rating-average-met"
                />
              ) : null}
            </>
          ) : (
            <AppText variant="caption" color={colors.textSecondary}>
              {t("incentives.rating.noAverage")}
            </AppText>
          )}
        </View>
        <AppText
          variant="caption"
          color={colors.textSecondary}
          testID="incentives-rating-trips"
        >
          {t("incentives.rating.trips", {
            n: formatCount(rating.trips, language),
            d: tripsCopy(t, rating.minWeeklyTrips, language),
          })}
        </AppText>
      </View>
      <TierBar
        fraction={
          rating.minWeeklyTrips > 0 ? rating.trips / rating.minWeeklyTrips : 1
        }
        label={t("incentives.of", {
          n: formatCount(rating.trips, language),
          d: tripsCopy(t, rating.minWeeklyTrips, language),
        })}
        testID="incentives-rating-progress"
      />
      <View style={[styles.secured, flipRows && styles.rowReverse]}>
        <Icon name="time-outline" size={14} color={colors.textMuted} />
        <AppText
          variant="caption"
          color={colors.textMuted}
          style={styles.grow}
          testID="incentives-rating-note"
        >
          {t("incentives.rating.nightly")}
        </AppText>
      </View>
    </View>
  );
}

/** One paid award: "Last week · weekly trip bonus", "+SYP 50,000". */
function AwardRow({
  award,
  progress,
  testID,
}: {
  award: IncentiveAward;
  progress: IncentiveProgress;
  testID: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const week =
    award.weekStart === addDays(progress.weekStart, -7)
      ? t("incentives.award.lastWeek")
      : t("incentives.award.weekOf", {
          date: formatCalendarDay(t, award.weekStart, language),
        });
  return (
    <View style={[styles.award, flipRows && styles.rowReverse]} testID={testID}>
      <View style={styles.checkWell}>
        <Icon name="checkmark" size={16} color={colors.success} />
      </View>
      <View style={styles.grow}>
        <AppText variant="label" weight="800" testID={`${testID}-title`}>
          {`${week} · ${t(`incentives.award.kind.${award.kind}`)}`}
        </AppText>
        <AppText
          variant="caption"
          weight="400"
          color={colors.textMuted}
          testID={`${testID}-paid`}
        >
          {t("incentives.award.paid", {
            trips: tripsCopy(t, award.trips, language),
            date: formatCalendarDay(
              t,
              dateInZone(award.awardedAt, progress.timeZone),
              language,
            ),
          })}
        </AppText>
      </View>
      <AppText
        variant="label"
        weight="800"
        color={colors.success}
        testID={`${testID}-amount`}
      >
        {formatSignedMoney(award.amount, award.currency, language, {
          alwaysSign: true,
        })}
      </AppText>
    </View>
  );
}

/** Board "D15IncentivesEmpty": the region runs no incentive. */
function EmptyState({ regionName }: { regionName: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.empty} testID="incentives-empty">
      <View style={styles.emptyWell}>
        <Icon name="ribbon-outline" size={32} color={colors.accent} />
      </View>
      <AppText variant="heading" align="center">
        {t("incentives.emptyTitle", { region: regionName })}
      </AppText>
      <AppText variant="secondary" color={colors.textMuted} align="center">
        {t("incentives.emptyBody")}
      </AppText>
    </View>
  );
}

function Loaded({
  progress,
  fallbackCurrency,
}: {
  progress: IncentiveProgress;
  fallbackCurrency: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const currency = progress.currency ?? fallbackCurrency;
  // A block whose incentive is switched off (no tiers, a 0 bonus/reward)
  // has nothing to work toward, so it is left out.
  const weekly =
    progress.weeklyTrips && progress.weeklyTrips.tiers.length > 0
      ? progress.weeklyTrips
      : null;
  const peak =
    progress.peak &&
    progress.peak.bonusPerTrip > 0 &&
    progress.peak.windows.length > 0
      ? progress.peak
      : null;
  const rating =
    progress.rating && progress.rating.amount > 0 ? progress.rating : null;
  if (!progress.configured || (!weekly && !peak && !rating)) {
    return <EmptyState regionName={progress.regionName} />;
  }
  // Every award of the most recent paid week (a week can pay its tier, peak
  // and rating awards together); `recentAwards` is newest week first.
  const latestWeek = progress.recentAwards[0]?.weekStart ?? null;
  const latestAwards = progress.recentAwards.filter(
    (award) => award.weekStart === latestWeek,
  );
  return (
    <>
      <AppText
        variant="secondary"
        color={colors.textMuted}
        style={styles.week}
        testID="incentives-week"
      >
        {t("incentives.week", {
          range: weekRange(t, progress.weekStart, progress.weekEnd, language),
          region: progress.regionName,
        })}
      </AppText>
      {weekly ? <WeeklyCard weekly={weekly} currency={currency} /> : null}
      {peak ? <PeakCard peak={peak} currency={currency} /> : null}
      {rating ? <RatingCard rating={rating} currency={currency} /> : null}
      {latestAwards.map((award, index) => (
        <AwardRow
          key={`${award.weekStart}-${award.kind}`}
          award={award}
          progress={progress}
          testID={`incentives-award-${index}`}
        />
      ))}
      <View style={[styles.note, flipRows && styles.rowReverse]}>
        <Icon
          name="information-circle-outline"
          size={18}
          color={colors.textSecondary}
        />
        <AppText
          variant="caption"
          weight="400"
          color={colors.textSecondary}
          style={styles.noteText}
          testID="incentives-note"
        >
          {t("incentives.note")}
        </AppText>
      </View>
    </>
  );
}

/**
 * DRV-08 (UC-D-17) — the driver's incentives this week (boards
 * "D15Incentives" / "D15IncentivesAr" / "D15IncentivesEmpty", owner-approved
 * M15-T3, plus "D15IncentivesSecured" / "D15IncentivesSecuredAr" from the M15
 * review): the weekly trip tier progress, peak-hour windows and earnings,
 * the rating reward, the latest paid week's awards and the Monday payout
 * note. The region is the resolved operating region (the challenges pattern).
 */
export function IncentivesScreen() {
  const { t } = useTranslation();
  const region = useOptionalRegion();
  const resolved = region?.status === "resolved" ? region.config : null;
  const regionId = resolved?.id ?? null;
  // An unresolved region stays in the LOADING state (M13 review W14).
  const load = useCallback(
    (): Promise<IncentiveProgress> =>
      regionId
        ? getIncentives(regionId)
        : new Promise<IncentiveProgress>(() => {
            // Never settles: the regionId change remounts the loader.
          }),
    [regionId],
  );
  const { state, refreshing, reload } = useRemote(load);
  return (
    <Screen
      title={t("incentives.title")}
      testID="incentives-screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
        />
      }
    >
      {region?.status === "loading" ? (
        <LoadingState testID="incentives-region-loading" />
      ) : !regionId ? (
        <Muted testID="incentives-no-region">{t("incentives.noRegion")}</Muted>
      ) : state.status === "loading" ? (
        <LoadingState testID="incentives-loading" />
      ) : state.status === "error" ? (
        <FailureState
          kind={state.kind}
          onRetry={() => void reload()}
          testID="incentives-error"
        />
      ) : state.status === "loaded" ? (
        <Loaded
          progress={state.data}
          fallbackCurrency={resolved?.currency ?? ""}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  week: { marginTop: -spacing.sm },
  card: {
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    padding: 14,
  },
  cardFocus: { borderWidth: 2, borderColor: colors.accent },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  valueChip: {
    backgroundColor: colors.accentTint,
    borderRadius: radius.chip,
    paddingVertical: 5,
    paddingHorizontal: spacing.ms,
  },
  bar: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accentTint,
    flexDirection: "row",
  },
  barFill: { height: 10, borderRadius: 5, backgroundColor: colors.accent },
  marker: {
    position: "absolute",
    top: -3,
    width: 2,
    height: 16,
    backgroundColor: colors.text,
  },
  spread: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    backgroundColor: colors.successBg,
    borderRadius: radius.chip,
    paddingVertical: spacing.xs,
    paddingHorizontal: 10,
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.online,
  },
  secured: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  statusChip: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: spacing.xs,
    paddingHorizontal: 10,
  },
  statusChipMet: { backgroundColor: colors.successBg },
  windows: { gap: 6 },
  windowRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: colors.surfacePage,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  award: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surfacePage,
    borderRadius: radius.lg,
    paddingVertical: spacing.ms,
    paddingHorizontal: 14,
  },
  checkWell: {
    width: 32,
    height: 32,
    borderRadius: radius.round,
    backgroundColor: colors.successBg,
    alignItems: "center",
    justifyContent: "center",
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: 10,
    paddingHorizontal: spacing.ms,
    marginTop: "auto",
  },
  noteText: { flex: 1 },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.ms,
    paddingHorizontal: spacing.ms,
  },
  emptyWell: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
});
