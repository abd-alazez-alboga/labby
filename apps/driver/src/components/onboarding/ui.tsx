import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, {
  DateTimePickerAndroid,
} from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useLocale } from '../../i18n/LocaleProvider';
import { formatDate, fromIsoDate, toIsoDate, tomorrow } from '../../onboarding/dates';
import type { PickedFile } from '../../onboarding/drafts';
import type { FailureKind } from '../../onboarding/server-errors';
import { colors, radius, spacing } from '../../theme/tokens';
import { PrimaryButton, TextButton } from '../auth/ui';

/**
 * Presentational building blocks shared by the onboarding screens (wizard
 * steps, stage tracker, vehicles, documents). Text alignment follows the
 * JS-level direction; rows flip manually only while native RTL is pending.
 */

export function useTextAlign(): 'left' | 'right' {
  const { direction } = useLocale();
  return direction === 'rtl' ? 'right' : 'left';
}

export function useRowStyle() {
  const { flipRows } = useLocale();
  return flipRows ? styles.rowReverse : styles.row;
}

/** "Step 2 of 8" + a progress bar + the step's title. */
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
  const textAlign = useTextAlign();
  const { flipRows } = useLocale();
  return (
    <View style={styles.progress} testID="wizard-progress">
      <Text style={[styles.progressLabel, { textAlign }]} testID="wizard-step-count">
        {t('onboarding.wizard.stepOf', { current, total })}
      </Text>
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
      <Text style={[styles.stepTitle, { textAlign }]} testID="wizard-step-title">
        {title}
      </Text>
    </View>
  );
}

