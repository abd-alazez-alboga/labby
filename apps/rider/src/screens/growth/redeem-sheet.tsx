/**
 * Redeem points into wallet credit (UC-R-19, GRW-04) — approved artboard
 * R13Redeem: a ±step stepper starting at the region threshold, the credit
 * preview (points × the region's `redemptionRate`), the points left after,
 * the can't-be-undone note and "Redeem N points". The refusals surface by
 * their contract codes: 403 `account_suspended` (ruling 6 — points kept),
 * 409 `below_threshold` / `insufficient_points`.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import { type LoyaltyBalance, redeemPoints } from "../../api/growth";
import { ApiError } from "../../api/http-client";
import {
  AppText,
  Banner,
  BottomSheet,
  PrimaryButton,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { AppLocale } from "../../i18n/translations";
import { formatMoney, formatPoints } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

/** The stepper moves in steps of this many points. */
export const REDEEM_STEP = 100;

type T = (key: string, params?: Record<string, unknown>) => string;

/** The copy of a refused redemption, by its contract code. */
export function redeemErrorMessage(
  error: unknown,
  threshold: number,
  t: T,
  locale: AppLocale,
): string {
  if (error instanceof ApiError) {
    if (error.status === 403 || error.body?.code === "account_suspended") {
      return t("growth.redeem.suspended");
    }
    if (error.body?.code === "below_threshold") {
      return t("growth.redeem.belowThreshold", {
        points: formatPoints(threshold, locale),
      });
    }
    if (error.body?.code === "insufficient_points") {
      return t("growth.redeem.insufficient");
    }
  }
  return t("growth.redeem.failed");
}

export function RedeemSheet({
  visible,
  balance,
  onClose,
  onRedeemed,
}: {
  visible: boolean;
  balance: LoyaltyBalance;
  onClose: () => void;
  /** The fresh balance the redeem call answered with. */
  onRedeemed: (next: LoyaltyBalance) => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const threshold = balance.rule.redemptionThresholdPoints;
  const max = Math.max(threshold, balance.redeemable);
  const [points, setPoints] = useState(threshold);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const currency = balance.rule.currency;
  const credit = points * balance.rule.redemptionRate;
  const left = Math.max(0, balance.redeemable - points);
  const money = (amount: number) => formatMoney(amount, currency, locale, t);

  const step = (direction: 1 | -1) => {
    setError(null);
    setPoints((current) =>
      Math.min(max, Math.max(threshold, current + direction * REDEEM_STEP)),
    );
  };

  const redeem = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await redeemPoints(balance.rule.regionId, points);
      onRedeemed(next);
      onClose();
    } catch (failed) {
      setError(redeemErrorMessage(failed, threshold, t, locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="redeem-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.flex} />
        <BottomSheet testID="redeem-sheet">
          <AppText variant="title">{t("growth.redeem.title")}</AppText>
          <AppText variant="secondary" tone="secondary" weight={400}>
            {t("growth.redeem.balanceLine", {
              points: formatPoints(balance.redeemable, locale),
              money: money(100 * balance.rule.redemptionRate),
            })}
          </AppText>

          <View style={[styles.stepperRow, { flexDirection: row }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("growth.redeem.fewer")}
              onPress={() => step(-1)}
              disabled={points <= threshold}
              style={({ pressed }) => [
                styles.stepButton,
                points <= threshold && styles.stepDisabled,
                pressed && styles.pressed,
              ]}
              testID="redeem-less"
            >
              <Ionicons name="remove" size={22} color={colors.text} />
            </Pressable>
            <View style={styles.amount}>
              <AppText variant="display" weight={800} testID="redeem-points">
                {formatPoints(points, locale)}
              </AppText>
              <AppText variant="label" weight={700} tone="muted">
                {t("growth.redeem.pointsUnit")}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("growth.redeem.more")}
              onPress={() => step(1)}
              disabled={points + REDEEM_STEP > max}
              style={({ pressed }) => [
                styles.stepButton,
                points + REDEEM_STEP > max && styles.stepDisabled,
                pressed && styles.pressed,
              ]}
              testID="redeem-more"
            >
              <Ionicons name="add" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.preview}>
            <View style={[styles.previewLine, { flexDirection: row }]}>
              <AppText variant="secondary" tone="secondary" style={styles.flex}>
                {t("growth.redeem.credit")}
              </AppText>
              <AppText variant="secondary" weight={800} testID="redeem-credit">
                {`+${money(credit)}`}
              </AppText>
            </View>
            <View style={[styles.previewLine, { flexDirection: row }]}>
              <AppText
                variant="caption"
                tone="muted"
                weight={400}
                style={styles.flex}
              >
                {t("growth.redeem.leftAfter")}
              </AppText>
              <AppText variant="caption" weight={700} testID="redeem-left">
                {formatPoints(left, locale)}
              </AppText>
            </View>
          </View>

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
              {t("growth.redeem.note")}
            </AppText>
          </View>

          {error ? (
            <Banner tone="danger" message={error} testID="redeem-error" />
          ) : null}

          <PrimaryButton
            label={t("growth.redeem.cta", {
              points: formatPoints(points, locale),
            })}
            onPress={() => void redeem()}
            disabled={points > balance.redeemable}
            loading={busy}
            testID="redeem-confirm"
          />
          <TextButton
            label={t("growth.redeem.notNow")}
            onPress={onClose}
            style={styles.notNow}
            testID="redeem-not-now"
          />
        </BottomSheet>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.48)",
  },
  stepperRow: {
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  stepButton: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    alignItems: "center",
    justifyContent: "center",
  },
  stepDisabled: {
    opacity: 0.4,
  },
  amount: {
    alignItems: "center",
    gap: 2,
  },
  preview: {
    backgroundColor: colors.accentTint,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  previewLine: {
    alignItems: "center",
    gap: spacing.md,
  },
  note: {
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.chip,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  notNow: {
    alignSelf: "center",
  },
  flex: {
    flex: 1,
  },
  pressed: {
    opacity: 0.6,
  },
});
