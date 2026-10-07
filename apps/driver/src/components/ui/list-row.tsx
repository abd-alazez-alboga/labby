import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { colors, spacing } from "../../theme/tokens";
import { Chevron, Icon } from "./icons";
import type { IconName } from "./icons";
import { AppText, useDirection } from "./text";

/**
 * A list row: optional 40 px icon well, 16–17/700 title, 14 px muted
 * subtitle, optional trailing node (a StatusChip) and chevron. Rows divide
 * with a `line` rule except the last one. Pressable when `onPress` is set.
 */
export function ListRow({
  title,
  subtitle,
  subtitleColor,
  icon,
  leading,
  trailing,
  chevron,
  onPress,
  disabled,
  last,
  tone = "default",
  accessibilityLabel,
  testID,
  titleTestID,
  titleVariant = "rowTitle",
  children,
}: {
  title: string;
  subtitle?: string | null;
  /** e.g. warning colour for an expiring date. */
  subtitleColor?: string;
  icon?: IconName;
  /** Custom leading node (e.g. a photo) in place of the icon well. */
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  last?: boolean;
  /** `danger` for destructive rows (log out). */
  tone?: "default" | "danger";
  accessibilityLabel?: string;
  testID?: string;
  titleTestID?: string;
  /** `body` for sentence-length titles (checklists). */
  titleVariant?: "rowTitle" | "body";
  /** Extra content under the title block (notes, hints). */
  children?: React.ReactNode;
}) {
  const { flipRows } = useDirection();
  const tall = !!subtitle || !!trailing;
  const titleColor = tone === "danger" ? colors.danger : colors.text;

  const content = (
    <>
      <View
        style={[styles.row, flipRows && styles.rowReverse, tall && styles.tall]}
      >
        {leading}
        {icon ? (
          <View style={styles.well}>
            <Icon
              name={icon}
              size={18}
              color={tone === "danger" ? colors.danger : colors.text}
            />
          </View>
        ) : null}
        <View style={styles.text}>
          <AppText
            variant={titleVariant}
            color={titleColor}
            testID={titleTestID}
          >
            {title}
          </AppText>
          {subtitle ? (
            <AppText
              variant="secondary"
              color={subtitleColor ?? colors.textMuted}
            >
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {trailing}
        {chevron ? <Chevron direction="forward" /> : null}
      </View>
      {children ? <View style={styles.extra}>{children}</View> : null}
    </>
  );

  const frame = [styles.frame, !last && styles.divider];

  if (!onPress) {
    return (
      <View style={frame} testID={testID}>
        {content}
      </View>
    );
  }
  const blocked = !!disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: blocked }}
      onPress={() => {
        if (!blocked) onPress();
      }}
      style={({ pressed }) => [frame, pressed && !blocked && styles.pressed]}
      testID={testID}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: { paddingVertical: spacing.ms },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  pressed: { opacity: 0.6 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, minHeight: 40 },
  rowReverse: { flexDirection: "row-reverse" },
  tall: { minHeight: 52 },
  well: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: 3 },
  extra: { marginTop: spacing.sm, gap: spacing.sm },
});