export function Card({
  children,
  testID,
  tone,
}: {
  children: React.ReactNode;
  testID?: string;
  tone?: 'warning' | 'danger' | 'success';
}) {
  return (
    <View
      style={[
        styles.card,
        tone === 'warning' && styles.cardWarning,
        tone === 'danger' && styles.cardDanger,
        tone === 'success' && styles.cardSuccess,
      ]}
      testID={testID}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  const textAlign = useTextAlign();
  return <Text style={[styles.sectionTitle, { textAlign }]}>{children}</Text>;
}

export function Muted({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const textAlign = useTextAlign();
  return (
    <Text style={[styles.muted, { textAlign }]} testID={testID}>
      {children}
    </Text>
  );
}

export type ChipTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

export function StatusChip({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: ChipTone;
  testID?: string;
}) {
  return (
    <View style={[styles.chip, chipTones[tone].box]} testID={testID}>
      <Text style={[styles.chipText, chipTones[tone].text]}>{label}</Text>
    </View>
  );
}

export function KeyValue({ label, value }: { label: string; value: string }) {
  const rowStyle = useRowStyle();
  return (
    <View style={[rowStyle, styles.keyValue]}>
      <Text style={styles.keyLabel}>{label}</Text>
      <Text style={styles.keyValueText}>{value}</Text>
    </View>
  );
}

/** A reviewer's note (change request / rejection reason). */
export function NoteBox({
  title,
  note,
  testID,
}: {
  title: string;
  note: string;
  testID?: string;
}) {
  const textAlign = useTextAlign();
  return (
    <View style={styles.noteBox} testID={testID}>
      <Text style={[styles.noteTitle, { textAlign }]}>{title}</Text>
      <Text style={[styles.noteText, { textAlign }]}>{note}</Text>
    </View>
  );
}

export function LoadingState({ testID }: { testID?: string }) {
  const { t } = useTranslation();
  return (
    <View style={styles.centered} testID={testID ?? 'loading-state'}>
      <ActivityIndicator color={colors.purple700} />
      <Text style={styles.muted}>{t('onboarding.loading')}</Text>
    </View>
  );
}

/** Distinct network vs server failure states, each with a retry. */
export function FailureState({
  kind,
  onRetry,
  testID,
}: {
  kind: FailureKind;
  onRetry: () => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const textAlign = useTextAlign();
  return (
    <Card tone="danger" testID={testID ?? `failure-${kind}`}>
      <Text style={[styles.failureTitle, { textAlign }]}>
        {t(`onboarding.errors.${kind}Title`)}
      </Text>
      <Text style={[styles.failureBody, { textAlign }]}>
        {t(`onboarding.errors.${kind}`)}
      </Text>
      <PrimaryButton
        title={t('onboarding.actions.retry')}
        onPress={onRetry}
        testID="failure-retry"
      />
    </Card>
  );
}

export function SecondaryButton({
  title,
  onPress,
  disabled,
  testID,
  icon,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const rowStyle = useRowStyle();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={[styles.secondaryButton, rowStyle, disabled && styles.disabled]}
    >
      {icon ? <Ionicons name={icon} size={18} color={colors.purple700} /> : null}
      <Text style={styles.secondaryButtonText}>{title}</Text>
    </Pressable>
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
  const rowStyle = useRowStyle();
  const isImage = file.mimeType.startsWith('image/');
  return (
    <View style={[rowStyle, styles.preview]} testID={testID}>
      {isImage ? (
        <Image source={{ uri: file.previewUri }} style={styles.previewImage} />
      ) : (
        <View style={styles.previewPdf}>
          <Ionicons name="document-text-outline" size={28} color={colors.purple700} />
        </View>
      )}
      <Text style={styles.previewName} numberOfLines={1}>
        {file.name}
      </Text>
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
  const { language } = useLocale();
  const textAlign = useTextAlign();
  const [open, setOpen] = useState(false);
  const minimumDate = tomorrow();
  const pickerValue = value ? fromIsoDate(value) : minimumDate;

  const handlePress = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: 'date',
        minimumDate,
        onValueChange: (_event, date) => onChange(toIsoDate(date)),
      });
    } else {
      setOpen((current) => !current);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { textAlign }]}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={handlePress}
        style={[styles.dateInput, error ? styles.inputError : null]}
        testID={testID}
      >
        <Text
          style={[
            styles.dateText,
            { textAlign },
            !value && styles.datePlaceholder,
          ]}
          testID={`${testID}-value`}
        >
          {value ? formatDate(value, language) : t('onboarding.document.pickDate')}
        </Text>
      </Pressable>
      {open && Platform.OS !== 'android' ? (
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
            title={t('onboarding.actions.done')}
            onPress={() => setOpen(false)}
            testID={`${testID}-done`}
          />
        </View>
      ) : null}
      {error ? (
        <Text style={[styles.fieldError, { textAlign }]} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** Inline error text under a non-TextInput control. */
export function FieldError({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const textAlign = useTextAlign();
  return (
    <Text style={[styles.fieldError, { textAlign }]} testID={testID}>
      {children}
    </Text>
  );
}

const chipTones: Record<ChipTone, { box: object; text: object }> = {
  neutral: { box: { backgroundColor: colors.lavender100 }, text: { color: colors.textSecondary } },
  info: { box: { backgroundColor: colors.lilac100 }, text: { color: colors.purple700 } },
  warning: { box: { backgroundColor: colors.warningBg }, text: { color: colors.warning } },
  danger: { box: { backgroundColor: colors.dangerBg }, text: { color: colors.danger } },
  success: { box: { backgroundColor: colors.successBg }, text: { color: colors.success } },
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  rowReverse: { flexDirection: 'row-reverse', alignItems: 'center' },
  progress: { marginBottom: spacing.md, gap: spacing.xs },
  progressLabel: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.lavender100,
    overflow: 'hidden',
  },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.purple700 },
  progressFillRtl: { alignSelf: 'flex-end' },
  stepTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginTop: spacing.sm,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.lilac200,
  },
  cardWarning: { borderColor: colors.warning, backgroundColor: colors.warningBg },
  cardDanger: { borderColor: colors.danger, backgroundColor: colors.dangerBg },
  cardSuccess: { borderColor: colors.success, backgroundColor: colors.successBg },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  keyValue: { justifyContent: 'space-between', gap: spacing.md },
  keyLabel: { color: colors.textMuted, fontSize: 14 },
  keyValueText: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  noteBox: {
    backgroundColor: colors.warningBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  noteTitle: { color: colors.warning, fontSize: 13, fontWeight: '700' },
  noteText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  centered: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
  },
  failureTitle: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  failureBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  secondaryButton: {
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.purple700,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.white,
  },
  secondaryButtonText: { color: colors.purple700, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.5 },
  preview: {
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lilac200,
    padding: spacing.sm,
  },
  previewImage: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.lavender100,
  },
  previewPdf: {
    width: 56,
    height: 56,
    borderRadius: radius.sm,
    backgroundColor: colors.lavender100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewName: { flex: 1, color: colors.text, fontSize: 14 },
  field: { marginBottom: spacing.sm },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  dateInput: {
    backgroundColor: colors.white,
    borderColor: colors.lilac200,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputError: { borderColor: colors.danger },
  dateText: { fontSize: 16, color: colors.text },
  datePlaceholder: { color: colors.textSubtle },
  fieldError: { color: colors.danger, fontSize: 13, marginTop: spacing.xs },
});
