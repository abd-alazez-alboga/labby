/**
 * Invite friends (UC-R-18, GRW-03) — approved artboards R13Referral(+Ar):
 * the purple reward card with the region's amounts (from `reward`, amended
 * at T3 sign-off), the share code (created lazily on first read) with Copy
 * and the system share sheet, the 1-2-3 steps, the referee list (status
 * only — pending / rewarded / blocked, never phones) and the once-per-phone
 * note. Without a resolved region the card falls back to amount-less copy
 * (`reward` is null); amounts of 0 mean "nothing configured" and fall back
 * the same way.
 */
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, Share, StyleSheet, View } from "react-native";

import {
  getReferralStatus,
  type ReferralReward,
  type ReferralStatus,
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
import type { AppLocale } from "../../i18n/translations";
import { useOptionalRegion } from "../../region/region-context";
import { formatDate, formatMoney } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

type T = (key: string, params?: Record<string, unknown>) => string;

/** The reward card's headline from the region amounts (null/0 = no figure). */
export function rewardHeadline(
  reward: ReferralReward | null | undefined,
  locale: AppLocale,
  t: T,
): string {
  if (!reward || (reward.referrerAmount <= 0 && reward.refereeAmount <= 0)) {
    return t("growth.referral.rewardNoAmount");
  }
  if (reward.referrerAmount === reward.refereeAmount) {
    return t("growth.referral.rewardBoth", {
      money: formatMoney(reward.referrerAmount, reward.currency, locale, t),
    });
  }
  return t("growth.referral.rewardSplit", {
    referrer: formatMoney(reward.referrerAmount, reward.currency, locale, t),
    referee: formatMoney(reward.refereeAmount, reward.currency, locale, t),
  });
}

function RefereeRow({
  referee,
  testID,
}: {
  referee: ReferralStatus["referees"][number];
  testID: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const rewarded = referee.status === "rewarded";
  const line =
    referee.status === "rewarded"
      ? t("growth.referral.statusRewarded", {
          date: formatDate(referee.rewardedAt ?? referee.createdAt, locale),
        })
      : referee.status === "blocked"
        ? t("growth.referral.statusBlocked")
        : t("growth.referral.statusPending");
  return (
    <View style={[styles.referee, { flexDirection: row }]} testID={testID}>
      <View style={[styles.statusWell, rewarded && styles.statusWellDone]}>
        <Ionicons
          name={
            rewarded
              ? "checkmark"
              : referee.status === "blocked"
                ? "close"
                : "time-outline"
          }
          size={16}
          color={rewarded ? colors.success : colors.textSecondary}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="rowTitle" weight={700}>
          {referee.firstName?.trim() || t("growth.referral.friendFallback")}
        </AppText>
        <AppText
          variant="caption"
          tone="secondary"
          weight={400}
          testID={`${testID}-status`}
        >
          {line}
        </AppText>
      </View>
    </View>
  );
}

export default function ReferralScreen() {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const region = useOptionalRegion();
  const regionId = region?.config?.id;
  const [status, setStatus] = useState<ReferralStatus | null>(null);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setFailure(null);
    try {
      setStatus(await getReferralStatus(regionId));
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
      <ErrorView kind={failure} onRetry={() => void load()} testID="referral-error" />
    );
  }
  if (!status) return <LoadingView testID="referral-loading" />;

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(status.code);
      setCopied(true);
    } catch {
      // The share sheet remains as the way to pass the code on.
    }
  };

  const share = () => {
    void Share.share({
      message: t("growth.referral.shareMessage", { code: status.code }),
    }).catch(() => {});
  };

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="referral-screen"
    >
      <View style={styles.card}>
        <AppText
          variant="label"
          weight={700}
          tone="onAccent"
          style={styles.cardDim}
          testID="referral-reward"
        >
          {rewardHeadline(status.reward, locale, t)}
        </AppText>
        <AppText
          variant="secondary"
          weight={400}
          tone="onAccent"
          style={styles.cardDim}
        >
          {t("growth.referral.rewardBody")}
        </AppText>
        <View style={[styles.codeBox, { flexDirection: row }]}>
          <AppText
            variant="heading"
            weight={800}
            tone="onAccent"
            style={styles.code}
            testID="referral-code"
          >
            {`⁦${status.code}⁩`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              copied ? t("growth.referral.copied") : t("growth.referral.copyCode")
            }
            onPress={() => void copy()}
            style={({ pressed }) => [styles.copy, pressed && styles.pressed]}
            testID="referral-copy"
          >
            <Ionicons
              name={copied ? "checkmark" : "copy-outline"}
              size={20}
              color={colors.accent}
            />
          </Pressable>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={share}
          style={({ pressed }) => [styles.shareButton, pressed && styles.pressed]}
          testID="referral-share"
        >
          <AppText variant="bodyStrong" weight={800} tone="accent" align="center">
            {t("growth.referral.share")}
          </AppText>
        </Pressable>
      </View>

      <View style={styles.steps}>
        {(["step1", "step2", "step3"] as const).map((key, index) => (
          <View key={key} style={[styles.step, { flexDirection: row }]}>
            <View style={styles.stepBadge}>
              <AppText variant="caption" weight={800} tone="accent">
                {String(index + 1)}
              </AppText>
            </View>
            <AppText variant="secondary" tone="secondary" style={styles.flex}>
              {t(`growth.referral.${key}`)}
            </AppText>
          </View>
        ))}
      </View>

      <AppText variant="heading">{t("growth.referral.invitesTitle")}</AppText>
      {status.referees.length === 0 ? (
        <AppText
          variant="secondary"
          tone="muted"
          weight={400}
          testID="referral-empty"
        >
          {t("growth.referral.empty")}
        </AppText>
      ) : (
        <View>
          {status.referees.map((referee, index) => (
            <RefereeRow
              key={`${referee.createdAt}-${index}`}
              referee={referee}
              testID={`referral-referee-${index}`}
            />
          ))}
        </View>
      )}

      <View style={[styles.note, { flexDirection: row }]}>
        <Ionicons
          name="information-circle-outline"
          size={18}
          color={colors.textSecondary}
        />
        <AppText variant="caption" tone="secondary" weight={400} style={styles.flex}>
          {t("growth.referral.note")}
        </AppText>
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    padding: spacing.xl,
    gap: spacing.md,
  },
  cardDim: {
    opacity: 0.92,
  },
  codeBox: {
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.accentPressed,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: 14,
  },
  code: {
    flex: 1,
    letterSpacing: 2,
  },
  copy: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  shareButton: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: {
    opacity: 0.75,
  },
  steps: {
    gap: spacing.sm,
  },
  step: {
    alignItems: "center",
    gap: 10,
  },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  referee: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  statusWell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  statusWellDone: {
    backgroundColor: colors.successBg,
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
