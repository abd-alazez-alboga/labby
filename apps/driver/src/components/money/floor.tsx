import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import type { DriverBalanceEntry } from "../../api/money-types";
import { formatMoney } from "../../money/format";
import { colors, radius, spacing } from "../../theme/tokens";
import { AppText, Icon, PrimaryButton, useDirection } from "../ui";
import { ProgressBar } from "../ride/ride-parts";

/**
 * Floor-state UI (COM-03, UC-D-16) per the owner-approved artboards
 * "Driver Balance" (amber near-floor warning) and "Driver Blocked"
 * (red offers-paused card + settle instructions).
 */

/** How far along the debt is toward the floor (0..1). */
export function floorFraction(entry: DriverBalanceEntry): number {
  if (entry.floor >= 0) return 1;
  return Math.min(1, Math.max(0, entry.balance / entry.floor));
}

/**
 * How much more debt until the floor (balance − floor), subtracted in
 * integer minor units so 2-dp server amounts never pick up float noise.
 */
export function floorHeadroom(entry: DriverBalanceEntry): number {
  return (Math.round(entry.balance * 100) - Math.round(entry.floor * 100)) / 100;
}

/** Amber "You're close to the limit" banner with the debt progress bar. */
export function FloorWarningBanner({
  entry,
  testID = "floor-warning",
}: {
  entry: DriverBalanceEntry;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { flipRows, language } = useDirection();
  const limit = formatMoney(entry.floor, entry.currency, language);
  const toGo = formatMoney(floorHeadroom(entry), entry.currency, language);
  return (
    <View style={styles.warning} testID={testID}>
      <View style={[styles.titleRow, flipRows && styles.rowReverse]}>
        <Icon name="warning-outline" color={colors.warning} />
        <AppText variant="bodyStrong" color={colors.warning}>
          {t("floor.warningTitle")}
        </AppText>
      </View>
      <ProgressBar
        fraction={floorFraction(entry)}
        tone="warning"
        testID={`${testID}-bar`}
      />
      <AppText
        variant="caption"
        weight="600"
        color={colors.warning}
        testID={`${testID}-body`}
      >
        {t("floor.warningBody", { limit, toGo })}
      </AppText>
    </View>
  );
}

/** One numbered settle instruction. */
function Step({ index, text }: { index: number; text: string }) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.step, flipRows && styles.rowReverse]}>
      <View style={styles.stepBadge}>
        <AppText variant="label" weight="800" color={colors.accent} align="center">
          {String(index)}
        </AppText>
      </View>
      <AppText
        variant="secondary"
        color={colors.textSecondary}
        style={styles.stepText}
      >
        {text}
      </AppText>
    </View>
  );
}

/** "How to get back on the road" — the 3 settle instructions (UC-D-16). */
export function SettleSteps({ testID = "settle-steps" }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.steps} testID={testID}>
      <AppText variant="bodyStrong">{t("floor.stepsTitle")}</AppText>
      <Step index={1} text={t("floor.step1")} />
      <Step index={2} text={t("floor.step2")} />
      <Step index={3} text={t("floor.step3")} />
    </View>
  );
}

/**
 * The UNMISTAKABLE blocked state: red-bordered "Ride offers are paused"
 * card naming the debt and the limit, the amount owed, the settle steps and
 * (on home) the "See my balance" action.
 */
export function FloorBlockedCard({
  entry,
  onSeeBalance,
  testID = "floor-blocked",
}: {
  entry: DriverBalanceEntry;
  /** Home: navigates to the balance screen; omitted ON the balance screen. */
  onSeeBalance?: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { flipRows, language } = useDirection();
  const debt = formatMoney(entry.balance, entry.currency, language);
  const limit = formatMoney(entry.floor, entry.currency, language);
  return (
    <View style={styles.blockedGroup} testID={testID}>
      <View style={styles.blockedCard}>
        <View style={[styles.titleRow, flipRows && styles.rowReverse]}>
          <Icon name="ban-outline" size={24} color={colors.danger} />
          <AppText variant="heading" color={colors.danger}>
            {t("floor.blockedTitle")}
          </AppText>
        </View>
        <AppText
          variant="secondary"
          color={colors.danger}
          testID={`${testID}-body`}
        >
          {t("floor.blockedBody", { debt, limit })}
        </AppText>
      </View>

      <View style={styles.owe}>
        <AppText variant="label" weight="700" color={colors.textMuted}>
          {t("floor.youOwe")}
        </AppText>
        <AppText style={styles.oweAmount} testID={`${testID}-debt`}>
          {debt}
        </AppText>
      </View>

      <SettleSteps />

      {onSeeBalance ? (
        <PrimaryButton
          title={t("floor.seeBalance")}
          onPress={onSeeBalance}
          testID={`${testID}-see-balance`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  warning: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.lg,
    padding: 14,
    gap: spacing.sm + 2,
  },
  steps: {
    borderWidth: 1.5,
    borderColor: colors.line,
    borderRadius: radius.lg,
    padding: 14,
    gap: spacing.ms,
  },
  step: { flexDirection: "row", alignItems: "flex-start", gap: spacing.ms },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { flex: 1 },
  blockedGroup: { gap: spacing.md },
  blockedCard: {
    backgroundColor: colors.dangerBg,
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: 18,
    padding: spacing.md,
    gap: spacing.sm + 2,
  },
  owe: { gap: 2 },
  oweAmount: {
    fontSize: 40,
    lineHeight: 46,
    fontWeight: "800",
    letterSpacing: -1,
    color: colors.text,
  },
});
