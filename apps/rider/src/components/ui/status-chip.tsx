/** Status chip: 13/700 label, padding 4×10, radius 12, tone ground. */
import React from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";

import { colors, radius } from "../../theme/tokens";
import { AppText, type TextTone } from "./text";

export type ChipTone = "accent" | "success" | "warning" | "danger" | "neutral";

export const CHIP_TONES: Record<ChipTone, { ground: string; text: TextTone }> =
  {
    accent: { ground: colors.accentTint, text: "accent" },
    success: { ground: colors.successBg, text: "success" },
    warning: { ground: colors.warningBg, text: "warning" },
    danger: { ground: colors.dangerBg, text: "danger" },
    neutral: { ground: colors.surfaceFill, text: "secondary" },
  };

export function StatusChip({
  label,
  tone = "neutral",
  testID,
  style,
}: {
  label: string;
  tone?: ChipTone;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = CHIP_TONES[tone];
  return (
    <View
      style={[styles.chip, { backgroundColor: palette.ground }, style]}
      testID={testID}
    >
      <AppText
        variant="caption"
        weight={700}
        tone={palette.text}
        align="center"
        numberOfLines={1}
      >
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.chip,
  },
});
