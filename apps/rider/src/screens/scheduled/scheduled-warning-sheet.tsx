/**
 * "You have a ride scheduled at 09:00 — keep it?" (owner ruling 2026-10-16,
 * approved artboard RiderSchedWarn): shown before an on-demand booking when
 * one of the rider's scheduled rides is due within 60 min. Keeping it books
 * now anyway (if the rider is still riding when it is due, the backend
 * cancels the scheduled one free, reason `rider_busy`); "Cancel … first"
 * opens the free scheduled cancel and then books.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, StyleSheet, View } from "react-native";

import type { Ride } from "../../api/rides";
import {
  AppText,
  BottomSheet,
  PrimaryButton,
  SecondaryButton,
  TextButton,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatClock, placeLabel } from "../../ride/ride-format";
import { formatScheduleDay } from "../../ride/schedule-format";
import { colors, radius, spacing } from "../../theme/tokens";

export function ScheduledWarningSheet({
  ride,
  visible,
  onKeep,
  onCancelFirst,
  onBack,
}: {
  ride: Ride | null;
  visible: boolean;
  onKeep: () => void;
  onCancelFirst: () => void;
  onBack: () => void;
}) {
  const { t, locale } = useLocale();
  if (!ride?.scheduled) return null;
  const at = ride.scheduled.scheduledAt;
  const time = formatClock(at, locale);
  const status =
    ride.scheduled.claimState === "claimed"
      ? ride.scheduled.claimedBy?.firstName
        ? `${t("scheduled.claimed")} · ${ride.scheduled.claimedBy.firstName}`
        : t("scheduled.claimed")
      : t("scheduled.open");
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onBack}
      testID="scheduled-warning-modal"
    >
      <View style={styles.backdrop}>
        <View style={styles.flex} />
        <BottomSheet testID="scheduled-warning">
          <View style={styles.iconWell}>
            <Ionicons name="calendar-outline" size={26} color={colors.accent} />
          </View>
          <AppText variant="title" testID="scheduled-warning-title">
            {t("scheduled.warnTitle", { time })}
          </AppText>
          <View style={styles.rideBox}>
            <AppText variant="bodyStrong" weight={800}>
              {t("scheduled.warnRide", {
                when: formatScheduleDay(at, locale, t),
                place: placeLabel(ride.destination),
              })}
            </AppText>
            <AppText variant="caption" weight={400} tone="secondary">
              {status}
            </AppText>
          </View>
          <AppText variant="secondary" tone="secondary">
            {t("scheduled.warnBody")}
          </AppText>
          <PrimaryButton
            label={t("scheduled.warnKeep")}
            onPress={onKeep}
            testID="scheduled-warning-keep"
          />
          <SecondaryButton
            label={t("scheduled.warnCancelFirst", { time })}
            onPress={onCancelFirst}
            testID="scheduled-warning-cancel"
          />
          <TextButton
            label={t("common.back")}
            onPress={onBack}
            testID="scheduled-warning-back"
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
  flex: {
    flex: 1,
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  rideBox: {
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
});
