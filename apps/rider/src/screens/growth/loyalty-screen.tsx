/**
 * Labby Points (UC-R-19, GRW-04) — approved artboard R13Loyalty: the purple
 * balance card (spendable points, level chip, lifetime progress to the next
 * rung — spending never lowers the level), the redeem entry (disabled below
 * the region threshold, UC-R-19 E1), the region rule line (accrual rate,
 * threshold, redemption rate — all from `rule`, never hardcoded) and the
 * points activity from `GET /loyalty/transactions`. The redeem sheet
 * (R13Redeem) refreshes the balance from its response.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import {
  type ChallengeView,
  getLoyalty,
  listChallenges,
  listPointsTransactions,
  type LoyaltyBalance,
  type LoyaltyRule,
  nextLevel,
  type PointsTransaction,
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
import {
  formatDate,
  formatMoney,
  formatPoints,
  formatSignedPoints,
} from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";
import { blockedRegion, RegionBlockedView } from "./region-blocked";
import { RedeemSheet } from "./redeem-sheet";

type T = (key: string, params?: Record<string, unknown>) => string;

/**
 * "1 point for every SYP 100 you pay on a ride" — the accrual side of the
 * region rule: rates below 1 pt/unit invert into currency units per point.
 */
export function accrualLine(
  rule: LoyaltyRule,
  locale: AppLocale,
  t: T,
): string {
  const money = (amount: number) =>
    formatMoney(amount, rule.currency, locale, t);
  if (rule.pointsPerCurrencyUnit >= 1) {
    return rule.pointsPerCurrencyUnit === 1
      ? t("growth.loyalty.earnPerAmount", { money: money(1) })
      : t("growth.loyalty.earnPerUnit", {
          points: formatPoints(rule.pointsPerCurrencyUnit, locale),
          money: money(1),
        });
  }
  return t("growth.loyalty.earnPerAmount", {
    money: money(Math.round(1 / rule.pointsPerCurrencyUnit)),
  });
}

const TYPE_META: Record<
  PointsTransaction["type"],
  {
    labelKey: string;
    icon: "car-outline" | "ribbon-outline" | "card-outline" | "create-outline";
    accent: boolean;
  }
> = {
  accrual: {
    labelKey: "growth.loyalty.typeRide",
    icon: "car-outline",
    accent: true,
  },
  challenge: {
    labelKey: "growth.loyalty.typeChallenge",
    icon: "ribbon-outline",
    accent: true,
  },
  redemption: {
    labelKey: "growth.loyalty.typeRedemption",
    icon: "card-outline",
    accent: false,
  },
  adjustment: {
    labelKey: "growth.loyalty.typeAdjustment",
    icon: "create-outline",
    accent: false,
  },
};

