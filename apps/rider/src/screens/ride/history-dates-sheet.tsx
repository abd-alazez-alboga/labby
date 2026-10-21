/**
 * "Show rides between" (approved artboard V1FRiderHistoryDates, W41): a
 * From and a To field side by side (the one being set outlined), a day
 * stepper for it (the RiderSchedWhen "Other date" stepper), the inclusive
 * note, "Show rides" and "Clear dates". An empty field means no limit;
 * tapping an empty field starts it at today. From never passes To: moving
 * one past the other carries the other along.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";

import {
  AppText,
  BottomSheet,
  PrimaryButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import {
  dayKey,
  type DayRange,
  formatFieldDay,
  shiftDay,
} from "../../ride/history-filters";
import { colors, radius, spacing, touchTarget } from "../../theme/tokens";
import { QuietLink } from "../trust/suspension-support";

type Side = "from" | "to";

function DateField({
  side,
  value,
  active,
  onPress,
}: {
  side: Side;
  value: string | null;
  active: boolean;
  onPress: () => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const label = t(`history.dates.${side}`);
  const text = value ? formatFieldDay(value, locale) : t("history.dates.empty");
  return (
    <View style={styles.field}>
      <AppText variant="label" weight={700}>
        {label}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} · ${text}`}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={[styles.box, { flexDirection: row }, active && styles.boxActive]}
        testID={`history-dates-${side}`}
      >
        <Ionicons name="calendar-outline" size={18} color={colors.text} />
        <AppText
          variant="bodyStrong"
          weight={700}
          tone={value ? "default" : "muted"}
          numberOfLines={1}
          style={styles.flex}
          testID={`history-dates-${side}-value`}
        >
          {text}
        </AppText>
      </Pressable>
    </View>
  );
}

function DatesSheetBody({
  initial,
  onApply,
}: {
  initial: DayRange;
  onApply: (range: DayRange) => void;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const [range, setRange] = useState<DayRange>(initial);
  const [side, setSide] = useState<Side>("from");

  const set = (which: Side, value: string) =>
    setRange((current) => {
      const next = { ...current, [which]: value };
      // Keep from <= to: the other end follows.
      if (next.from && next.to && next.from > next.to) {
        if (which === "from") next.to = value;
        else next.from = value;
      }
      return next;
    });

  const pick = (which: Side) => {
    setSide(which);
    if (!range[which]) set(which, dayKey(new Date()));
  };

  const step = (delta: number) =>
    set(side, shiftDay(range[side] ?? dayKey(new Date()), delta));

  const current = range[side];
  return (
    <BottomSheet testID="history-dates-sheet">
      <View style={styles.content}>
        <AppText variant="title" accessibilityRole="header">
          {t("history.dates.title")}
        </AppText>
        <View style={[styles.fields, { flexDirection: row }]}>
          <DateField
            side="from"
            value={range.from}
            active={side === "from"}
            onPress={() => pick("from")}
          />
          <DateField
            side="to"
            value={range.to}
            active={side === "to"}
            onPress={() => pick("to")}
          />
        </View>
        <View style={[styles.stepper, { flexDirection: row }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("scheduled.previousDay")}
            onPress={() => step(-1)}
            style={styles.stepButton}
            testID="history-dates-prev"
          >
            <Ionicons name="remove" size={22} color={colors.text} />
          </Pressable>
          <AppText
            variant="bodyStrong"
            weight={800}
            align="center"
            style={styles.flex}
            testID="history-dates-day"
          >
            {current
              ? formatFieldDay(current, locale)
              : t("history.dates.empty")}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("scheduled.nextDay")}
            onPress={() => step(1)}
            style={styles.stepButton}
            testID="history-dates-next"
          >
            <Ionicons name="add" size={22} color={colors.text} />
          </Pressable>
        </View>
        <AppText variant="caption" tone="muted" weight={400}>
          {t("history.dates.note")}
        </AppText>
      </View>
      <PrimaryButton
        label={t("history.dates.apply")}
        onPress={() => onApply(range)}
        testID="history-dates-apply"
      />
      <QuietLink
        label={t("history.dates.clear")}
        onPress={() => onApply({ from: null, to: null })}
        testID="history-dates-sheet-clear"
      />
    </BottomSheet>
  );
}

export function HistoryDatesSheet({
  visible,
  initial,
  onApply,
  onClose,
}: {
  visible: boolean;
  initial: DayRange;
  onApply: (range: DayRange) => void;
  onClose: () => void;
}) {
  const { t } = useLocale();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="history-dates-modal"
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.flex}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        />
        {/* Re-mounted per opening: the fields start from the applied range. */}
        {visible ? (
          <DatesSheetBody initial={initial} onApply={onApply} />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(20,16,24,0.36)",
  },
  flex: {
    flex: 1,
  },
  content: {
    gap: 18,
  },
  fields: {
    gap: spacing.md,
  },
  field: {
    flex: 1,
    gap: spacing.sm,
  },
  box: {
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: colors.surfaceFill,
  },
  boxActive: {
    borderColor: colors.text,
  },
  stepper: {
    alignItems: "center",
    gap: spacing.md,
  },
  stepButton: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: touchTarget / 2,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    alignItems: "center",
    justifyContent: "center",
  },
});
