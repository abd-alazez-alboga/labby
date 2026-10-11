import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { colors, radius, spacing } from "../../theme/tokens";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { AppText, useDirection } from "./text";

interface ButtonProps {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  /** Shows a spinner and blocks presses. */
  busy?: boolean;
  icon?: IconName;
  accessibilityLabel?: string;
  testID?: string;
}

/**
 * Pressable that never fires while blocked. The handler is always defined
 * (guarded inside) so a press on a disabled button can never bubble to an
 * ancestor handler.
 */
function BaseButton({
  onPress,
  disabled,
  busy,
  accessibilityLabel,
  testID,
  style,
  pressedStyle,
  children,
}: Omit<ButtonProps, "title" | "icon"> & {
  style: StyleProp<ViewStyle>;
  pressedStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const blocked = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: blocked, busy: !!busy }}
      testID={testID}
      onPress={() => {
        if (!blocked) onPress();
      }}
      style={({ pressed }) => [
        style,
        pressed && !blocked ? pressedStyle : null,
        blocked && styles.disabled,
      ]}
    >
      {children}
    </Pressable>
  );
}

function Label({
  title,
  icon,
  color,
  variant,
  fontSize,
}: {
  title: string;
  icon?: IconName;
  color: string;
  variant: "button" | "bodyStrong";
  fontSize?: number;
}) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.labelRow, flipRows && styles.rowReverse]}>
      {icon ? <Icon name={icon} color={color} /> : null}
      <AppText
        variant={variant}
        color={color}
        align="center"
        style={
          fontSize ? { fontSize, lineHeight: Math.round(fontSize * 1.3) } : null
        }
      >
        {title}
      </AppText>
    </View>
  );
}

/**
 * Glanceable sizes for in-ride screens (NFR-U2): `large` 64 px (offer
 * accept, arrived), `hero` 72 px (start / end ride, cash received).
 */
export type PrimarySize = "regular" | "large" | "hero";

const PRIMARY_SIZES: Record<
  PrimarySize,
  { minHeight: number; borderRadius: number; fontSize?: number }
> = {
  regular: { minHeight: 56, borderRadius: radius.md },
  large: { minHeight: 64, borderRadius: radius.lg, fontSize: 21 },
  hero: { minHeight: 72, borderRadius: 18, fontSize: 24 },
};

/**
 * Full-width accent button — the one dominant action of a screen. `size`
 * grows it for glanceable driver screens; `tone="dark"` is the near-black
 * fill of the in-ride "End ride" action (never a second accent colour).
 */
export function PrimaryButton({
  title,
  icon,
  busy,
  size = "regular",
  tone = "accent",
  ...props
}: ButtonProps & { size?: PrimarySize; tone?: "accent" | "dark" }) {
  const dims = PRIMARY_SIZES[size];
  return (
    <BaseButton
      {...props}
      busy={busy}
      style={[
        styles.primary,
        { minHeight: dims.minHeight, borderRadius: dims.borderRadius },
        tone === "dark" && styles.primaryDark,
      ]}
      pressedStyle={tone === "dark" ? styles.darkPressed : styles.primaryPressed}
    >
      {busy ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Label
          title={title}
          icon={icon}
          color={colors.onAccent}
          variant="button"
          fontSize={dims.fontSize}
        />
      )}
    </BaseButton>
  );
}

/**
 * 56 px white button with a 1.5 px outline — secondary choices next to a
 * dominant action (no-show, cancel ride, rider didn't pay). `danger` is the
 * destructive confirm.
 */
export function OutlineButton({
  title,
  icon,
  busy,
  tone = "neutral",
  ...props
}: ButtonProps & { tone?: "neutral" | "danger" }) {
  const color = tone === "danger" ? colors.danger : colors.text;
  return (
    <BaseButton
      {...props}
      busy={busy}
      style={[styles.outline, tone === "danger" && styles.outlineDanger]}
      pressedStyle={styles.secondaryPressed}
    >
      {busy ? (
        <ActivityIndicator color={color} />
      ) : (
        <Label title={title} icon={icon} color={color} variant="bodyStrong" />
      )}
    </BaseButton>
  );
}

/** 64 × 64 icon-only `surface-fill` button beside a large primary (decline, cancel). */
export function SquareIconButton({
  icon,
  accessibilityLabel,
  onPress,
  disabled,
  busy,
  testID,
}: {
  icon: IconName;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  return (
    <BaseButton
      onPress={onPress}
      disabled={disabled}
      busy={busy}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={styles.square}
      pressedStyle={styles.secondaryPressed}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Icon name={icon} size={24} />
      )}
    </BaseButton>
  );
}

/** Full-width surface-fill button for secondary actions. */
export function SecondaryButton({ title, icon, busy, ...props }: ButtonProps) {
  return (
    <BaseButton
      {...props}
      busy={busy}
      style={styles.secondary}
      pressedStyle={styles.secondaryPressed}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <Label
          title={title}
          icon={icon}
          color={colors.text}
          variant="bodyStrong"
        />
      )}
    </BaseButton>
  );
}

/** Accent text link-button (e.g. "Forgot password?"). */
export function TextButton({ title, icon, busy, ...props }: ButtonProps) {
  return (
    <BaseButton
      {...props}
      busy={busy}
      style={styles.text}
      pressedStyle={styles.textPressed}
    >
      {busy ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Label
          title={title}
          icon={icon}
          color={colors.accent}
          variant="bodyStrong"
        />
      )}
    </BaseButton>
  );
}

/** Danger-coloured text button, no fill (log out, delete). */
export function DestructiveTextButton({
  title,
  icon,
  busy,
  ...props
}: ButtonProps) {
  return (
    <BaseButton
      {...props}
      busy={busy}
      style={styles.text}
      pressedStyle={styles.textPressed}
    >
      {busy ? (
        <ActivityIndicator color={colors.danger} />
      ) : (
        <Label
          title={title}
          icon={icon}
          color={colors.danger}
          variant="bodyStrong"
        />
      )}
    </BaseButton>
  );
}

const styles = StyleSheet.create({
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  rowReverse: { flexDirection: "row-reverse" },
  primary: {
    alignSelf: "stretch",
    minHeight: 56,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  primaryPressed: { backgroundColor: colors.accentPressed },
  primaryDark: { backgroundColor: colors.text },
  darkPressed: { opacity: 0.85 },
  outline: {
    alignSelf: "stretch",
    minHeight: 56,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  outlineDanger: { borderColor: colors.danger },
  square: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: {
    alignSelf: "stretch",
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  secondaryPressed: { backgroundColor: colors.line },
  text: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  textPressed: { opacity: 0.7 },
  disabled: { opacity: 0.4 },
});
