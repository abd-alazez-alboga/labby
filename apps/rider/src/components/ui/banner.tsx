/**
 * Inline banner: radius 14, tone ground, icon + 14 px text, optional bold
 * title. Replaces the old error/success banners and notice boxes.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, View } from "react-native";

import { colors, radius, spacing } from "../../theme/tokens";
import { useDirection } from "./direction";
import { CHIP_TONES, type ChipTone } from "./status-chip";
import { AppText } from "./text";

const TONE_ICON: Record<
  ChipTone,
  React.ComponentProps<typeof Ionicons>["name"]
> = {
  accent: "information-circle-outline",
  neutral: "information-circle-outline",
  success: "checkmark-circle-outline",
  warning: "alert-circle-outline",
  danger: "alert-circle-outline",
};

const TONE_ICON_COLOR: Record<ChipTone, string> = {
  accent: colors.accent,
  neutral: colors.textSecondary,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

export function Banner({
  tone,
  message,
  title,
  testID,
}: {
  tone: ChipTone;
  message: string;
  title?: string;
  testID?: string;
}) {
  const { row } = useDirection();
  const palette = CHIP_TONES[tone];
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: palette.ground, flexDirection: row },
      ]}
      accessibilityRole={tone === "danger" ? "alert" : undefined}
    >
      <Ionicons
        name={TONE_ICON[tone]}
        size={20}
        color={TONE_ICON_COLOR[tone]}
        style={styles.icon}
      />
      {/* testID sits on the text so text-content queries see the copy, not the icon glyph. */}
      <View style={styles.text} testID={testID}>
        {title ? (
          <AppText variant="secondary" weight={700} tone={palette.text}>
            {title}
          </AppText>
        ) : null}
        <AppText variant="secondary" tone={palette.text} style={styles.message}>
          {message}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  icon: {
    marginTop: 1,
  },
  text: {
    flex: 1,
    gap: spacing.xs,
  },
  message: {
    lineHeight: 20,
  },
});
