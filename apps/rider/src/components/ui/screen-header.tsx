/**
 * Header for non-map screens (design system ScreenHeader): a 48 px back
 * chevron that flips in RTL, then a 32/800 title aligned to the reading
 * start. Clears the status bar itself — the stack layouts render it as the
 * native-stack `header`, so screens keep owning only their content.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOptionalLocale } from "../../i18n/locale-context";
import { colors, spacing, touchTarget } from "../../theme/tokens";
import { useDirection } from "./direction";
import { AppText } from "./text";

export function ScreenHeader({
  title,
  onBack,
  testID = "screen-header",
}: {
  title: string;
  /** Omit when there is nothing to go back to. */
  onBack?: () => void;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const locale = useOptionalLocale();
  const { flipRows, backChevron } = useDirection();
  return (
    <View
      style={[styles.header, { paddingTop: insets.top + spacing.md }]}
      testID={testID}
    >
      {onBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={locale?.t("common.back") ?? "Back"}
          onPress={onBack}
          style={({ pressed }) => [
            styles.back,
            flipRows ? styles.backRtl : styles.backLtr,
            pressed && styles.pressed,
          ]}
          testID={`${testID}-back`}
        >
          <Ionicons name={backChevron} size={22} color={colors.text} />
        </Pressable>
      ) : null}
      <AppText variant="display" accessibilityRole="header">
        {title}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
    gap: spacing.lg,
  },
  // A full 48 px touch target (V1 audit I92).
  back: {
    width: touchTarget,
    height: touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  // The chevron's glyph sits optically flush with the title edge.
  backLtr: {
    alignSelf: "flex-start",
    marginStart: -12,
  },
  backRtl: {
    alignSelf: "flex-end",
    marginEnd: -12,
  },
  pressed: {
    opacity: 0.6,
  },
});
