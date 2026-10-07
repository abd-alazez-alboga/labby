import React from "react";
import { StyleSheet, View } from "react-native";

import { radius, spacing } from "../../theme/tokens";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { TONES } from "./status-chip";
import type { Tone } from "./status-chip";
import { AppText, useDirection } from "./text";

const DEFAULT_ICONS: Record<Tone, IconName> = {
  accent: "information-circle-outline",
  success: "checkmark-circle-outline",
  warning: "alert-circle-outline",
  danger: "alert-circle-outline",
  neutral: "information-circle-outline",
};

/**
 * Tone-grounded message block (radius 14, icon + 14 px text). An optional
 * bold title sits above the message; `children` (actions, extra lines)
 * follow it.
 */
export function Banner({
  tone,
  title,
  message,
  messageTestID,
  icon,
  children,
  testID,
}: {
  tone: Tone;
  title?: string;
  message?: string;
  messageTestID?: string;
  icon?: IconName;
  children?: React.ReactNode;
  testID?: string;
}) {
  const { flipRows } = useDirection();
  const { fg, bg } = TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <View style={[styles.row, flipRows && styles.rowReverse]}>
        <View style={styles.icon}>
          <Icon name={icon ?? DEFAULT_ICONS[tone]} color={fg} />
        </View>
        {/* testID on the body: its text content is the message, not the icon glyph. */}
        <View style={styles.body} testID={testID}>
          {title || message ? (
            <View style={styles.text}>
              {title ? (
                <AppText variant="secondary" weight="700" color={fg}>
                  {title}
                </AppText>
              ) : null}
              {message ? (
                <AppText variant="secondary" color={fg} testID={messageTestID}>
                  {message}
                </AppText>
              ) : null}
            </View>
          ) : null}
          {children}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  row: { flexDirection: "row", alignItems: "flex-start", gap: spacing.ms },
  rowReverse: { flexDirection: "row-reverse" },
  icon: { marginTop: 1 },
  body: { flex: 1, gap: spacing.ms },
  text: { gap: 2 },
});
