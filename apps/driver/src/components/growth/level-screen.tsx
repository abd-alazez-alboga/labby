import React from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";

import { getGamification } from "../../api/growth";
import type {
  BadgeCode,
  BadgeView,
  GamificationView,
} from "../../api/growth-types";
import { useRemote } from "../../onboarding/use-remote";
import { colors, radius, spacing } from "../../theme/tokens";
import { formatCount, formatDayMonth } from "../../trust/format";
import {
  AppText,
  FailureState,
  Icon,
  LoadingState,
  Screen,
  useDirection,
} from "../ui";
import type { IconName } from "../ui";

const BADGE_ICONS: Record<BadgeCode, IconName> = {
  ride_10: "car-outline",
  ride_50: "car-outline",
  ride_100: "car-outline",
  first_shared_ride: "people-outline",
  first_referral: "gift-outline",
  five_star_week: "star-outline",
};

/** The kit ProgressBar is accent-on-line; on the accent hero the fill is white. */
function HeroBar({ fraction }: { fraction: number }) {
  const { flipRows } = useDirection();
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      style={[styles.heroBar, flipRows && styles.rowReverse]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      testID="level-progress"
    >
      <View style={[styles.heroBarFill, { width: `${percent}%` }]} />
    </View>
  );
}

/** The level hero: current level, lifetime points and the way to the next rung. */
function LevelCard({ data }: { data: GamificationView }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const ladder = [...data.levels].sort(
    (a, b) => a.thresholdPoints - b.thresholdPoints,
  );
  const current = ladder.find((step) => step.level === data.level);
  const next = ladder.find((step) => step.thresholdPoints > data.lifetime);
  const floor = current?.thresholdPoints ?? 0;
  const fraction = next
    ? (data.lifetime - floor) / (next.thresholdPoints - floor)
    : 1;
  return (
    <View style={[styles.hero, flipRows && styles.rowReverse]} testID="level-hero">
      <View style={styles.heroIcon}>
        <Icon name="medal-outline" size={28} color={colors.onAccent} />
      </View>
      <View style={styles.heroBody}>
        <View style={[styles.heroTitleRow, flipRows && styles.rowReverse]}>
          <AppText style={styles.heroLevel} testID="level-name">
            {t(`growth.level.levelName.${data.level}`)}
          </AppText>
          <AppText variant="caption" weight="700" color={colors.accentTint}>
            {t("growth.level.points", {
              value: formatCount(data.lifetime, language),
            })}
          </AppText>
        </View>
        <HeroBar fraction={fraction} />
        <AppText
          variant="caption"
          weight="700"
          color={colors.accentTint}
          testID="level-to-next"
        >
          {next
            ? t("growth.level.toNext", {
                value: formatCount(next.thresholdPoints - data.lifetime, language),
                level: t(`growth.level.levelName.${next.level}`),
              })
            : t("growth.level.top")}
        </AppText>
      </View>
    </View>
  );
}

function BadgeTile({ badge }: { badge: BadgeView }) {
  const { t } = useTranslation();
  const { language } = useDirection();
  return (
    <View style={styles.badge} testID={`badge-${badge.badgeCode}`}>
      <View style={[styles.badgeWell, badge.earned && styles.badgeWellEarned]}>
        <Icon
          name={BADGE_ICONS[badge.badgeCode]}
          size={20}
          color={badge.earned ? colors.accent : colors.textSubtle}
        />
      </View>
      <AppText
        variant="caption"
        weight="800"
        align="center"
        color={badge.earned ? colors.text : colors.textMuted}
      >
        {t(`growth.level.badge.${badge.badgeCode}`)}
      </AppText>
      {badge.earned && badge.awardedAt ? (
        // UC-S-23: earned badges carry their award date (M13 review W11,
        // owner-approved board amendment D13Badges).
        <AppText
          variant="caption"
          weight="400"
          align="center"
          color={colors.textMuted}
          testID={`badge-${badge.badgeCode}-earned-at`}
        >
          {t("growth.level.earnedAt", {
            date: formatDayMonth(badge.awardedAt, language),
          })}
        </AppText>
      ) : null}
    </View>
  );
}

