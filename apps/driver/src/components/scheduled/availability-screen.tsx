import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, StyleSheet, View } from "react-native";

import {
  getAvailabilityWindows,
  putAvailabilityWindows,
} from "../../api/scheduled";
import {
  DAYS_OF_WEEK,
  MAX_AVAILABILITY_WINDOWS,
} from "../../api/scheduled-types";
import type {
  AvailabilityWindow,
  DayOfWeek,
} from "../../api/scheduled-types";
import { failureKindOf } from "../../onboarding/server-errors";
import type { FailureKind } from "../../onboarding/server-errors";
import { isolateDigits } from "../../money/format";
import { formatNumber } from "../../rides/format";
import {
  ALL_DAY_TIME,
  dateAt,
  isAllDay,
  isDuplicate,
  sameSet,
  spansMidnight,
  sortWindows,
  timeOf,
  windowsOn,
  withoutWindow,
} from "../../scheduled/windows";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  CheckboxRow,
  FailureState,
  FieldLabel,
  Icon,
  LoadingState,
  OutlineButton,
  PrimaryButton,
  Screen,
  TextButton,
  useDirection,
  useSafeBottomBar,
} from "../ui";

type Load =
  | { status: "loading" }
  | { status: "loaded" }
  | { status: "error"; kind: FailureKind };

type SaveState = "idle" | "saving" | "saved" | "invalid" | FailureKind;

/**
 * "07:00–12:00" with Western digits, or "All day". In Arabic the range sits
 * in an LTR isolate (W21, board D12AvailabilityAr) so the bidi algorithm
 * never shows it reversed — alone or inside the next-day variant.
 */
export function windowLabel(
  t: (key: string) => string,
  window: AvailabilityWindow,
  language: string,
): string {
  if (isAllDay(window)) return t("scheduled.availability.allDay");
  return isolateDigits(`${window.startsAt}–${window.endsAt}`, language);
}

