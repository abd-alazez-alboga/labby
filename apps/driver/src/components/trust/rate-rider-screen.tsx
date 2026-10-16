import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, View } from "react-native";

import { submitRating } from "../../api/trust";
import { rideErrorOf } from "../../api/rides";
import { RATING_COMMENT_MAX } from "../../api/trust-types";
import type { PendingRating } from "../../api/trust-types";
import { useOptionalAvailability } from "../../realtime/AvailabilityProvider";
import { formatTime } from "../../rides/format";
import { colors, spacing } from "../../theme/tokens";
import type { PromptPayment } from "../../trust/RatingPromptProvider";
import { formatDayMonth, formatDayMonthTime } from "../../trust/format";
import {
  AppText,
  Banner,
  Icon,
  PrimaryButton,
  SafeScrollView,
  TextField,
  useDirection,
  useSafeBottomBar,
} from "../ui";

const SCORES = [1, 2, 3, 4, 5] as const;

/** 409 codes that end the rating for good (UC-S-17 E1/E2). */
type Closed = "windowClosed" | "alreadyRated" | "notCompleted";
type RateError = Closed | "network" | "server";

function errorOf(caught: unknown): RateError {
  const coded = rideErrorOf(caught);
  if (!coded) return "network";
  if (coded.status === 409) {
    if (coded.code === "rating_window_closed") return "windowClosed";
    if (coded.code === "rating_already_submitted") return "alreadyRated";
    return "notCompleted";
  }
  return "server";
}

function isClosed(error: RateError | null): error is Closed {
  return (
    error === "windowClosed" ||
    error === "alreadyRated" ||
    error === "notCompleted"
  );
}

/** "12:43" today, "14 Oct, 12:43" on an earlier day. */
function endedAt(iso: string, language: string, now: Date = new Date()): string {
  const date = new Date(iso);
  return date.toDateString() === now.toDateString()
    ? formatTime(iso, language)
    : formatDayMonthTime(iso, language);
}

/**
 * UC-S-17 for the driver (artboard "Driver Rate rider"): "Report a problem"
 * and "Skip" on top, the rider's initial, 1–5 stars, an optional comment,
 * the anonymity note, and "Submit and go online" (the prompt) or "Submit
 * rating" (from Trips). A 409 window-closed / already-rated / not-completed
 * ends the rating with its reason; other failures can be retried.
 */