function Loaded({ data }: { data: GamificationView }) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const earned = data.badges.filter((badge) => badge.earned).length;
  const rows: BadgeView[][] = [];
  for (let i = 0; i < data.badges.length; i += 3) {
    rows.push(data.badges.slice(i, i + 3));
  }
  return (
    <>
      <LevelCard data={data} />
      <View style={[styles.statRow, flipRows && styles.rowReverse]}>
        <View style={styles.statCard} testID="level-trips">
          <AppText variant="caption" weight="700" color={colors.textMuted}>
            {t("growth.level.trips")}
          </AppText>
          <AppText style={styles.statValue} testID="level-trips-value">
            {formatCount(data.driverTrips ?? 0, language)}
          </AppText>
        </View>
        <View style={styles.statCard} testID="level-challenge-points">
          <AppText variant="caption" weight="700" color={colors.textMuted}>
            {t("growth.level.challengePoints")}
          </AppText>
          <AppText style={styles.statValue} testID="level-challenge-points-value">
            {formatCount(data.challengePoints ?? 0, language)}
          </AppText>
        </View>
      </View>
      <AppText variant="heading" testID="level-badges-count">
        {t("growth.level.badges", {
          earned: formatCount(earned, language),
          total: formatCount(data.badges.length, language),
        })}
      </AppText>
      <View style={styles.badgeGrid}>
        {rows.map((row) => (
          <View
            key={row[0].badgeCode}
            style={[styles.badgeRow, flipRows && styles.rowReverse]}
          >
            {row.map((badge) => (
              <BadgeTile key={badge.badgeCode} badge={badge} />
            ))}
          </View>
        ))}
      </View>
      <View style={[styles.note, flipRows && styles.rowReverse]}>
        <Icon name="information-circle-outline" size={18} color={colors.textSecondary} />
        <AppText
          variant="caption"
          weight="400"
          color={colors.textSecondary}
          style={styles.noteText}
          testID="level-note"
        >
          {t("growth.level.note")}
        </AppText>
      </View>
    </>
  );
}

/**
 * UC-S-23/24 (GAME-01/03) — the driver's level & badges (artboard
 * "D13Badges", owner-approved 2026-10-18): the level hero with progress to
 * the next rung, the lifetime points, the full badge catalog earned/unearned,
 * and the note that badges and levels never affect payouts or dispatch.
 */
export function LevelScreen() {
  const { t } = useTranslation();
  const { state, refreshing, reload } = useRemote(getGamification);
  return (
    <Screen
      title={t("growth.level.title")}
      testID="level-screen"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
      }
    >
      {state.status === "loading" ? <LoadingState testID="level-loading" /> : null}
      {state.status === "error" ? (
        <FailureState
          kind={state.kind}
          onRetry={() => void reload()}
          testID="level-error"
        />
      ) : null}
      {state.status === "loaded" ? <Loaded data={state.data} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  hero: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.accent,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.round,
    backgroundColor: colors.accentPressed,
    alignItems: "center",
    justifyContent: "center",
  },
  heroBody: { flex: 1, gap: spacing.xs },
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  heroLevel: { fontSize: 20, lineHeight: 26, fontWeight: "800", color: colors.onAccent },
  heroBar: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accentPressed,
    overflow: "hidden",
    flexDirection: "row",
  },
  heroBarFill: { height: 8, backgroundColor: colors.onAccent },
  statRow: { flexDirection: "row", gap: spacing.ms },
  statCard: {
    flex: 1,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: 2,
  },
  statValue: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
  badgeGrid: { gap: spacing.ms },
  badgeRow: { flexDirection: "row", gap: spacing.ms },
  badge: {
    flex: 1,
    alignItems: "center",
    gap: 6,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: spacing.sm,
  },
  badgeWell: {
    width: 44,
    height: 44,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeWellEarned: { backgroundColor: colors.accentTint },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  noteText: { flex: 1 },
});
