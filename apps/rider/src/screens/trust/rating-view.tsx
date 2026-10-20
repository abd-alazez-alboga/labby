/**
 * Rate your driver (UC-S-17, RATE-01) — approved artboards RiderRate /
 * RiderRateAr: Skip at the top end, the driver's photo or initials, "How
 * was your ride with Samer?" + the ride line, five 56 px stars (a radio
 * group; star 1 sits at the reading start, so RTL mirrors them), the word
 * for the chosen score, an optional comment (≤ 1000), the anonymity note
 * (the driver only ever sees an overall average), Submit and the "rate
 * from Your rides until …" line.
 *
 * Submitting answers 204 — nothing comes back. The contract's 409s each get
 * their own copy (window closed / already rated / not completed), as does a
 * 403 `account_suspended`, and turn the screen into a closable notice; any other failure keeps the form for
 * another try. Used embedded right after a ride completes (RideView) and as
 * the /rate/{rideId} route (history, cold-start prompt).
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  RATING_COMMENT_MAX,
  submitRating,
  trustErrorCode,
} from "../../api/trust";
import {
  AppText,
  Banner,
  PrimaryButton,
  ScreenScrollView,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { Ride } from "../../api/rides";
import { formatDate, formatDateTime, placeLabel } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { emitRatingSubmitted } from "../../trust/rating-events";
import { DriverAvatar } from "../ride/ride-parts";

const SCORES = [1, 2, 3, 4, 5] as const;

/** The 409 codes that end the rating flow for this ride. */
export const RATING_BLOCKING_CODES = [
  "rating_window_closed",
  "rating_already_submitted",
  "ride_not_completed",
  // 403 — the whole account is suspended: nothing to retry.
  "account_suspended",
] as const;
export type RatingBlock = (typeof RATING_BLOCKING_CODES)[number];

/** "Wed 8 Oct · 12:43 · Umayyad Square" — when the ride ended, and where. */
export function ratingRideLine(
  ride: Pick<Ride, "timeline" | "destination">,
  locale: "en" | "ar",
  t: (key: string, options?: object) => string,
): string {
  const at = ride.timeline.completedAt ?? ride.timeline.requestedAt;
  return t("rating.rideLine", {
    date: formatDateTime(at, locale),
    place: placeLabel(ride.destination),
  });
}

export type RatingOutcome = "submitted" | "skipped" | "closed";

export interface RatingViewProps {
  rideId: string;
  driverName: string;
  driverPhotoUrl?: string | null;
  /** "Today 12:43 · Umayyad Square". */
  rideLine: string;
  /** completedAt + 7 days; the "until …" line hides without it. */
  windowEndsAt?: string | null;
  /** Start as the closable notice (the ride can no longer be rated). */
  initialBlock?: RatingBlock | null;
  onDone: (outcome: RatingOutcome) => void;
}

