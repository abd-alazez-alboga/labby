/**
 * Level & badges (UC-S-23, GAME-01/03) — approved artboard R13Profile: the
 * level card (current level, lifetime points, progress along the ladder to
 * the next rung, the rung thresholds) and the badge grid — the WHOLE fixed
 * catalog in sort order, earned badges accented with their award date,
 * locked ones greyed with how to earn them (the contract carries no partial
 * progress). Levels never decrease (ruling 5).
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import {
  type BadgeCode,
  type GamificationView,
  getGamification,
  nextLevel,
} from "../../api/growth";
import { failureKind, type FailureKind } from "../../api/http-client";
import {
  AppText,
  ErrorView,
  LoadingView,
  ScreenScrollView,
  screenStyles,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatDate, formatPoints } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

const BADGE_ICONS: Record<BadgeCode, React.ComponentProps<typeof Ionicons>["name"]> = {
  ride_10: "car-outline",
  ride_50: "car-outline",
  ride_100: "car-outline",
  first_shared_ride: "people-outline",
  first_referral: "chatbox-outline",
  five_star_week: "star-outline",
};

function BadgeCard({
  badge,
  testID,
}: {
  badge: GamificationView["badges"][number];
  testID: string;
}) {
  const { t, locale } = useLocale();
  return (
    <View style={styles.badge} testID={testID}>
      <View style={[styles.badgeWell, badge.earned && styles.badgeWellEarned]}>
        <Ionicons
          name={BADGE_ICONS[badge.badgeCode]}
          size={24}
          color={badge.earned ? colors.accent : colors.textMuted}
        />
      </View>
      <AppText
        variant="label"
        weight={800}
        tone={badge.earned ? "default" : "muted"}
        align="center"
      >
        {t(`growth.badges.name.${badge.badgeCode}`)}
      </AppText>
      <AppText
        variant="caption"
        tone="muted"
        weight={400}
        align="center"
        testID={`${testID}-line`}
      >
        {badge.earned && badge.awardedAt
          ? t("growth.badges.earnedOn", {
              date: formatDate(badge.awardedAt, locale),
            })
          : t(`growth.badges.hint.${badge.badgeCode}`)}
      </AppText>
    </View>
  );
}

export default function BadgesScreen() {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const [view, setView] = useState<GamificationView | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setView(await getGamification());
    } catch (error) {
      setFailure(failureKind(error));
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (failure) {
    return (
      <ErrorView kind={failure} onRetry={() => void load()} testID="badges-error" />
    );
  }
  if (!view) return <LoadingView testID="badges-loading" />;

  const next = nextLevel(view.levels, view.lifetime);
  const earned = view.badges.filter((badge) => badge.earned).length;
  const ladder = [...view.levels]
    .sort((a, b) => a.thresholdPoints - b.thresholdPoints)
    .map(
      (rung) =>
        `${t(`growth.loyalty.level.${rung.level}`)} ${formatPoints(rung.thresholdPoints, locale)}`,
    )
    .join(" · ");

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="badges-screen"
    >
      <View style={[styles.levelCard, { flexDirection: row }]}>
        <View style={styles.levelWell}>
          <Ionicons name="ribbon-outline" size={28} color={colors.textSecondary} />
        </View>
        <View style={styles.levelBody}>
          <View style={[styles.levelLine, { flexDirection: row }]}>
            <AppText variant="heading" testID="badges-level">
              {t(`growth.loyalty.level.${view.level}`)}
            </AppText>
            <AppText variant="caption" tone="muted" weight={400} testID="badges-lifetime">
              {t("growth.badges.lifetime", {
                points: formatPoints(view.lifetime, locale),
              })}
            </AppText>
          </View>
          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                { width: `${Math.round((next?.progress ?? 1) * 100)}%` },
              ]}
            />
          </View>
          <AppText variant="caption" tone="muted" weight={400} testID="badges-ladder">
            {`${
              next
                ? t("growth.badges.toNext", {
                    points: formatPoints(next.remaining, locale),
                    level: t(`growth.loyalty.level.${next.level}`),
                  })
                : t("growth.badges.top")
            } · ${ladder}`}
          </AppText>
        </View>
      </View>

      <AppText variant="heading" testID="badges-count">
        {t("growth.badges.gridTitle", { earned, total: view.badges.length })}
      </AppText>
      <View style={[styles.grid, { flexDirection: row }]}>
        {view.badges.map((badge) => (
          <BadgeCard
            key={badge.badgeCode}
            badge={badge}
            testID={`badge-${badge.badgeCode}`}
          />
        ))}
      </View>

      <View style={[styles.note, { flexDirection: row }]}>
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={colors.textSecondary}
        />
        <AppText variant="caption" tone="secondary" weight={400} style={styles.flex}>
          {t("growth.badges.note")}
        </AppText>
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  levelCard: {
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfacePage,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    padding: spacing.lg,
  },
  levelWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  levelBody: {
    flex: 1,
    gap: spacing.xs,
  },
  levelLine: {
    alignItems: "baseline",
    gap: spacing.sm,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.lineStrong,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
  grid: {
    flexWrap: "wrap",
    gap: spacing.md,
  },
  badge: {
    flexBasis: "47%",
    flexGrow: 1,
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  badgeWell: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeWellEarned: {
    backgroundColor: colors.accentTint,
  },
  note: {
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  flex: {
    flex: 1,
  },
});