/** A time field that opens the platform time picker (24 h). */
function TimeField({
  label,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const { language } = useDirection();
  const [open, setOpen] = useState(false);

  const handlePress = () => {
    if (disabled) return;
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: dateAt(value),
        mode: "time",
        is24Hour: true,
        onValueChange: (_event, date) => onChange(timeOf(date)),
      });
    } else {
      setOpen((current) => !current);
    }
  };

  return (
    <View style={styles.timeField}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} ${value}`}
        accessibilityState={{ disabled: !!disabled }}
        onPress={handlePress}
        style={[styles.timeBox, open && styles.timeBoxOpen, disabled && styles.disabled]}
        testID={testID}
      >
        <AppText variant="label" color={colors.textSecondary}>
          {label}
        </AppText>
        <AppText style={styles.timeValue} testID={`${testID}-value`}>
          {value}
        </AppText>
      </Pressable>
      {open && Platform.OS !== "android" ? (
        <View>
          <DateTimePicker
            testID={`${testID}-picker`}
            value={dateAt(value)}
            mode="time"
            display="spinner"
            is24Hour
            locale={language === "ar" ? "ar-u-nu-latn" : "en-GB"}
            onValueChange={(_event, date) => onChange(timeOf(date))}
          />
          <TextButton
            title={t("onboarding.actions.done")}
            onPress={() => setOpen(false)}
            testID={`${testID}-done`}
          />
        </View>
      ) : null}
    </View>
  );
}

/** Artboard "Add a window": From / Until, All day, the past-midnight hint. */
function AddWindowSheet({
  day,
  existing,
  onAdd,
  onClose,
}: {
  day: DayOfWeek;
  existing: readonly AvailabilityWindow[];
  onAdd: (window: AvailabilityWindow) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const bottom = useSafeBottomBar();
  const [startsAt, setStartsAt] = useState("08:00");
  const [endsAt, setEndsAt] = useState("12:00");
  const [allDay, setAllDay] = useState(false);
  const candidate: AvailabilityWindow = allDay
    ? { dayOfWeek: day, startsAt: ALL_DAY_TIME, endsAt: ALL_DAY_TIME }
    : { dayOfWeek: day, startsAt, endsAt };
  const duplicate = isDuplicate(existing, candidate);
  const dayName = t(`scheduled.days.${day}`);
  const nextDay = t(`scheduled.days.${day === 7 ? 1 : day + 1}`);

  return (
    <View style={styles.overlay} testID="add-window-sheet">
      <Pressable
        style={styles.backdrop}
        accessibilityRole="button"
        accessibilityLabel={t("scheduled.availability.cancelAdd")}
        onPress={onClose}
        testID="add-window-backdrop"
      />
      <View style={[styles.sheet, { paddingBottom: bottom }]}>
        <View style={styles.handle} />
        <AppText variant="heading" testID="add-window-title">
          {t("scheduled.availability.addTitle", { day: dayName })}
        </AppText>
        <View style={[styles.timeRow, flipRows && styles.rowReverse]}>
          <TimeField
            label={t("scheduled.availability.from")}
            value={allDay ? ALL_DAY_TIME : startsAt}
            onChange={setStartsAt}
            disabled={allDay}
            testID="add-window-from"
          />
          <TimeField
            label={t("scheduled.availability.until")}
            value={allDay ? ALL_DAY_TIME : endsAt}
            onChange={setEndsAt}
            disabled={allDay}
            testID="add-window-until"
          />
        </View>
        {!allDay && startsAt !== endsAt && spansMidnight(candidate) ? (
          <Banner
            tone="neutral"
            message={t("scheduled.availability.pastMidnight", {
              day: dayName,
              nextDay,
              time: endsAt,
            })}
            testID="add-window-midnight"
          />
        ) : null}
        {!allDay && startsAt === endsAt ? (
          <Banner
            tone="neutral"
            message={t("scheduled.availability.sameTimes")}
            testID="add-window-same"
          />
        ) : null}
        <CheckboxRow
          label={t("scheduled.availability.allDay")}
          checked={allDay}
          onToggle={() => setAllDay((current) => !current)}
          testID="add-window-all-day"
        />
        {duplicate ? (
          <Banner
            tone="danger"
            message={t("scheduled.availability.duplicate")}
            testID="add-window-duplicate"
          />
        ) : null}
        <View style={styles.buttons}>
          <PrimaryButton
            title={t("scheduled.availability.add")}
            size="large"
            onPress={() => onAdd(candidate)}
            disabled={duplicate}
            testID="add-window-confirm"
          />
          <OutlineButton
            title={t("scheduled.availability.cancelAdd")}
            onPress={onClose}
            testID="add-window-cancel"
          />
        </View>
      </View>
    </View>
  );
}

function DayRow({
  day,
  windows,
  canAdd,
  onAdd,
  onRemove,
  last,
}: {
  day: DayOfWeek;
  windows: AvailabilityWindow[];
  canAdd: boolean;
  onAdd: () => void;
  onRemove: (window: AvailabilityWindow) => void;
  last: boolean;
}) {
  const { t } = useTranslation();
  const { flipRows, language } = useDirection();
  const dayName = t(`scheduled.days.${day}`);
  return (
    <View
      style={[styles.dayRow, !last && styles.divider, flipRows && styles.rowReverse]}
      testID={`day-row-${day}`}
    >
      <AppText variant="bodyStrong" weight="800" style={styles.dayName}>
        {dayName}
      </AppText>
      <View style={[styles.chips, flipRows && styles.rowReverse]}>
        {windows.length === 0 ? (
          <AppText
            variant="secondary"
            color={colors.textMuted}
            style={styles.none}
            testID={`day-none-${day}`}
          >
            {t("scheduled.availability.notAvailable")}
          </AppText>
        ) : null}
        {windows.map((window) => {
          const label = windowLabel(t, window, language);
          const id = `${day}-${window.startsAt}-${window.endsAt}`;
          return (
            <View
              key={id}
              style={[styles.chip, flipRows && styles.rowReverse]}
              testID={`window-chip-${id}`}
            >
              <AppText variant="label" weight="800" color={colors.accentPressed}>
                {spansMidnight(window)
                  ? t("scheduled.availability.withNextDay", { range: label })
                  : label}
              </AppText>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("scheduled.availability.remove", {
                  day: dayName,
                  range: label,
                })}
                onPress={() => onRemove(window)}
                style={styles.chipRemove}
                testID={`window-remove-${id}`}
              >
                <Icon name="close" size={18} color={colors.accent} />
              </Pressable>
            </View>
          );
        })}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("scheduled.availability.addFor", { day: dayName })}
        accessibilityState={{ disabled: !canAdd }}
        onPress={() => {
          if (canAdd) onAdd();
        }}
        style={[styles.addButton, !canAdd && styles.disabled]}
        testID={`add-window-${day}`}
      >
        <Icon name="add" size={22} color={colors.accent} />
      </Pressable>
    </View>
  );
}

/**
 * UC-D-05 (DRV-05), artboards "Availability" (EN + AR): the recurring
 * weekly windows, Monday first (owner 2026-10-16). Each day lists its
 * ranges as removable chips with a "+" to add one; Save replaces the whole
 * set (`PUT /driver/availability-windows`). The windows gate the claim
 * board only — never live offers — and a change never drops a claim.
 */
export function AvailabilityScreen() {
  const { t } = useTranslation();
  const { language } = useDirection();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [saved, setSaved] = useState<AvailabilityWindow[]>([]);
  const [draft, setDraft] = useState<AvailabilityWindow[]>([]);
  const [adding, setAdding] = useState<DayOfWeek | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchWindows = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const result = await getAvailabilityWindows();
      if (!mounted.current) return;
      const windows = sortWindows(result.windows);
      setSaved(windows);
      setDraft(windows);
      setLoad({ status: "loaded" });
    } catch (caught) {
      if (mounted.current)
        setLoad({ status: "error", kind: failureKindOf(caught) });
    }
  }, []);

  useEffect(() => {
    void fetchWindows();
  }, [fetchWindows]);

  const dirty = !sameSet(saved, draft);
  const full = draft.length >= MAX_AVAILABILITY_WINDOWS;

  const onSave = async () => {
    setSave("saving");
    try {
      const result = await putAvailabilityWindows({ windows: sortWindows(draft) });
      if (!mounted.current) return;
      const windows = sortWindows(result.windows);
      setSaved(windows);
      setDraft(windows);
      setSave("saved");
    } catch (caught) {
      if (!mounted.current) return;
      const kind = failureKindOf(caught);
      const status = (caught as { status?: number }).status;
      setSave(kind === "server" && status === 400 ? "invalid" : kind);
    }
  };

  const edit = (next: AvailabilityWindow[]) => {
    setDraft(sortWindows(next));
    setSave("idle");
  };

  return (
    <View style={styles.fill}>
      <Screen
        title={t("scheduled.availability.title")}
        testID="availability-screen"
        footer={
          load.status === "loaded" ? (
            <>
              {save === "saved" ? (
                <Banner
                  tone="success"
                  message={t("scheduled.availability.saved")}
                  testID="availability-saved"
                />
              ) : null}
              {save === "invalid" ? (
                <Banner
                  tone="danger"
                  message={t("scheduled.availability.invalid")}
                  testID="availability-invalid"
                />
              ) : null}
              {save === "network" || save === "server" ? (
                <Banner
                  tone="danger"
                  message={t(`ride.errors.${save}`)}
                  testID={`availability-save-${save}`}
                />
              ) : null}
              <PrimaryButton
                title={t("scheduled.availability.save")}
                size="large"
                onPress={() => void onSave()}
                disabled={!dirty}
                busy={save === "saving"}
                testID="availability-save"
              />
            </>
          ) : undefined
        }
      >
        <AppText color={colors.textSecondary}>
          {t("scheduled.availability.intro")}
        </AppText>
        {load.status === "loading" ? (
          <LoadingState testID="availability-loading" />
        ) : null}
        {load.status === "error" ? (
          <FailureState
            kind={load.kind}
            onRetry={() => void fetchWindows()}
            testID="availability-error"
          />
        ) : null}
        {load.status === "loaded" ? (
          <>
            <View>
              {DAYS_OF_WEEK.map((day, index) => (
                <DayRow
                  key={day}
                  day={day}
                  windows={windowsOn(draft, day)}
                  canAdd={!full}
                  onAdd={() => setAdding(day)}
                  onRemove={(window) => edit(withoutWindow(draft, window))}
                  last={index === DAYS_OF_WEEK.length - 1}
                />
              ))}
            </View>
            {full ? (
              <Banner
                tone="neutral"
                message={t("scheduled.availability.full", {
                  max: formatNumber(MAX_AVAILABILITY_WINDOWS, language),
                })}
                testID="availability-full"
              />
            ) : null}
            <FieldLabel>{t("scheduled.availability.zoneNote")}</FieldLabel>
          </>
        ) : null}
      </Screen>
      {adding !== null ? (
        <AddWindowSheet
          day={adding}
          existing={draft}
          onAdd={(window) => {
            edit([...draft, window]);
            setAdding(null);
          }}
          onClose={() => setAdding(null)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  rowReverse: { flexDirection: "row-reverse" },
  dayRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 10,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  dayName: { width: 92, paddingTop: 12 },
  chips: { flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  none: { paddingTop: 12 },
  chip: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingStart: spacing.ms,
    borderRadius: radius.chip,
    backgroundColor: colors.accentTint,
  },
  chipRemove: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.lavender300,
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: { opacity: 0.4 },
  overlay: { ...StyleSheet.absoluteFill, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.shadow,
    opacity: 0.48,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: spacing.ml,
    gap: 14,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
  },
  timeRow: { flexDirection: "row", gap: 10 },
  timeField: { flex: 1 },
  timeBox: {
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    paddingHorizontal: 14,
    justifyContent: "center",
    gap: 2,
  },
  timeBoxOpen: { borderWidth: 2, borderColor: colors.text },
  timeValue: { fontSize: 26, lineHeight: 32, fontWeight: "800" },
  buttons: { gap: 10 },
});
