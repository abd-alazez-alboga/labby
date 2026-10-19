/**
 * The region-blocked state of the growth screens (M13 review W10): loyalty
 * and challenges need a resolved operating region for their rules, so an
 * `outside` / `permissionDenied` / `error` region renders the matching
 * region copy with its retry instead of loading forever. The copy is the
 * home screen's `region.*` slice, so the two surfaces always say the same
 * thing about the same state.
 */
import React from "react";
import { StyleSheet, View } from "react-native";

import { AppText, PrimaryButton, TextButton } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { RegionContextValue } from "../../region/region-context";
import { spacing } from "../../theme/tokens";

/** The blocked region, or null while loading / resolved / provider-less. */
export function blockedRegion(
  region: RegionContextValue | null,
): RegionContextValue | null {
  return region && region.status !== "resolved" && region.status !== "loading"
    ? region
    : null;
}

export function RegionBlockedView({
  region,
  testID,
}: {
  region: RegionContextValue;
  testID: string;
}) {
  const { t } = useLocale();
  const kind =
    region.status === "outside" || region.status === "permissionDenied"
      ? region.status
      : "error";
  return (
    <View style={styles.center} testID={testID}>
      <AppText variant="heading" style={styles.title}>
        {t(`region.${kind}Title`)}
      </AppText>
      <AppText variant="body" tone="secondary" style={styles.body}>
        {t(`region.${kind}Body`)}
      </AppText>
      <PrimaryButton
        label={t("region.retry")}
        onPress={region.retry}
        testID={`${testID}-retry`}
      />
      {kind === "permissionDenied" ? (
        <TextButton
          label={t("region.openSettings")}
          onPress={region.openLocationSettings}
          testID={`${testID}-settings`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: { textAlign: "center" },
  body: { textAlign: "center" },
});
