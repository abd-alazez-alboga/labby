import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { RefreshControl, StyleSheet, View } from "react-native";

import { getChallenges } from "../../api/growth";
import type { ChallengeView } from "../../api/growth-types";
import { formatAmountValue, isolateDigits } from "../../money/format";
import { useRemote } from "../../onboarding/use-remote";
import { useOptionalRegion } from "../../region/RegionProvider";
import { colors, radius, spacing } from "../../theme/tokens";
import { countCopy, formatCount, formatDayMonthTime } from "../../trust/format";
import { ProgressBar } from "../ride/ride-parts";
import {
  AppText,
  FailureState,
  Icon,
  LoadingState,
  Muted,
  Screen,
  useDirection,
} from "../ui";

function title(challenge: ChallengeView, language: string): string {
  return language === "ar" ? challenge.titleAr : challenge.titleEn;
}

/** "+500", LTR-isolated in Arabic so the sign never reorders. */
function plusPoints(points: number, language: string): string {
  return isolateDigits(`+${formatAmountValue(points, 0)}`, language);
}

/** "26 of 40 trips" / «26 من 40 رحلة» — plural-correct by the goal target. */
function progressCopy(
  t: (key: string, options?: Record<string, unknown>) => string,
  challenge: ChallengeView,
  language: string,
): string {
  return t("growth.challenges.of", {
    n: formatCount(challenge.myProgress, language),
    d: countCopy(
      t,
      `growth.challenges.unit.${challenge.goalType}`,
      challenge.goalTarget,
      language,
    ),
  });
}

