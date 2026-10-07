import React from "react";
import { StyleSheet, View } from "react-native";

import { colors, radius } from "../../theme/tokens";
import { AppText } from "./text";

export type Tone = "accent" | "success" | "warning" | "danger" | "neutral";

/** Foreground / ground pairs for chips and banners. */
export const TONES: Record<Tone, { fg: string; bg: string }> = {
  accent: { fg: colors.accent, bg: colors.accentTint },
  success: { fg: colors.success, bg: colors.successBg },
  warning: { fg: colors.warning, bg: colors.warningBg },
  danger: { fg: colors.danger, bg: colors.dangerBg },
  neutral: { fg: colors.textSecondary, bg: colors.surfaceFill },
};

/** 13/700 status pill (Valid, Under review, Rejected…). */
export function StatusChip({
  label,
  tone,
  testID,
}: {
  label: string;
  tone: Tone;
  testID?: string;
}) {
  const { fg, bg } = TONES[tone];
  return (
    <View style={[styles.chip, { backgroundColor: bg }]} testID={testID}>
      <AppText variant="caption" weight="700" color={fg} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: "flex-start",
    borderRadius: radius.chip,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
});