export function RateRiderScreen({
  target,
  payment,
  mode,
  onSkip,
  onDone,
  onReport,
}: {
  target: PendingRating;
  payment: PromptPayment | null;
  /** `prompt` after a trip / cold start; `history` from the Trips list. */
  mode: "prompt" | "history";
  onSkip: () => void;
  /** Rated, or no longer rateable. */
  onDone: (rideId: string) => void;
  onReport: () => void;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const bottom = useSafeBottomBar();
  const availability = useOptionalAvailability();
  const [score, setScore] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RateError | null>(null);
  const name = target.counterpartFirstName.trim() || t("ride.theRider");
  const closed = isClosed(error);
  const time = endedAt(target.completedAt, language);

  const submit = async () => {
    if (score < 1 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await submitRating(target.rideId, {
        score,
        comment: comment.trim() || null,
      });
      // "Submit and go online": back on the road if the driver is offline.
      const load = availability?.load;
      if (
        mode === "prompt" &&
        load?.status === "loaded" &&
        !load.data.online &&
        load.data.canGoOnline
      ) {
        void availability?.goOnline();
      }
      onDone(target.rideId);
    } catch (caught) {
      setError(errorOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen} testID="rate-rider-screen">
      <SafeScrollView
        safeTop
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.topRow, flipRows && styles.rowReverse]}>
          <Pressable
            accessibilityRole="button"
            onPress={onReport}
            style={styles.topLink}
            testID="rate-report"
          >
            <AppText variant="bodyStrong" weight="800" color={colors.accent}>
              {t("trust.rate.reportProblem")}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={onSkip}
            style={styles.topLink}
            testID="rate-skip"
          >
            <AppText variant="bodyStrong" weight="800" color={colors.textSecondary}>
              {t("trust.rate.skip")}
            </AppText>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.avatar}>
            <AppText style={styles.initial} color={colors.accent}>
              {name.charAt(0).toUpperCase()}
            </AppText>
          </View>
          <AppText variant="title" align="center" testID="rate-title">
            {t("trust.rate.title", { name })}
          </AppText>
          <AppText
            variant="secondary"
            color={colors.textSecondary}
            align="center"
            testID="rate-subtitle"
          >
            {payment
              ? t("trust.rate.tripEndedWith", {
                  time,
                  payment: t(`trust.rate.payment.${payment}`),
                })
              : t("trust.rate.tripEnded", { time })}
          </AppText>
        </View>

        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={t("trust.rate.starsLabel")}
          style={[styles.stars, flipRows && styles.rowReverse]}
          testID="rate-stars"
        >
          {SCORES.map((value) => (
            <Pressable
              key={value}
              accessibilityRole="radio"
              accessibilityLabel={t(`trust.rate.stars.${value}`)}
              accessibilityState={{ checked: score === value, disabled: closed }}
              onPress={() => {
                if (closed || busy) return;
                setScore(value);
                setError(null);
              }}
              style={styles.star}
              testID={`rate-star-${value}`}
            >
              <Icon
                name={value <= score ? "star" : "star-outline"}
                size={44}
                color={colors.accent}
              />
            </Pressable>
          ))}
        </View>
        <AppText
          variant="bodyStrong"
          weight="800"
          align="center"
          testID="rate-score-label"
        >
          {t(`trust.rate.scoreLabels.${score}`)}
        </AppText>

        <TextField
          label={t("trust.rate.commentLabel")}
          placeholder={t("trust.rate.commentPlaceholder")}
          value={comment}
          onChangeText={setComment}
          maxLength={RATING_COMMENT_MAX}
          multiline
          textAlignVertical="top"
          editable={!closed}
          testID="rate-comment"
        />
        <AppText variant="caption" weight="400" color={colors.textSecondary}>
          {t("trust.rate.anonymous", { name })}
        </AppText>

        {error ? (
          <Banner
            tone={closed ? "neutral" : "danger"}
            message={t(`trust.rate.errors.${error}`)}
            testID={`rate-error-${error}`}
          />
        ) : null}
      </SafeScrollView>

      <View style={[styles.footer, { paddingBottom: bottom }]}>
        {closed ? (
          <PrimaryButton
            title={t("trust.rate.done")}
            onPress={() => onDone(target.rideId)}
            testID="rate-done"
          />
        ) : (
          <PrimaryButton
            title={t(
              mode === "prompt"
                ? "trust.rate.submitAndGoOnline"
                : "trust.rate.submit",
            )}
            onPress={() => void submit()}
            disabled={score < 1}
            busy={busy}
            testID="rate-submit"
          />
        )}
        {mode === "prompt" && !closed ? (
          <AppText
            variant="caption"
            weight="400"
            color={colors.textMuted}
            align="center"
            testID="rate-skipped-hint"
          >
            {t("trust.rate.skippedHint", {
              date: formatDayMonth(target.windowEndsAt, language),
            })}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.ml,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rowReverse: { flexDirection: "row-reverse" },
  topLink: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: spacing.xs,
    justifyContent: "center",
  },
  hero: { alignItems: "center", gap: spacing.ms, paddingTop: spacing.sm },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  initial: { fontSize: 28, lineHeight: 34, fontWeight: "800" },
  stars: {
    flexDirection: "row",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  star: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.ms,
    gap: 10,
    backgroundColor: colors.surface,
  },
});

/** The report screen for the ride being rated ("Report a problem"). */
export function reportHrefFor(target: PendingRating) {
  const place = target.destinationLabel?.trim() || target.pickupLabel?.trim();
  return {
    pathname: "/report-rider" as const,
    params: {
      rideId: target.rideId,
      name: target.counterpartFirstName,
      when: target.completedAt,
      ...(place ? { place } : {}),
    },
  };
}
