import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import type { TextInputProps } from "react-native";

import { fontFamilyFor } from "../../theme/fonts";
import { colors, radius, spacing } from "../../theme/tokens";
import { AppText, useDirection } from "./text";

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <AppText variant="label" color={colors.textSecondary} style={styles.label}>
      {children}
    </AppText>
  );
}

/** Inline error text under a field or any non-TextInput control. */
export function FieldError({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <AppText
      variant="caption"
      color={colors.danger}
      style={styles.error}
      testID={testID}
    >
      {children}
    </AppText>
  );
}

/**
 * 56 px input on `surface-fill`, radius 14, no border at rest, a 2 px
 * `text` outline on focus and a danger outline + message on error. Secure
 * entries keep their show/hide eye toggle.
 */
export function TextField({
  label,
  error,
  secureTextEntry,
  testID,
  onFocus,
  onBlur,
  ...inputProps
}: TextInputProps & { label: string; error?: string | null }) {
  const { t } = useTranslation();
  const { language, flipRows, textAlign } = useDirection();
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.field}>
      <FieldLabel>{label}</FieldLabel>
      <View
        style={[
          styles.box,
          focused && styles.boxFocused,
          error ? styles.boxError : null,
          flipRows && styles.rowReverse,
        ]}
      >
        <TextInput
          style={[
            styles.input,
            { textAlign, fontFamily: fontFamilyFor("600", language) },
          ]}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secureTextEntry ? !revealed : undefined}
          testID={testID}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...inputProps}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              revealed
                ? t("auth.fields.hidePassword")
                : t("auth.fields.showPassword")
            }
            onPress={() => setRevealed((value) => !value)}
            style={styles.reveal}
            hitSlop={spacing.sm}
            testID={testID ? `${testID}-reveal` : undefined}
          >
            <Ionicons
              name={revealed ? "eye-off-outline" : "eye-outline"}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

/** Checkbox + label (terms, confirmations). */
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
  const { flipRows } = useDirection();
  return (
    <View style={styles.field}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={onToggle}
        style={[styles.checkRow, flipRows && styles.rowReverse]}
        testID={testID}
      >
        <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
          {checked ? (
            <Ionicons name="checkmark" size={16} color={colors.onAccent} />
          ) : null}
        </View>
        <AppText variant="secondary" style={styles.checkLabel}>
          {label}
        </AppText>
      </Pressable>
      {error ? <FieldError>{error}</FieldError> : null}
    </View>
  );
}

/**
 * A row of mutually exclusive options (language choice): the selected one
 * carries a 2 px `text` outline, the rest sit on `surface-fill`.
 */
export function OptionGroup<T extends string>({
  options,
  value,
  onChange,
  labelFor,
  testIDPrefix,
}: {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  labelFor: (value: T) => string;
  testIDPrefix: string;
}) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.options, flipRows && styles.rowReverse]}>
      {options.map((option) => {
        const selected = option === value;
        return (
          <Pressable
            key={option}
            testID={`${testIDPrefix}-${option}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onChange(option)}
            style={[styles.option, selected && styles.optionSelected]}
          >
            <AppText variant="bodyStrong" align="center">
              {labelFor(option)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export const fieldStyles = StyleSheet.create({
  /** The 56 px input box, for custom (non-TextInput) fields. */
  box: {
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: spacing.md,
    justifyContent: "center",
  },
  boxError: { borderColor: colors.danger },
});

const styles = StyleSheet.create({
  field: { marginBottom: spacing.ms },
  label: { marginBottom: 6 },
  error: { marginTop: 6 },
  box: {
    ...fieldStyles.box,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  boxFocused: { borderColor: colors.text },
  boxError: fieldStyles.boxError,
  rowReverse: { flexDirection: "row-reverse" },
  input: {
    flex: 1,
    minHeight: 52,
    fontSize: 17,
    color: colors.text,
    paddingVertical: 0,
  },
  reveal: {
    minWidth: 32,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.ms,
    minHeight: 48,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  checkLabel: { flex: 1 },
  options: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.ms },
  option: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  optionSelected: { backgroundColor: colors.surface, borderColor: colors.text },
});
