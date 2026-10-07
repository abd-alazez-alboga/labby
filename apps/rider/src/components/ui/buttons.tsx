/**
 * Mobile buttons (design system): one PrimaryButton per screen (56 px,
 * radius 14, accent fill, 18/800 white label, 40 % opacity when disabled,
 * spinner while loading), SecondaryButton (surface-fill ground, text colour),
 * DestructiveTextButton (danger text, no fill) and TextButton for links.
 */
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { colors, radius, spacing, touchTarget } from "../../theme/tokens";
import { AppText, type TextTone } from "./text";

export interface ButtonProps {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}

type FilledKind = "primary" | "secondary";

function FilledButton({
  kind,
  label,
  onPress,
  disabled,
  loading,
  testID,
  accessibilityLabel,
  style,
}: ButtonProps & { kind: FilledKind }) {
  const isDisabled = !!(disabled || loading);
  const primary = kind === "primary";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.filled,
        primary ? styles.primary : styles.secondary,
        pressed &&
          !isDisabled &&
          (primary ? styles.primaryPressed : styles.secondaryPressed),
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={primary ? colors.onAccent : colors.text}
          testID={testID ? `${testID}-loading` : undefined}
        />
      ) : (
        <AppText
          variant={primary ? "button" : "bodyStrong"}
          weight={800}
          tone={primary ? "onAccent" : "default"}
          align="center"
          numberOfLines={1}
        >
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

export function PrimaryButton(props: ButtonProps) {
  return <FilledButton kind="primary" {...props} />;
}

export function SecondaryButton(props: ButtonProps) {
  return <FilledButton kind="secondary" {...props} />;
}

function PlainTextButton({
  tone,
  label,
  onPress,
  disabled,
  loading,
  testID,
  accessibilityLabel,
  style,
}: ButtonProps & { tone: Extract<TextTone, "accent" | "danger"> }) {
  const isDisabled = !!(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: isDisabled, busy: !!loading }}
      onPress={onPress}
      disabled={isDisabled}
      testID={testID}
      style={({ pressed }) => [
        styles.text,
        pressed && !isDisabled && styles.textPressed,
        style,
      ]}
    >
      {loading ? (
        <View style={styles.spinnerWrap}>
          <ActivityIndicator
            color={tone === "danger" ? colors.danger : colors.accent}
            testID={testID ? `${testID}-loading` : undefined}
          />
        </View>
      ) : (
        <AppText
          variant="bodyStrong"
          tone={isDisabled ? "muted" : tone}
          align="center"
        >
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/** Accent text link ("Forgot password?", "Try again" in a list footer). */
export function TextButton(props: ButtonProps) {
  return <PlainTextButton tone="accent" {...props} />;
}

/** Danger text, no fill — destructive actions. */
export function DestructiveTextButton(props: ButtonProps) {
  return <PlainTextButton tone="danger" {...props} />;
}

const styles = StyleSheet.create({
  filled: {
    alignSelf: "stretch",
    height: 56,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  primary: {
    backgroundColor: colors.accent,
  },
  primaryPressed: {
    backgroundColor: colors.accentPressed,
  },
  secondary: {
    backgroundColor: colors.surfaceFill,
  },
  secondaryPressed: {
    backgroundColor: colors.line,
  },
  disabled: {
    opacity: 0.4,
  },
  text: {
    minHeight: touchTarget,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  textPressed: {
    opacity: 0.6,
  },
  spinnerWrap: {
    minHeight: 24,
    justifyContent: "center",
  },
});