function ActivityRow({
  transaction,
  challenge,
  testID,
}: {
  transaction: PointsTransaction;
  /** The challenge a `challenge` credit came from, when known. */
  challenge?: ChallengeView | null;
  testID: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const meta = TYPE_META[transaction.type];
  // Approved artboard R13Loyalty: "Challenge · Weekend rider".
  const title = challenge
    ? t("growth.loyalty.typeChallengeNamed", {
        name: locale === "ar" ? challenge.titleAr : challenge.titleEn,
      })
    : t(meta.labelKey);
  return (
    <View style={[styles.activity, { flexDirection: row }]} testID={testID}>
      <View style={[styles.well, meta.accent && styles.wellAccent]}>
        <Ionicons
          name={meta.icon}
          size={16}
          color={meta.accent ? colors.accent : colors.text}
        />
      </View>
      <View style={styles.flex}>
        <AppText variant="rowTitle" weight={700} testID={`${testID}-title`}>
          {title}
        </AppText>
        <AppText variant="caption" tone="secondary" weight={400}>
          {formatDate(transaction.createdAt, locale)}
        </AppText>
      </View>
      <AppText
        variant="rowTitle"
        weight={transaction.points < 0 ? 700 : 800}
        tone={transaction.points < 0 ? "secondary" : "default"}
        testID={`${testID}-points`}
      >
        {formatSignedPoints(transaction.points, locale)}
      </AppText>
    </View>
  );
}

export default function LoyaltyScreen() {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const region = useOptionalRegion();
  const regionId = region?.config?.id ?? null;
  const [balance, setBalance] = useState<LoyaltyBalance | null>(null);
  const [activity, setActivity] = useState<PointsTransaction[] | null>(null);
  const [challenges, setChallenges] = useState<ChallengeView[]>([]);
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [redeemOpen, setRedeemOpen] = useState(false);

  const load = useCallback(async () => {
    if (!regionId) return;
    setFailure(null);
    try {
      const [nextBalance, page] = await Promise.all([
        getLoyalty(regionId),
        listPointsTransactions(),
      ]);
      setBalance(nextBalance);
      setActivity(page.items);
    } catch (error) {
      setFailure(failureKind(error));
      return;
    }
    // Names the challenge credits; best effort — the rows read
    // "Challenge" without it.
    try {
      setChallenges(await listChallenges(regionId));
    } catch {
      setChallenges([]);
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
        testID="loyalty-error"
      />
    );
  }
  const blocked = blockedRegion(region);
  if (blocked) {
    // M13 review W10: the region rule drives the screen — explain + retry.
    return (
      <RegionBlockedView region={blocked} testID="loyalty-region-blocked" />
    );
  }
  if (!balance || !activity) return <LoadingView testID="loyalty-loading" />;

  const next = nextLevel(balance.levels, balance.lifetime);
  const canRedeem =
    balance.redeemable >= balance.rule.redemptionThresholdPoints;
  const money = (amount: number) =>
    formatMoney(amount, balance.rule.currency, locale, t);

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="loyalty-screen"
    >
      <View style={styles.card}>
        <View style={[styles.cardHead, { flexDirection: row }]}>
          <AppText
            variant="label"
            weight={700}
            tone="onAccent"
            style={styles.dim}
          >
            {t("growth.loyalty.spendable")}
          </AppText>
          <View style={styles.levelChip}>
            <AppText
              variant="caption"
              weight={800}
              tone="accent"
              testID="loyalty-level"
            >
              {t(`growth.loyalty.level.${balance.level}`)}
            </AppText>
          </View>
        </View>
        <AppText
          variant="display"
          weight={800}
          tone="onAccent"
          testID="loyalty-redeemable"
        >
          {formatPoints(balance.redeemable, locale)}
        </AppText>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${Math.round((next?.progress ?? 1) * 100)}%` },
            ]}
          />
        </View>
        <AppText
          variant="caption"
          weight={400}
          tone="onAccent"
          style={styles.dim}
          testID="loyalty-lifetime"
        >
          {next
            ? t("growth.loyalty.lifetimeToNext", {
                lifetime: formatPoints(balance.lifetime, locale),
                remaining: formatPoints(next.remaining, locale),
                level: t(`growth.loyalty.level.${next.level}`),
              })
            : t("growth.loyalty.lifetimeTop", {
                lifetime: formatPoints(balance.lifetime, locale),
              })}
        </AppText>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canRedeem }}
        onPress={() => setRedeemOpen(true)}
        disabled={!canRedeem}
        style={({ pressed }) => [
          styles.redeem,
          !canRedeem && styles.redeemDisabled,
          pressed && styles.pressed,
        ]}
        testID="loyalty-redeem"
      >
        <AppText variant="bodyStrong" weight={800} tone="accent" align="center">
          {t("growth.loyalty.redeemCta")}
        </AppText>
      </Pressable>

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
          testID="loyalty-rule"
        >
          {t("growth.loyalty.ruleNote", {
            earn: accrualLine(balance.rule, locale, t),
            threshold: formatPoints(
              balance.rule.redemptionThresholdPoints,
              locale,
            ),
            money: money(100 * balance.rule.redemptionRate),
          })}
        </AppText>
      </View>

      <AppText variant="heading">{t("growth.loyalty.activity")}</AppText>
      {activity.length === 0 ? (
        <AppText
          variant="secondary"
          tone="muted"
          weight={400}
          testID="loyalty-empty"
        >
          {t("growth.loyalty.empty")}
        </AppText>
      ) : (
        <View>
          {activity.map((transaction) => (
            <ActivityRow
              key={transaction.pointsTransactionId}
              transaction={transaction}
              challenge={
                transaction.type === "challenge" && transaction.challengeId
                  ? challenges.find(
                      (item) => item.challengeId === transaction.challengeId,
                    )
                  : null
              }
              testID={`loyalty-activity-${transaction.pointsTransactionId}`}
            />
          ))}
        </View>
      )}

      {redeemOpen ? (
        <RedeemSheet
          visible
          balance={balance}
          onClose={() => setRedeemOpen(false)}
          onRedeemed={(fresh) => {
            setBalance(fresh);
            // The redemption row lands in the history too.
            void listPointsTransactions()
              .then((page) => setActivity(page.items))
              .catch(() => {});
          }}
        />
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.accent,
    borderRadius: 20,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  cardHead: {
    alignItems: "center",
    justifyContent: "space-between",
  },
  levelChip: {
    paddingVertical: 5,
    paddingHorizontal: spacing.md,
    borderRadius: radius.chip,
    backgroundColor: colors.accentTint,
  },
  dim: {
    opacity: 0.92,
  },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accentPressed,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: colors.onAccent,
  },
  redeem: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  redeemDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.75,
  },
  note: {
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  activity: {
    alignItems: "center",
    gap: spacing.md,
    minHeight: 60,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  well: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  wellAccent: {
    backgroundColor: colors.accentTint,
  },
  flex: {
    flex: 1,
  },
});
