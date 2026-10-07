/**
 * Labelled text input (design system TextField): 56 px, surface-fill ground,
 * radius 14, no border at rest, 2 px text-colour outline on focus, danger
 * outline + message on error. Password fields keep their show/hide eye toggle.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import {
  Pressable,
  StyleSheet,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { useOptionalLocale } from "../../i18n/locale-context";
import { colors, radius, spacing, typography } from "../../theme/tokens";
import { useDirection } from "./direction";
import { AppText, useFontFamily } from "./text";

export interface TextFieldProps extends TextInputProps {
  label: string;
  error?: string | null;
  testID?: string;
}

export function TextField({
  label,
  error,
  testID,
  style,
  secureTextEntry,
  onFocus,
  onBlur,
  ...inputProps
}: TextFieldProps) {
  const locale = useOptionalLocale();
  const { isRTL, flipRows } = useDirection();
  const fontFamily = useFontFamily(600);
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const t = locale?.t ?? ((key: string) => key);

  return (
    <View style={styles.field}>
      <AppText variant="label" tone="secondary">
        {label}
      </AppText>
      <View style={styles.inputWrap}>
        <TextInput
          style={[
            styles.input,
            { fontFamily },
            isRTL && styles.inputRtl,
            isRTL && (flipRows ? styles.alignRight : styles.alignLeft),
            focused && styles.inputFocused,
            error ? styles.inputError : null,
            secureTextEntry
              ? flipRows
                ? styles.withToggleRtl
                : styles.withToggle
              : null,
            style,
          ]}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
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
              revealed ? t("common.hidePassword") : t("common.showPassword")
            }
            onPress={() => setRevealed((v) => !v)}
            style={[styles.revealToggle, flipRows && styles.revealToggleRtl]}
            testID={testID ? `${testID}-reveal` : undefined}
          >
            <Ionicons
              name={revealed ? "eye-off-outline" : "eye-outline"}
              size={22}
              color={colors.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <AppText
          variant="secondary"
          tone="danger"
          testID={testID ? `${testID}-error` : undefined}
        >
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

const TOGGLE_SIZE = 48;

const styles = StyleSheet.create({
  field: {
    gap: spacing.sm,
  },
  inputWrap: {
    justifyContent: "center",
  },
  input: {
    height: 56,
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: "transparent",
    paddingHorizontal: spacing.lg,
    fontSize: typography.rowTitle.fontSize,
    color: colors.text,
  },
  inputRtl: {
    writingDirection: "rtl",
  },
  alignRight: {
    textAlign: "right",
  },
  alignLeft: {
    textAlign: "left",
  },
  inputFocused: {
    borderColor: colors.text,
  },
  inputError: {
    borderColor: colors.danger,
  },
  withToggle: {
    paddingEnd: TOGGLE_SIZE + spacing.xs,
  },
  withToggleRtl: {
    paddingStart: TOGGLE_SIZE + spacing.xs,
  },
  revealToggle: {
    position: "absolute",
    end: spacing.xs,
    width: TOGGLE_SIZE,
    height: TOGGLE_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  revealToggleRtl: {
    end: undefined,
    start: spacing.xs,
  },
});
