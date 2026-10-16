/**
 * Small pieces shared by the scheduled-ride screens (approved artboards
 * RiderSchedUpcoming / RiderSchedDetail): the claim-status chip (filled
 * accent once a driver claimed it, neutral while waiting) and the claiming
 * driver's card.
 */
import type { TranslateOptions } from "i18n-js";
import React from "react";
import { StyleSheet, View } from "react-native";

import type { DriverSummary } from "../../api/rides";
import type { ClaimState } from "../../api/scheduled-shared";
import { AppText, useDirection } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatRating } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

export function ClaimChip({
  claimState,
  testID,
}: {
  claimState: ClaimState;
  testID?: string;
}) {
  const { t } = useLocale();
  const claimed = claimState === "claimed";
  return (
    <View style={[styles.chip, claimed ? styles.chipOn : styles.chipOff]} testID={testID}>
      <AppText
        variant="caption"
        weight={800}
        tone={claimed ? "onAccent" : "secondary"}
      >
        {claimed ? t("scheduled.claimed") : t("scheduled.open")}
      </AppText>
    </View>
  );
}

/** "Samer · 4.9" + vehicle (+ plate when `withPlate`). */
export function driverLine(
  driver: DriverSummary,
  locale: "en" | "ar",
  t: (key: string, options?: TranslateOptions) => string,
  withPlate = false,
): { name: string; vehicle: string } {
  const rating =
    driver.rating != null ? ` · ${formatRating(driver.rating, locale)}` : "";
  const vehicle = t("ride.vehicle", {
    color: driver.vehicle.color,
    make: driver.vehicle.make,
    model: driver.vehicle.model,
  });
  return {
    name: `${driver.firstName}${rating}`,
    vehicle: withPlate ? `${vehicle} · ${driver.vehicle.plate}` : vehicle,
  };
}

export function DriverInitial({
  name,
  size = 48,
}: {
  name: string;
  size?: number;
}) {
  return (
    <View
      style={[
        styles.initial,
        { width: size, height: size, borderRadius: size / 2 },
      ]}
    >
      <AppText variant="bodyStrong" weight={800} tone="accent">
        {name.trim().charAt(0).toUpperCase()}
      </AppText>
    </View>
  );
}

export function DriverCard({
  driver,
  testID,
}: {
  driver: DriverSummary;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const line = driverLine(driver, locale, t, true);
  return (
    <View style={[styles.card, { flexDirection: row }]} testID={testID}>
      <DriverInitial name={driver.firstName} />
      <View style={styles.flex}>
        <AppText variant="bodyStrong" weight={800}>
          {line.name}
        </AppText>
        <AppText variant="caption" weight={400} tone="secondary">
          {line.vehicle}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    justifyContent: "center",
  },
  chipOn: {
    backgroundColor: colors.accent,
  },
  chipOff: {
    backgroundColor: colors.surfaceFill,
  },
  initial: {
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceFill,
  },
  flex: {
    flex: 1,
    gap: 2,
  },
});
