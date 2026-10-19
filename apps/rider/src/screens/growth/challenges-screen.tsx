/**
 * Challenges (UC-S-24, GAME-02) — approved artboard R13Challenges: the
 * region + role's challenges as the backend orders them (running first,
 * then upcoming, then recently ended), each with its localized title, goal
 * progress bar, reward chip and window; a completed one shows the credited
 * points (auto-credited exactly once, server-side). An early end keeps
 * completions paid — the info note says so. E1: a lapsed window simply
 * shows as ended, no partial reward.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { type ChallengeView, listChallenges } from "../../api/growth";
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
import type { AppLocale } from "../../i18n/translations";
import { useOptionalRegion } from "../../region/region-context";
import { formatDateTime, formatPoints } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { blockedRegion, RegionBlockedView } from "./region-blocked";

type T = (key: string, params?: Record<string, unknown>) => string;

const PROGRESS_KEY: Record<ChallengeView["goalType"], string> = {
  completed_rides: "growth.challenges.progressRides",
  shared_rides: "growth.challenges.progressShared",
  five_star_ratings: "growth.challenges.progressRatings",
};

/** "3 of 5 rides" — progress in the goal's own unit, clamped to the target. */
export function progressLine(
  challenge: ChallengeView,
  locale: AppLocale,
  t: T,
): string {
  return t(PROGRESS_KEY[challenge.goalType], {
    progress: formatPoints(
      Math.min(challenge.myProgress, challenge.goalTarget),
      locale,
    ),
    target: formatPoints(challenge.goalTarget, locale),
  });
}

function ChallengeCard({
  challenge,
  now,
  testID,
}: {
  challenge: ChallengeView;
  /** The load time — "upcoming" is judged once, not per render. */
  now: number;
  testID: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const title = locale === "ar" ? challenge.titleAr : challenge.titleEn;
  const upcoming = !challenge.ended && Date.parse(challenge.startsAt) > now;
  const running = !challenge.ended && !upcoming;
  const ratio =
    challenge.goalTarget > 0
      ? Math.min(1, challenge.myProgress / challenge.goalTarget)
      : 0;

  if (challenge.myCompleted) {
    return (
      <View style={[styles.doneCard, { flexDirection: row }]} testID={testID}>
        <View style={styles.doneWell}>
          <Ionicons name="checkmark" size={16} color={colors.success} />
        </View>
        <View style={styles.flex}>
          <AppText variant="rowTitle" weight={800}>
            {title}
          </AppText>
          <AppText
            variant="caption"
            tone="secondary"
            weight={400}
            testID={`${testID}-done`}
          >
            {t("growth.challenges.done", {
              points: formatPoints(challenge.rewardPoints, locale),
            })}
          </AppText>
        </View>
        <AppText variant="rowTitle" weight={800} tone="success">
          {`+${formatPoints(challenge.rewardPoints, locale)}`}
        </AppText>
      </View>
    );
  }

  return (
    <View
      style={[styles.card, running ? styles.cardRunning : null]}
      testID={testID}
    >
      <View style={[styles.cardHead, { flexDirection: row }]}>
        <View style={styles.flex}>
          <AppText variant="rowTitle" weight={800}>
            {title}
          </AppText>
        </View>
        <View style={styles.rewardChip}>
          <AppText
            variant="caption"
            weight={800}
            tone="accent"
            testID={`${testID}-reward`}
          >
            {t("growth.challenges.reward", {
              points: formatPoints(challenge.rewardPoints, locale),
            })}
          </AppText>
        </View>
      </View>
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round(ratio * 100)}%` },
          ]}
        />
      </View>
      <View style={[styles.cardFoot, { flexDirection: row }]}>
        <AppText
          variant="caption"
          weight={800}
          style={styles.flex}
          testID={`${testID}-progress`}
        >
          {progressLine(challenge, locale, t)}
        </AppText>
        <AppText
          variant="caption"
          tone="muted"
          weight={400}
          testID={`${testID}-window`}
        >
          {challenge.ended
            ? t("growth.challenges.endedChip")
            : upcoming
              ? t("growth.challenges.startsAt", {
                  when: formatDateTime(challenge.startsAt, locale),
                })
              : t("growth.challenges.endsAt", {
                  when: formatDateTime(challenge.endsAt, locale),
                })}
        </AppText>
      </View>
    </View>
  );
}

export default function ChallengesScreen() {
  const { t } = useLocale();
  const { row } = useDirection();
  const region = useOptionalRegion();
  const regionId = region?.config?.id ?? null;
  const [challenges, setChallenges] = useState<ChallengeView[] | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!regionId) return;
    setFailure(null);
    try {
      setChallenges(await listChallenges(regionId));
    } catch (error) {
      setFailure(failureKind(error));
    }
  }, [regionId]);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  if (failure) {
    return (
      <ErrorView
        kind={failure}
        onRetry={() => void load()}
        testID="challenges-error"
      />
    );
  }
  const blocked = blockedRegion(region);
  if (blocked) {
    // M13 review W10: the region rule drives the screen — explain + retry.
    return (
      <RegionBlockedView region={blocked} testID="challenges-region-blocked" />
    );
  }
  if (!challenges) return <LoadingView testID="challenges-loading" />;

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="challenges-screen"
    >
      <AppText variant="secondary" tone="secondary" weight={400}>
        {t("growth.challenges.subtitle")}
      </AppText>
      {challenges.length === 0 ? (
        <AppText
          variant="secondary"
          tone="muted"
          weight={400}
          testID="challenges-empty"
        >
          {t("growth.challenges.empty")}
        </AppText>
      ) : (
        challenges.map((challenge) => (
          <ChallengeCard
            key={challenge.challengeId}
            challenge={challenge}
            now={now}
            testID={`challenge-${challenge.challengeId}`}
          />
        ))
      )}
      <View style={[styles.note, { flexDirection: row }]}>
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={colors.textSecondary}
        />
        <AppText
          variant="caption"
          tone="secondary"
          weight={400}
          style={styles.flex}
        >
          {t("growth.challenges.note")}
        </AppText>
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 20,
    padding: spacing.lg,
  },
  cardRunning: {
    borderWidth: 2,
    borderColor: colors.accent,
  },
  cardHead: {
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  rewardChip: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
    backgroundColor: colors.accentTint,
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accentTint,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.accent,
  },
  cardFoot: {
    alignItems: "center",
    gap: spacing.sm,
  },
  doneCard: {
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfacePage,
    borderRadius: 20,
    padding: spacing.lg,
  },
  doneWell: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.successBg,
    alignItems: "center",
    justifyContent: "center",
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
