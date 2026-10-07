/**
 * Full-area loading / empty / error states shared by list screens, so every
 * screen distinguishes "no data" from "could not reach Labby" (network) and
 * "Labby answered with an error" (server) the same way.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import type { FailureKind } from "../../api/http-client";
import { useLocale } from "../../i18n/locale-context";
import { colors, radius, spacing } from "../../theme/tokens";
import { PrimaryButton } from "./buttons";
import { AppText } from "./text";

export function LoadingView({ testID }: { testID?: string }) {
  return (
    <View style={styles.center} testID={testID}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

function StateIcon({
  name,
}: {
  name: React.ComponentProps<typeof Ionicons>["name"];
}) {
  return (
    <View style={styles.iconWell}>
      <Ionicons name={name} size={32} color={colors.textMuted} />
    </View>
  );
}

export function EmptyView({
  title,
  body,
  icon = "notifications-off-outline",
  testID,
}: {
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  testID?: string;
}) {
  return (
    <View style={styles.center} testID={testID}>
      <StateIcon name={icon} />
      <AppText variant="heading" align="center">
        {title}
      </AppText>
      {body ? (
        <AppText variant="secondary" tone="muted" align="center">
          {body}
        </AppText>
      ) : null}
    </View>
  );
}

export function ErrorView({
  kind,
  onRetry,
  testID,
}: {
  kind: FailureKind;
  onRetry: () => void;
  testID?: string;
}) {
  const { t } = useLocale();
  return (
    <View style={styles.center} testID={testID ?? `error-${kind}`}>
      <StateIcon
        name={
          kind === "network" ? "cloud-offline-outline" : "alert-circle-outline"
        }
      />
      <AppText variant="heading" align="center">
        {t(`common.${kind}ErrorTitle`)}
      </AppText>
      <AppText variant="secondary" tone="muted" align="center">
        {t(`common.${kind}ErrorBody`)}
      </AppText>
      <PrimaryButton
        label={t("common.retry")}
        onPress={onRetry}
        testID="error-retry"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.md,
  },
  iconWell: {
    width: 72,
    height: 72,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
});
