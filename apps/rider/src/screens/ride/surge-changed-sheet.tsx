/**
 * "The price just went up / down" (PRC-02, UC-R-04 A2) — approved artboard
 * RiderSurgeChanged: booking answered 409 `surge_changed` because the pickup
 * zone's multiplier moved after the estimate. Nothing was booked; the sheet
 * shows the old estimate struck through against the refreshed one for the
 * selected service and lets the rider confirm at the new multiplier (books
 * again with it as `expectedSurgeMultiplier`) or go back to the options.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";

import {
  AppText,
  BottomSheet,
  PrimaryButton,
  SecondaryButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { formatMoney, formatSurge } from "../../ride/ride-format";
import { colors, radius, spacing } from "../../theme/tokens";

export interface SurgeChange {
  /** The multiplier the rider had been shown. */
  previous: number;
  /** The current multiplier — what "Confirm" books with. */
  next: number;
  /** The zone the demand change is in (null → "nearby"). */
  zone: string | null;
  /** Selected service's name in the app language. */
  serviceName: string;
  currency: string;
  /** The selected service's estimate total before / now (null = unknown). */
  previousTotal: number | null;
  nextTotal: number | null;
}

export function SurgeChangedSheet({
  change,
  confirming,
  onConfirm,
  onBack,
}: {
  change: SurgeChange | null;
  confirming: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  if (!change) return null;

  const up = change.next >= change.previous;
  const next = formatSurge(change.next, locale);
  const previous = formatSurge(change.previous, locale);
  const bodyKey = `booking.surgeChanged.${up ? "bodyUp" : "bodyDown"}${
    change.zone ? "" : "Nearby"
  }`;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onBack}
      testID="surge-changed-modal"
    >
      <View style={styles.backdrop}>
        <BottomSheet testID="surge-changed-sheet" style={styles.sheet}>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.chipRow, { flexDirection: row }]}>
              <View
                style={[styles.chip, { flexDirection: row }]}
                testID="surge-changed-chip"
              >
                <Ionicons
                  name={up ? "trending-up" : "trending-down"}
                  size={15}
                  color={colors.onAccent}
                />
                <AppText variant="bodyStrong" weight={800} tone="onAccent">
                  {next}
                </AppText>
              </View>
            </View>
            <AppText variant="title" testID="surge-changed-title" accessibilityRole="header">
              {t(
                up
                  ? "booking.surgeChanged.titleUp"
                  : "booking.surgeChanged.titleDown",
              )}
            </AppText>
            <AppText variant="body" tone="secondary" testID="surge-changed-body">
              {t(bodyKey, { zone: change.zone ?? "", next, previous })}
            </AppText>
            {change.nextTotal !== null ? (
              <View style={styles.compare} testID="surge-changed-compare">
                {change.previousTotal !== null ? (
                  <View style={[styles.compareLine, { flexDirection: row }]}>
                    <AppText
                      variant="secondary"
                      weight={600}
                      tone="muted"
                      style={styles.flex}
                    >
                      {t("booking.surgeChanged.before", {
                        name: change.serviceName,
                      })}
                    </AppText>
                    <AppText
                      variant="secondary"
                      weight={700}
                      tone="muted"
                      style={styles.struck}
                      testID="surge-changed-before"
                    >
                      {formatMoney(change.previousTotal, change.currency, locale, t)}
                    </AppText>
                  </View>
                ) : null}
                <View style={[styles.compareLine, { flexDirection: row }]}>
                  <AppText variant="bodyStrong" weight={800} style={styles.flex}>
                    {t("booking.surgeChanged.now", { name: change.serviceName })}
                  </AppText>
                  <AppText
                    variant="heading"
                    weight={800}
                    testID="surge-changed-now"
                  >
                    {formatMoney(change.nextTotal, change.currency, locale, t)}
                  </AppText>
                </View>
                <AppText variant="caption" tone="muted" weight={400}>
                  {t("booking.surgeChanged.lockNote", { multiplier: next })}
                </AppText>
              </View>
            ) : null}
          </ScrollView>
          <PrimaryButton
            label={t("booking.surgeChanged.confirm", { multiplier: next })}
            onPress={onConfirm}
            loading={confirming}
            testID="surge-changed-confirm"
          />
          <SecondaryButton
            label={t("booking.surgeChanged.back")}
            onPress={onBack}
            disabled={confirming}
            testID="surge-changed-back"
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
    backgroundColor: "rgba(20,16,24,0.42)",
  },
  sheet: {
    gap: 10,
  },
  content: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chipRow: {
    // The chip hugs the start edge in either direction.
    alignItems: "center",
  },
  chip: {
    height: 32,
    paddingHorizontal: spacing.md,
    borderRadius: 16,
    backgroundColor: colors.accent,
    alignItems: "center",
    gap: 6,
  },
  compare: {
    marginTop: 10,
    gap: 10,
    backgroundColor: colors.surfacePage,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  compareLine: {
    alignItems: "center",
    gap: spacing.md,
  },
  struck: {
    textDecorationLine: "line-through",
  },
  flex: {
    flex: 1,
  },
});
