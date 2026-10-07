import React from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { FailureKind } from "../../onboarding/server-errors";
import { colors, radius, spacing } from "../../theme/tokens";
import { Banner } from "./banner";
import { SecondaryButton } from "./buttons";
import { AppText, useDirection } from "./text";

/** White card, radius 16, `line` border — groups related rows/content. */
export function Card({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.card} testID={testID}>
      {children}
    </View>
  );
}

/** Label / value pair on one row (muted label, 600 value). */
export function KeyValue({ label, value }: { label: string; value: string }) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.keyValue, flipRows && styles.rowReverse]}>
      <AppText variant="secondary" color={colors.textMuted} style={styles.key}>
        {label}
      </AppText>
      <AppText
        variant="secondary"
        weight="600"
        style={styles.value}
        align="auto"
      >
        {value}
      </AppText>
    </View>
  );
}

export function LoadingState({
  testID,
  label,
}: {
  testID?: string;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.centered} testID={testID ?? "loading-state"}>
      <ActivityIndicator color={colors.accent} />
      <AppText variant="secondary" color={colors.textMuted} align="center">
        {label ?? t("onboarding.loading")}
      </AppText>
    </View>
  );
}

/** Distinct network vs server failure states, each with a retry. */
export function FailureState({
  kind,
  onRetry,
  testID,
}: {
  kind: FailureKind;
  onRetry: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  return (
    <Banner
      tone="danger"
      icon={
        kind === "network" ? "cloud-offline-outline" : "alert-circle-outline"
      }
      title={t(`onboarding.errors.${kind}Title`)}
      message={t(`onboarding.errors.${kind}`)}
      testID={testID ?? `failure-${kind}`}
    >
      <SecondaryButton
        title={t("onboarding.actions.retry")}
        icon="refresh"
        onPress={onRetry}
        testID="failure-retry"
      />
    </Banner>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    gap: spacing.sm,
  },
  keyValue: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  rowReverse: { flexDirection: "row-reverse" },
  key: { flexShrink: 0 },
  value: { flexShrink: 1 },
  centered: {
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
});