/** A completed challenge: the green check row with the credited points. */
function CompletedCard({
  challenge,
  regionName,
}: {
  challenge: ChallengeView;
  regionName: string | null;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  return (
    <View
      style={styles.completedCard}
      testID={`challenge-done-${challenge.challengeId}`}
    >
      <View style={[styles.completedRow, flipRows && styles.rowReverse]}>
        <View style={styles.checkWell}>
          <Icon name="checkmark" size={16} color={colors.success} />
        </View>
        <View style={styles.grow}>
          <AppText variant="bodyStrong" weight="800">
            {title(challenge, language)}
            {regionName ? ` · ${regionName}` : ""}
          </AppText>
          <AppText variant="caption" weight="400" color={colors.textMuted}>
            {t("growth.challenges.credited", {
              value: formatCount(challenge.rewardPoints, language),
            })}
          </AppText>
        </View>
        <AppText variant="bodyStrong" weight="800" color={colors.success}>
          {plusPoints(challenge.rewardPoints, language)}
        </AppText>
      </View>
    </View>
  );
}

/** A running, upcoming or ended-uncompleted challenge with live progress. */
function ChallengeCard({
  challenge,
  regionName,
  now,
}: {
  challenge: ChallengeView;
  regionName: string | null;
  now: number;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const upcoming = !challenge.ended && Date.parse(challenge.startsAt) > now;
  const running = !challenge.ended && !upcoming;
  const when = challenge.ended
    ? t("growth.challenges.endedOn", {
        date: formatDayMonthTime(challenge.endsAt, language),
      })
    : upcoming
      ? t("growth.challenges.starts", {
          date: formatDayMonthTime(challenge.startsAt, language),
        })
      : t("growth.challenges.ends", {
          date: formatDayMonthTime(challenge.endsAt, language),
        });
  return (
    <View
      style={[styles.card, running && styles.cardRunning, challenge.ended && styles.cardEnded]}
      testID={`challenge-${challenge.challengeId}`}
    >
      <View style={[styles.cardHead, flipRows && styles.rowReverse]}>
        <View style={styles.grow}>
          <AppText variant="rowTitle" weight="800">
            {title(challenge, language)}
          </AppText>
          <AppText variant="caption" weight="400" color={colors.textMuted}>
            {countCopy(
              t,
              `growth.challenges.unit.${challenge.goalType}`,
              challenge.goalTarget,
              language,
            )}
            {regionName ? ` · ${regionName}` : ""}
          </AppText>
        </View>
        <View style={styles.rewardChip}>
          <AppText variant="caption" weight="800" color={colors.accentPressed}>
            {t("growth.challenges.reward", {
              value: plusPoints(challenge.rewardPoints, language),
            })}
          </AppText>
        </View>
      </View>
      <View style={styles.progress}>
        <ProgressBar
          fraction={
            challenge.goalTarget > 0
              ? challenge.myProgress / challenge.goalTarget
              : 0
          }
          testID={`challenge-${challenge.challengeId}-progress`}
        />
        <View style={[styles.progressRow, flipRows && styles.rowReverse]}>
          <AppText
            variant="caption"
            weight="800"
            testID={`challenge-${challenge.challengeId}-count`}
          >
            {progressCopy(t, challenge, language)}
          </AppText>
          <AppText variant="caption" weight="400" color={colors.textMuted}>
            {when}
          </AppText>
        </View>
      </View>
    </View>
  );
}

function Loaded({
  challenges,
  regionName,
}: {
  challenges: ChallengeView[];
  regionName: string | null;
}) {
  const { t } = useTranslation();
  const now = Date.now();
  if (challenges.length === 0) {
    return <Muted testID="challenges-empty">{t("growth.challenges.empty")}</Muted>;
  }
  return (
    <>
      {challenges.map((challenge) =>
        challenge.myCompleted ? (
          <CompletedCard
            key={challenge.challengeId}
            challenge={challenge}
            regionName={regionName}
          />
        ) : (
          <ChallengeCard
            key={challenge.challengeId}
            challenge={challenge}
            regionName={regionName}
            now={now}
          />
        ),
      )}
    </>
  );
}

/**
 * GAME-02 (UC-S-24) — the driver's challenges (artboards "D13Challenges" /
 * "D13ChallengesAr", owner-approved 2026-10-18): the region's challenges with
 * live progress, reward points that only ever feed the level, and the
 * early-end note. The region comes from the resolved operating region.
 */
export function ChallengesScreen() {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const region = useOptionalRegion();
  const regionId = region?.status === "resolved" ? region.config?.id ?? null : null;
  const regionName =
    region?.status === "resolved" ? region.config?.name ?? null : null;
  // M13 review W14: an unresolved region must stay in the LOADING state —
  // resolving [] here was recorded as data, and the screen then flashed the
  // empty state while the real list was still on its way.
  const load = useCallback(
    (): Promise<ChallengeView[]> =>
      regionId
        ? getChallenges(regionId)
        : new Promise<ChallengeView[]>(() => {
            // Never settles: the regionId change remounts the loader.
          }),
    [regionId],
  );
  const { state, refreshing, reload } = useRemote(load);
  return (
    <Screen
      title={t("growth.challenges.title")}
      testID="challenges-screen"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
      }
    >
      <AppText variant="secondary" color={colors.textMuted} testID="challenges-subtitle">
        {t("growth.challenges.subtitle")}
      </AppText>
      {region?.status === "loading" ? (
        <LoadingState testID="challenges-region-loading" />
      ) : !regionId ? (
        <Muted testID="challenges-no-region">{t("growth.challenges.noRegion")}</Muted>
      ) : (
        <>
          {state.status === "loading" ? (
            <LoadingState testID="challenges-loading" />
          ) : null}
          {state.status === "error" ? (
            <FailureState
              kind={state.kind}
              onRetry={() => void reload()}
              testID="challenges-error"
            />
          ) : null}
          {state.status === "loaded" ? (
            <Loaded challenges={state.data} regionName={regionName} />
          ) : null}
        </>
      )}
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
          testID="challenges-note"
        >
          {t("growth.challenges.note")}
        </AppText>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  grow: { flex: 1 },
  card: {
    gap: spacing.ms,
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  cardRunning: { borderWidth: 2, borderColor: colors.accent },
  cardEnded: { backgroundColor: colors.surfacePage },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  rewardChip: {
    backgroundColor: colors.accentTint,
    borderRadius: radius.chip,
    paddingVertical: 5,
    paddingHorizontal: spacing.ms,
  },
  progress: { gap: 6 },
  progressRow: { flexDirection: "row", justifyContent: "space-between" },
  completedCard: {
    backgroundColor: colors.surfacePage,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  completedRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
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
    gap: spacing.sm,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: 11,
    paddingHorizontal: 13,
    marginTop: "auto",
  },
  noteText: { flex: 1 },
});
