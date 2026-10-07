import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, {
  DateTimePickerAndroid,
} from "@react-native-community/datetimepicker";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, Platform, Pressable, StyleSheet, View } from "react-native";

import {
  formatDate,
  fromIsoDate,
  toIsoDate,
  tomorrow,
} from "../../onboarding/dates";
import type { PickedFile } from "../../onboarding/drafts";
import { colors, radius, spacing } from "../../theme/tokens";
import {
  AppText,
  FieldError,
  FieldLabel,
  fieldStyles,
  Icon,
  TextButton,
  useDirection,
} from "../ui";

/**
 * Onboarding-only building blocks (wizard progress, file preview, the
 * expiry-date field). Everything generic lives in components/ui.
 */

/** "Step 2 of 8" + a progress bar + the step's display title. */
export function StepProgress({
  current,
  total,
  title,
}: {
  current: number;
  total: number;
  title: string;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View style={styles.progress} testID="wizard-progress">
      <AppText
        variant="caption"
        color={colors.textMuted}
        testID="wizard-step-count"
      >
        {t("onboarding.wizard.stepOf", { current, total })}
      </AppText>
      <View
        style={styles.progressTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: total, now: current }}
      >
        <View
          style={[
            styles.progressFill,
            { width: `${Math.round((current / total) * 100)}%` },
            flipRows ? styles.progressFillRtl : null,
          ]}
        />
      </View>
      <AppText
        variant="display"
        accessibilityRole="header"
        testID="wizard-step-title"
      >
        {title}
      </AppText>
    </View>
  );
}

/** Thumbnail of an image, or a document glyph + name for a PDF. */
export function FilePreview({
  file,
  testID,
}: {
  file: PickedFile;
  testID?: string;
}) {
  const { flipRows } = useDirection();
  const isImage = file.mimeType.startsWith("image/");
  return (
    <View
      style={[styles.preview, flipRows && styles.rowReverse]}
      testID={testID}
    >
      {isImage ? (
        <Image source={{ uri: file.previewUri }} style={styles.previewImage} />
      ) : (
        <View style={styles.previewPdf}>
          <Ionicons
            name="document-text-outline"
            size={26}
            color={colors.text}
          />
        </View>
      )}
      <AppText
        variant="secondary"
        weight="600"
        numberOfLines={1}
        style={styles.previewName}
      >
        {file.name}
      </AppText>
    </View>
  );
}

/**
 * Calendar-date field: the native picker (minimum = tomorrow, the earliest
 * valid expiry). Android opens the system dialog; iOS shows it inline.
 */
export function DateField({
  label,
  value,
  onChange,
  error,
  testID,
}: {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  error?: string | null;
  testID: string;
}) {
  const { t } = useTranslation();
  const { language, flipRows } = useDirection();
  const [open, setOpen] = useState(false);
  const minimumDate = tomorrow();
  const pickerValue = value ? fromIsoDate(value) : minimumDate;

  const handlePress = () => {
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: "date",
        minimumDate,
        onValueChange: (_event, date) => onChange(toIsoDate(date)),
      });
    } else {
      setOpen((current) => !current);
    }
  };

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={handlePress}
        style={[fieldStyles.box, error ? fieldStyles.boxError : null]}
        testID={testID}
      >
        <View style={[styles.dateRow, flipRows && styles.rowReverse]}>
          <AppText
            variant="rowTitle"
            weight="600"
            color={value ? colors.text : colors.textMuted}
            style={styles.dateText}
            testID={`${testID}-value`}
          >
            {value
              ? formatDate(value, language)
              : t("onboarding.document.pickDate")}
          </AppText>
          <Icon name="calendar-outline" />
        </View>
      </Pressable>
      {open && Platform.OS !== "android" ? (
        <View>
          <DateTimePicker
            testID={`${testID}-picker`}
            value={pickerValue}
            mode="date"
            display="inline"
            minimumDate={minimumDate}
            locale={language}
            onValueChange={(_event, date) => onChange(toIsoDate(date))}
          />
          <TextButton
            title={t("onboarding.actions.done")}
            onPress={() => setOpen(false)}
            testID={`${testID}-done`}
          />
        </View>
      ) : null}
      {error ? (
        <FieldError testID={`${testID}-error`}>{error}</FieldError>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  rowReverse: { flexDirection: "row-reverse" },
  progress: { gap: spacing.sm, paddingBottom: spacing.sm },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surfaceFill,
    overflow: "hidden",
  },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: colors.accent },
  progressFillRtl: { alignSelf: "flex-end" },
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMap,
  },
  previewPdf: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  previewName: { flex: 1 },
  field: { marginBottom: spacing.ms },
  dateRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dateText: { flex: 1 },
});
