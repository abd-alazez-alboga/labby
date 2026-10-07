/**
 * Selectable pill (filters, language choice): selected = text-colour fill
 * with a white label; unselected = white with a `line-strong` outline. 40 px
 * tall with a hit slop up to the 48 px touch target.
 */
import React from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from "react-native";

import { colors, radius, spacing } from "../../theme/tokens";
import { AppText } from "./text";

export function ChoiceChip({
  label,
  selected,
  onPress,
  testID,
  style,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={4}
      testID={testID}
      style={({ pressed }) => [
        styles.chip,
        selected ? styles.selected : styles.unselected,
        pressed && styles.pressed,
        style,
      ]}
    >
      <AppText
        variant="label"
        weight={700}
        tone={selected ? "onAccent" : "default"}
        align="center"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    height: 40,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.round,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  selected: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  unselected: {
    backgroundColor: colors.surface,
    borderColor: colors.lineStrong,
  },
  pressed: {
    opacity: 0.7,
  },
});
