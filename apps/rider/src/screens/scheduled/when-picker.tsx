/**
 * Pickup / departure time sheet (approved artboard RiderSchedWhen): day
 * chips (Today, Tomorrow, the day after, "Other date" — a day stepper with
 * no horizon limit, RIDE-S1) and an hour : minute wheel (5-minute steps;
 * tap a neighbour or use the accessibility increment / decrement). The
 * notes under the wheel and the two actions come from the caller.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  AppText,
  BottomSheet,
  PrimaryButton,
  TextButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { dayOffset, formatDayLabel } from "../../ride/schedule-format";
import { colors, radius, spacing } from "../../theme/tokens";

const MINUTE_STEP = 5;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

/** The first 5-minute mark at least `leadMinutes` from now. */
export function earliestSlot(leadMinutes: number, now: Date = new Date()): Date {
  const slot = new Date(now.getTime() + leadMinutes * 60 * 1000);
  slot.setSeconds(0, 0);
  const rest = slot.getMinutes() % MINUTE_STEP;
  if (rest) slot.setMinutes(slot.getMinutes() + (MINUTE_STEP - rest));
  return slot;
}

function compose(now: Date, offset: number, hour: number, minute: number): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function Wheel({
  values,
  value,
  onChange,
  label,
  testID,
}: {
  values: number[];
  value: number;
  onChange: (next: number) => void;
  label: string;
  testID: string;
}) {
  const index = Math.max(0, values.indexOf(value));
  const at = (delta: number) =>
    values[(index + delta + values.length * 3) % values.length];
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: pad(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) =>
        onChange(at(event.nativeEvent.actionName === "increment" ? 1 : -1))
      }
      style={styles.wheel}
      testID={testID}
    >
      {[-2, -1, 0, 1, 2].map((delta) => {
        const item = at(delta);
        const far = Math.abs(delta) === 2;
        if (far) {
          // Context only: the outer values are not touch targets.
          return (
            <View key={delta} style={styles.wheelFar}>
              <AppText variant="bodyStrong" weight={600} tone="muted" align="center" style={styles.far}>
                {pad(item)}
              </AppText>
            </View>
          );
        }
        return (
          <Pressable
            key={delta}
            onPress={() => onChange(item)}
            disabled={delta === 0}
            style={delta === 0 ? styles.wheelSelected : styles.wheelItem}
            testID={delta === 0 ? `${testID}-value` : `${testID}-${delta > 0 ? "next" : "prev"}`}
          >
            <AppText
              variant={delta === 0 ? "display" : "heading"}
              weight={delta === 0 ? 800 : 600}
              tone={delta === 0 ? "default" : "muted"}
              align="center"
            >
              {pad(item)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export interface WhenNote {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}

function WhenPickerBody({
  title,
  initial,
  notes,
  submitLabel,
  onSubmit,
  secondaryLabel,
  onSecondary,
  testID = "when-picker",
}: {
  title: string;
  /** Preselected time (rounded to the wheel's 5-minute steps). */
  initial: Date;
  notes: WhenNote[];
  /** The primary label for the chosen time, e.g. "Pick up tomorrow · 09:00". */
  submitLabel: (chosen: Date) => string;
  onSubmit: (chosen: Date) => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  testID?: string;
}) {
  const { t, locale } = useLocale();
  const { row } = useDirection();
  const [now] = useState(() => new Date());
  const [start] = useState(() => {
    const first = new Date(initial);
    const rest = first.getMinutes() % MINUTE_STEP;
    if (rest) first.setMinutes(first.getMinutes() + (MINUTE_STEP - rest));
    return first;
  });
  const startOffset = Math.max(0, dayOffset(start, now));
  const [offset, setOffset] = useState(startOffset);
  const [hour, setHour] = useState(start.getHours());
  const [minute, setMinute] = useState(start.getMinutes());
  const [otherDate, setOtherDate] = useState(startOffset > 2);

  const chosen = compose(now, offset, hour, minute);
  const chips = [0, 1, 2];

  return (
    <>
      <BottomSheet testID={testID}>
        <ScrollView contentContainerStyle={styles.content}>
          <AppText variant="title">{title}</AppText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.chips, { flexDirection: row }]}
          >
            {chips.map((day) => {
              const selected = !otherDate && offset === day;
              return (
                <Pressable
                  key={day}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setOtherDate(false);
                    setOffset(day);
                  }}
                  style={[styles.chip, selected && styles.chipOn]}
                  testID={`${testID}-day-${day}`}
                >
                  <AppText
                    variant="label"
                    weight={selected ? 800 : 700}
                    tone={selected ? "onAccent" : "default"}
                  >
                    {formatDayLabel(
                      compose(now, day, 12, 0),
                      locale,
                      t,
                      now,
                    )}
                  </AppText>
                </Pressable>
              );
            })}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: otherDate }}
              onPress={() => {
                setOtherDate(true);
                if (offset < 3) setOffset(3);
              }}
              style={[styles.chip, otherDate && styles.chipOn]}
              testID={`${testID}-other-date`}
            >
              <AppText
                variant="label"
                weight={otherDate ? 800 : 700}
                tone={otherDate ? "onAccent" : "default"}
              >
                {t("scheduled.otherDate")}
              </AppText>
            </Pressable>
          </ScrollView>

          {otherDate ? (
            <View style={[styles.stepper, { flexDirection: row }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("scheduled.previousDay")}
                onPress={() => setOffset((value) => Math.max(0, value - 1))}
                style={styles.stepButton}
                testID={`${testID}-day-prev`}
              >
                <Ionicons name="remove" size={22} color={colors.text} />
              </Pressable>
              <AppText
                variant="bodyStrong"
                weight={800}
                align="center"
                style={styles.flex}
                testID={`${testID}-day-label`}
              >
                {formatDayLabel(compose(now, offset, 12, 0), locale, t, now)}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("scheduled.nextDay")}
                onPress={() => setOffset((value) => value + 1)}
                style={styles.stepButton}
                testID={`${testID}-day-next`}
              >
                <Ionicons name="add" size={22} color={colors.text} />
              </Pressable>
            </View>
          ) : null}

          {/* Clock wheels stay left-to-right in both languages (HH:mm). */}
          <View style={styles.wheels}>
            <View style={styles.band} />
            <Wheel
              values={HOURS}
              value={hour}
              onChange={setHour}
              label={t("scheduled.hour")}
              testID={`${testID}-hour`}
            />
            <AppText variant="display" weight={800}>
              :
            </AppText>
            <Wheel
              values={MINUTES}
              value={minute}
              onChange={setMinute}
              label={t("scheduled.minute")}
              testID={`${testID}-minute`}
            />
          </View>

          {notes.length ? (
            <View style={styles.notes}>
              {notes.map((note) => (
                <View
                  key={note.text}
                  style={[styles.note, { flexDirection: row }]}
                >
                  <Ionicons
                    name={note.icon}
                    size={18}
                    color={colors.textSecondary}
                  />
                  <AppText
                    variant="caption"
                    weight={400}
                    tone="secondary"
                    style={styles.flex}
                  >
                    {note.text}
                  </AppText>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
        <PrimaryButton
          label={submitLabel(chosen)}
          onPress={() => onSubmit(chosen)}
          testID={`${testID}-submit`}
        />
        {secondaryLabel && onSecondary ? (
          <TextButton
            label={secondaryLabel}
            onPress={onSecondary}
            testID={`${testID}-secondary`}
          />
        ) : null}
      </BottomSheet>
    </>
  );
}

export function WhenPicker({
  visible,
  onClose,
  testID = "when-picker",
  ...props
}: {
  visible: boolean;
  title: string;
  /** Preselected time (rounded to the wheel's 5-minute steps). */
  initial: Date;
  notes: WhenNote[];
  /** The primary label for the chosen time, e.g. "Pick up tomorrow · 09:00". */
  submitLabel: (chosen: Date) => string;
  onSubmit: (chosen: Date) => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  onClose: () => void;
  testID?: string;
}) {
  const { t } = useLocale();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID={`${testID}-modal`}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={styles.dismissArea}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("common.back")}
        />
        {/* Re-mounted per opening: the wheels start from `initial`. */}
        {visible ? <WhenPickerBody {...props} testID={testID} /> : null}
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
  dismissArea: {
    flex: 1,
  },
  content: {
    gap: spacing.lg,
  },
  chips: {
    gap: spacing.sm,
  },
  chip: {
    height: 48,
    paddingHorizontal: spacing.lg,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: colors.grabHandle,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  chipOn: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  stepper: {
    alignItems: "center",
    gap: spacing.md,
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
  wheels: {
    flexDirection: "row",
    direction: "ltr",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
    height: 188,
  },
  band: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 70,
    height: 48,
    borderRadius: radius.md - 2,
    backgroundColor: colors.surfaceFill,
  },
  wheel: {
    width: 96,
    alignItems: "center",
  },
  wheelItem: {
    height: 48,
    minWidth: 64,
    justifyContent: "center",
  },
  wheelFar: {
    height: 22,
    justifyContent: "center",
  },
  wheelSelected: {
    height: 48,
    justifyContent: "center",
  },
  far: {
    opacity: 0.5,
  },
  notes: {
    gap: 10,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
  },
  note: {
    alignItems: "flex-start",
    gap: 10,
  },
  flex: {
    flex: 1,
  },
});
