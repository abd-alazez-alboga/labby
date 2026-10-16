/**
 * Pieces shared by the shared-ride screens (approved canvas page "M12
 * rider"): the seat dots of a browse card, the segmented occupancy bar of
 * the member / creator views, the departure wording and the per-seat
 * basis (estimate ÷ seats that would board — RIDE-P4; the real split is
 * made at completion over the boarded seats).
 */
import type { TranslateOptions } from "i18n-js";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Departure } from "../../api/scheduled-shared";
import { AppText, useDirection } from "../../components/ui";
import type { AppLocale } from "../../i18n/translations";
import { formatClock } from "../../ride/ride-format";
import { dayOffset, formatScheduleDay } from "../../ride/schedule-format";
import { colors } from "../../theme/tokens";

type T = (key: string, options?: TranslateOptions) => string;

export function SeatDots({
  taken,
  total,
  size = 18,
  testID,
}: {
  taken: number;
  total: number;
  size?: number;
  testID?: string;
}) {
  const { row } = useDirection();
  return (
    <View
      style={[styles.dots, { flexDirection: row }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[
            { width: size, height: size, borderRadius: size > 16 ? 5 : 4 },
            i < taken ? styles.taken : styles.free,
          ]}
        />
      ))}
    </View>
  );
}

export function OccupancyBar({
  taken,
  total,
  testID,
}: {
  taken: number;
  total: number;
  testID?: string;
}) {
  const { row } = useDirection();
  return (
    <View
      style={[styles.bar, { flexDirection: row }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID={testID}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={[styles.segment, i < taken ? styles.taken : styles.dashed]}
        />
      ))}
    </View>
  );
}

/** A labelled − value + row (party size, seats); 48 px round buttons. */
export function Stepper({
  title,
  hint,
  value,
  min,
  max,
  onChange,
  decreaseLabel,
  increaseLabel,
  testID,
}: {
  title: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
  decreaseLabel: string;
  increaseLabel: string;
  testID: string;
}) {
  const { row } = useDirection();
  const canDecrease = value > min;
  const canIncrease = value < max;
  return (
    <View style={[styles.stepper, { flexDirection: row }]} testID={testID}>
      <View style={styles.flex}>
        <AppText variant="bodyStrong" weight={800}>
          {title}
        </AppText>
        <AppText variant="caption" weight={400} tone="secondary">
          {hint}
        </AppText>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={decreaseLabel}
        accessibilityState={{ disabled: !canDecrease }}
        disabled={!canDecrease}
        onPress={() => onChange(value - 1)}
        style={[styles.stepButton, !canDecrease && styles.stepOff]}
        testID={`${testID}-decrease`}
      >
        <Ionicons
          name="remove"
          size={22}
          color={canDecrease ? colors.text : colors.lineStrong}
        />
      </Pressable>
      <AppText
        variant="heading"
        weight={800}
        align="center"
        style={styles.stepValue}
        testID={`${testID}-value`}
      >
        {String(value)}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={increaseLabel}
        accessibilityState={{ disabled: !canIncrease }}
        disabled={!canIncrease}
        onPress={() => onChange(value + 1)}
        style={[styles.stepButton, !canIncrease && styles.stepOff]}
        testID={`${testID}-increase`}
      >
        <Ionicons
          name="add"
          size={22}
          color={canIncrease ? colors.text : colors.lineStrong}
        />
      </Pressable>
    </View>
  );
}

/** "17:30" today, else "Tomorrow · 17:30" / "Sat 18 Oct · 17:30". */
export function departureWhen(iso: string, locale: AppLocale, t: T): string {
  return dayOffset(new Date(iso), new Date()) === 0
    ? formatClock(iso, locale)
    : formatScheduleDay(iso, locale, t);
}

/** "Leaves 17:30" / "Leaves when full" (browse cards). */
export function departureShort(
  departure: Departure,
  locale: AppLocale,
  t: T,
): string {
  if (departure.mode === "at_time" && departure.departAt) {
    return t("shared.leavesAt", {
      time: departureWhen(departure.departAt, locale, t),
    });
  }
  return t("shared.leavesWhenFull");
}

/** The departure rule of the join / member views. */
export function departureRule(
  departure: Departure,
  locale: AppLocale,
  t: T,
): string {
  if (departure.mode === "at_time" && departure.departAt) {
    return t("shared.departAtRule", {
      time: departureWhen(departure.departAt, locale, t),
    });
  }
  if (departure.expiresAt) {
    return t("shared.whenFullRule", {
      when: formatScheduleDay(departure.expiresAt, locale, t, new Date(), true),
    });
  }
  return t("shared.leavesWhenFull");
}

/** "Leaves at 17:30" / "Leaves when full" as a value in a fact row. */
export function departureValue(
  departure: Departure,
  locale: AppLocale,
  t: T,
): string {
  if (departure.mode === "at_time" && departure.departAt) {
    return t("shared.leavesAtValue", {
      time: departureWhen(departure.departAt, locale, t),
    });
  }
  return t("shared.leavesWhenFull");
}

/** The per-seat basis if `seats` board: the estimate ÷ seats (2 dp). */
export function perSeat(estimateTotal: number, seats: number): number {
  if (seats <= 0) return estimateTotal;
  return Math.round((estimateTotal / seats) * 100) / 100;
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  stepper: {
    alignItems: "center",
    gap: 12,
    minHeight: 60,
  },
  stepButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    alignItems: "center",
    justifyContent: "center",
  },
  stepOff: {
    borderColor: colors.line,
  },
  stepValue: {
    width: 28,
  },
  dots: {
    gap: 4,
  },
  taken: {
    backgroundColor: colors.accent,
  },
  free: {
    borderWidth: 2,
    borderColor: colors.grabHandle,
  },
  bar: {
    gap: 6,
  },
  segment: {
    flex: 1,
    height: 28,
    borderRadius: 8,
  },
  dashed: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: colors.lineStrong,
  },
});
