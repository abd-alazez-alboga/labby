import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { TextInputProps } from 'react-native';

import { ApiError } from '../../api/client';
import { useLocale } from '../../i18n/LocaleProvider';
import { colors, gradients, radius, spacing } from '../../theme/tokens';

/**
 * Shared form primitives for the auth and account screens. Text alignment
 * follows the JS-level direction flag so Arabic reads right-to-left even
 * before the native restart mirrors the full layout.
 */

/** Maps an API failure to an i18n key: contract statuses first, then fallbacks. */
export function errorKeyFor(
  error: unknown,
  byStatus: Record<number, string>,
): string {
  if (error instanceof ApiError) {
    return byStatus[error.status] ?? 'auth.errors.generic';
  }
  return 'auth.errors.network';
}

export function FormScreen({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      keyboardShouldPersistTaps="handled"
      testID={testID}
    >
      {children}
    </ScrollView>
  );
}

export function Field({
  label,
  error,
  secureTextEntry,
  testID,
  ...inputProps
}: TextInputProps & { label: string; error?: string | null }) {
  const { direction, flipRows } = useLocale();
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { textAlign }]}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={[
            styles.input,
            { textAlign },
            error ? styles.inputError : null,
            secureTextEntry
              ? flipRows
                ? styles.inputWithToggleRtl
                : styles.inputWithToggle
              : null,
          ]}
          placeholderTextColor={colors.textSubtle}
          secureTextEntry={secureTextEntry ? !revealed : undefined}
          testID={testID}
          {...inputProps}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              revealed
                ? t('auth.fields.hidePassword')
                : t('auth.fields.showPassword')
            }
            onPress={() => setRevealed((v) => !v)}
            style={[
              styles.revealToggle,
              flipRows ? styles.revealToggleRtl : null,
            ]}
            hitSlop={spacing.sm}
            testID={testID ? `${testID}-reveal` : undefined}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.fieldError, { textAlign }]}>{error}</Text>
      ) : null}
    </View>
  );
}

export function CheckboxRow({
  label,
  checked,
  onToggle,
  error,
  testID,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  error?: string | null;
  testID?: string;
}) {
  const { direction, flipRows } = useLocale();
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={[styles.checkboxRow, flipRows ? styles.checkboxRowRtl : null]}
        testID={testID}
      >
        <View style={[styles.checkbox, checked ? styles.checkboxChecked : null]}>
          {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
        </View>
        <Text style={[styles.checkboxLabel, { textAlign }]}>{label}</Text>
      </Pressable>
      {error ? (
        <Text style={[styles.fieldError, { textAlign }]}>{error}</Text>
      ) : null}
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  disabled,
  busy,
  danger,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
  testID?: string;
}) {
  const blocked = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!blocked, busy: !!busy }}
      testID={testID}
      // Always a defined handler (guarded inside) so a press on a
      // disabled button can never bubble to an ancestor handler.
      onPress={() => {
        if (!blocked) onPress();
      }}
      style={[
        styles.primaryButton,
        danger && styles.dangerButton,
        blocked && styles.buttonDisabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={styles.primaryButtonText}>{title}</Text>
      )}
    </Pressable>
  );
}

export function TextButton({
  title,
  onPress,
  disabled,
  testID,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={styles.textButton}
    >
      <Text
        style={[styles.textButtonText, disabled && styles.textButtonDisabled]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export function ErrorBanner({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const { direction } = useLocale();
  return (
    <View style={styles.errorBanner} testID={testID ?? 'error-banner'}>
      <Text
        style={[
          styles.errorBannerText,
          { textAlign: direction === 'rtl' ? 'right' : 'left' },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function InfoBanner({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const { direction } = useLocale();
  return (
    <View style={styles.infoBanner} testID={testID ?? 'info-banner'}>
      <Text
        style={[
          styles.infoBannerText,
          { textAlign: direction === 'rtl' ? 'right' : 'left' },
        ]}
      >
        {children}
      </Text>
    </View>
  );
}

export function ScreenTitle({ children }: { children: React.ReactNode }) {
  const { direction } = useLocale();
  return (
    <Text
      style={[
        styles.title,
        { textAlign: direction === 'rtl' ? 'right' : 'left' },
      ]}
    >
      {children}
    </Text>
  );
}

export function BodyText({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const { direction } = useLocale();
  return (
    <Text
      testID={testID}
      style={[
        styles.body,
        { textAlign: direction === 'rtl' ? 'right' : 'left' },
      ]}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.sm,
  },
  field: {
    marginBottom: spacing.sm,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.lilac200,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputWrap: {
    justifyContent: 'center',
  },
  inputWithToggle: {
    paddingEnd: spacing.xl + spacing.md,
  },
  inputWithToggleRtl: {
    paddingStart: spacing.xl + spacing.md,
  },
  revealToggle: {
    position: 'absolute',
    end: spacing.md,
  },
  revealToggleRtl: {
    end: undefined,
    start: spacing.md,
  },
  fieldError: {
    color: colors.danger,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkboxRowRtl: {
    flexDirection: 'row-reverse',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm / 2,
    borderWidth: 1,
    borderColor: colors.lavender200,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  checkboxMark: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  checkboxLabel: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
  },
  primaryButton: {
    // Solid fallback for --labby-gradient-button.
    backgroundColor: gradients.button[0],
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  dangerButton: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  textButtonText: {
    color: colors.purple700,
    fontSize: 15,
    fontWeight: '600',
  },
  textButtonDisabled: {
    color: colors.textSubtle,
  },
  errorBanner: {
    backgroundColor: colors.dangerBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  errorBannerText: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  infoBanner: {
    backgroundColor: colors.successBg,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  infoBannerText: {
    color: colors.success,
    fontSize: 14,
    lineHeight: 20,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  body: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: spacing.sm,
  },
});
