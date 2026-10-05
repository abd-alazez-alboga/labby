/**
 * Small shared form primitives for the auth & settings screens:
 * labelled text input with error line, primary/secondary buttons, error and
 * success banners. All are RTL-aware through useLocale().isRTL.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

export interface FormFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  testID?: string;
}

export function FormField({
  label,
  error,
  testID,
  style,
  secureTextEntry,
  ...inputProps
}: FormFieldProps) {
  const { t, isRTL } = useLocale();
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, isRTL && styles.textRtl]}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={[
            styles.input,
            isRTL && styles.inputRtl,
            error ? styles.inputError : null,
            secureTextEntry ? (isRTL ? styles.inputWithToggleRtl : styles.inputWithToggle) : null,
            style,
          ]}
          placeholderTextColor={colors.textSubtle}
          secureTextEntry={secureTextEntry ? !revealed : undefined}
          testID={testID}
          {...inputProps}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={revealed ? t('common.hidePassword') : t('common.showPassword')}
            onPress={() => setRevealed((v) => !v)}
            style={[styles.revealToggle, isRTL && styles.revealToggleRtl]}
            hitSlop={spacing.sm}
            testID={testID ? `${testID}-reveal` : undefined}
          >
            <Ionicons
              name={revealed ? 'eye-off-outline' : 'eye-outline'}
              size={fontSize.xl}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.errorText, isRTL && styles.textRtl]} testID={testID ? `${testID}-error` : undefined}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'link';
  testID?: string;
}

export function Button({ label, onPress, disabled, loading, variant = 'primary', testID }: ButtonProps) {
  const isDisabled = disabled || loading;
  if (variant === 'link') {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled }}
        onPress={onPress}
        disabled={isDisabled}
        testID={testID}
        style={styles.linkButton}
      >
        <Text style={[styles.linkLabel, isDisabled && styles.linkLabelDisabled]}>{label}</Text>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled }}
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'danger' && styles.buttonDanger,
        pressed && !isDisabled && styles.buttonPressed,
        isDisabled && styles.buttonDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? colors.purple700 : colors.white} />
      ) : (
        <Text
          style={[
            styles.buttonLabel,
            variant === 'secondary' && styles.buttonLabelSecondary,
          ]}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ message, testID }: { message: string; testID?: string }) {
  const { isRTL } = useLocale();
  return (
    <View style={styles.errorBanner} testID={testID ?? 'error-banner'}>
      <Text style={[styles.errorBannerText, isRTL && styles.textRtl]}>{message}</Text>
    </View>
  );
}

export function SuccessBanner({ message, testID }: { message: string; testID?: string }) {
  const { isRTL } = useLocale();
  return (
    <View style={styles.successBanner} testID={testID ?? 'success-banner'}>
      <Text style={[styles.successBannerText, isRTL && styles.textRtl]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lavender200,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + spacing.xs,
    fontSize: fontSize.md,
    color: colors.text,
  },
  inputRtl: {
    textAlign: 'right',
    writingDirection: 'rtl',
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
  inputError: {
    borderColor: '#C0392B',
  },
  errorText: {
    color: '#C0392B',
    fontSize: fontSize.sm,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  button: {
    backgroundColor: colors.purple700,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: colors.lavender100,
  },
  buttonDanger: {
    backgroundColor: '#C0392B',
  },
  buttonPressed: {
    backgroundColor: colors.purple500,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabel: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  buttonLabelSecondary: {
    color: colors.purple700,
  },
  linkButton: {
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  linkLabel: {
    color: colors.purple700,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  linkLabelDisabled: {
    color: colors.textSubtle,
  },
  errorBanner: {
    backgroundColor: '#FDECEA',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  errorBannerText: {
    color: '#C0392B',
    fontSize: fontSize.sm,
  },
  successBanner: {
    backgroundColor: '#EAF7EF',
    borderRadius: radius.md,
    padding: spacing.md,
  },
  successBannerText: {
    color: '#1E7E4A',
    fontSize: fontSize.sm,
  },
});