export function RatingView({
  rideId,
  driverName,
  driverPhotoUrl,
  rideLine,
  windowEndsAt,
  initialBlock = null,
  onDone,
}: RatingViewProps) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const { top } = useSafeAreaInsets();
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [block, setBlock] = useState<RatingBlock | null>(initialBlock);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (score === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      const text = comment.trim();
      await submitRating(rideId, { score, comment: text ? text : null });
      emitRatingSubmitted(rideId, score);
      onDone("submitted");
    } catch (failure) {
      const code = trustErrorCode(failure);
      if (code && (RATING_BLOCKING_CODES as readonly string[]).includes(code)) {
        setBlock(code as RatingBlock);
      } else {
        setError(t("rating.errors.generic"));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScreenScrollView
      style={styles.page}
      contentContainerStyle={[styles.content, { paddingTop: top + spacing.sm }]}
      keyboardShouldPersistTaps="handled"
      testID="rating-screen"
    >
      <View style={[styles.topBar, { flexDirection: row }]}>
        <View style={styles.flex} />
        {block ? null : (
          <Pressable
            accessibilityRole="button"
            onPress={() => onDone("skipped")}
            style={({ pressed }) => [styles.skip, pressed && styles.pressed]}
            testID="rating-skip"
          >
            <AppText variant="bodyStrong" weight={800} tone="secondary">
              {t("rating.skip")}
            </AppText>
          </Pressable>
        )}
      </View>
      <View style={styles.hero}>
        <DriverAvatar firstName={driverName} photoUrl={driverPhotoUrl} size={80} />
        <AppText
          variant="title"
          align="center"
          style={styles.heroText}
          testID="rating-title"
        >
          {t("rating.title", { name: driverName })}
        </AppText>
        <AppText
          variant="secondary"
          tone="secondary"
          align="center"
          style={styles.heroText}
        >
          {rideLine}
        </AppText>
      </View>

      {block ? (
        <>
          <Banner
            tone="neutral"
            message={t(`rating.errors.${block}`)}
            testID="rating-blocked"
          />
          <View style={styles.footer}>
            <PrimaryButton
              label={t("rating.close")}
              onPress={() => onDone("closed")}
              testID="rating-close"
            />
          </View>
        </>
      ) : (
        <>
          <View>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t("rating.starsLabel")}
              style={[styles.stars, { flexDirection: row }]}
              testID="rating-stars"
            >
              {SCORES.map((value) => {
                const filled = score !== null && value <= score;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={t(`rating.stars.${value}`)}
                    accessibilityState={{ checked: score === value }}
                    onPress={() => setScore(value)}
                    style={styles.star}
                    testID={`rating-star-${value}`}
                  >
                    <Ionicons
                      name={filled ? "star" : "star-outline"}
                      size={44}
                      color={filled ? colors.accent : colors.textMuted}
                    />
                  </Pressable>
                );
              })}
            </View>
            <AppText
              variant="bodyStrong"
              weight={800}
              align="center"
              style={styles.scoreLabel}
              testID="rating-score-label"
            >
              {score !== null ? t(`rating.labels.${score}`) : " "}
            </AppText>
          </View>

          <TextField
            label={t("rating.commentLabel")}
            placeholder={t("rating.commentPlaceholder")}
            value={comment}
            onChangeText={setComment}
            maxLength={RATING_COMMENT_MAX}
            multiline
            style={styles.comment}
            testID="rating-comment"
          />

          <View style={[styles.note, { flexDirection: row }]}>
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={colors.textSecondary}
              style={styles.noteIcon}
            />
            <AppText
              variant="caption"
              tone="secondary"
              weight={400}
              style={[styles.flex, styles.noteText]}
              testID="rating-anonymous"
            >
              {t("rating.anonymous", { name: driverName })}
            </AppText>
          </View>

          {error ? (
            <Banner tone="danger" message={error} testID="rating-error" />
          ) : null}

          <View style={styles.footer}>
            <PrimaryButton
              label={t("rating.submit")}
              onPress={() => void submit()}
              disabled={score === null}
              loading={busy}
              testID="rating-submit"
            />
            {windowEndsAt ? (
              <AppText
                variant="caption"
                tone="muted"
                weight={400}
                align="center"
                testID="rating-window"
              >
                {t("rating.windowNote", {
                  date: formatDate(windowEndsAt, locale),
                })}
              </AppText>
            ) : null}
          </View>
        </>
      )}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.xl,
    paddingBottom: 34,
    gap: spacing.xl,
  },
  topBar: {
    alignItems: "center",
  },
  flex: {
    flex: 1,
  },
  skip: {
    height: 48,
    paddingHorizontal: spacing.sm,
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.6,
  },
  hero: {
    alignItems: "center",
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  // Full width: a centred title never shrink-wraps (Android under-measures
  // Arabic and drops the last word — the driver's name).
  heroText: {
    alignSelf: "stretch",
  },
  stars: {
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
  scoreLabel: {
    marginTop: -spacing.xs,
  },
  comment: {
    height: 96,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  note: {
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  noteIcon: {
    marginTop: 1,
  },
  noteText: {
    lineHeight: 20,
  },
  footer: {
    marginTop: "auto",
    gap: 10,
  },
});
