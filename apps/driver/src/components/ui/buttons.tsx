import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

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
  style: object;
  pressedStyle?: object;
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
}: {
  title: string;
  icon?: IconName;
  color: string;
  variant: "button" | "bodyStrong";
}) {
  const { flipRows } = useDirection();
  return (
    <View style={[styles.labelRow, flipRows && styles.rowReverse]}>
      {icon ? <Icon name={icon} color={color} /> : null}
      <AppText variant={variant} color={color} align="center">
        {title}
      </AppText>
    </View>
  );
}

/** Full-width 56 px accent button — the one dominant action of a screen. */
export function PrimaryButton({ title, icon, busy, ...props }: ButtonProps) {
  return (
    <BaseButton
      {...props}
      busy={busy}
      style={styles.primary}
      pressedStyle={styles.primaryPressed}
    >
      {busy ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <Label
          title={title}
          icon={icon}
          color={colors.onAccent}
          variant="button"
        />
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
