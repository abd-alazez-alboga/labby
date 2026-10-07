/**
 * List row (design system): min 64 px (76 with a subtitle), optional 40 px
 * round icon well or custom leading element, title 17/700, subtitle 14 muted,
 * optional trailing element (chip, badge, switch) and chevron, `line` divider
 * except on the last row. Rows and chevrons follow the reading direction.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  type AccessibilityState,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import { colors, radius, spacing } from "../../theme/tokens";
import { useDirection } from "./direction";
import { AppText, type TextTone } from "./text";

export interface ListRowProps {
  title: string;
  subtitle?: string;
  icon?: React.ComponentProps<typeof Ionicons>["name"];
  leading?: React.ReactNode;
  /** Rendered right after the title on the same line (e.g. a lock icon). */
  titleAdornment?: React.ReactNode;
  trailing?: React.ReactNode;
  chevron?: boolean;
  /** No divider under the last row of a group. */
  last?: boolean;
  titleTone?: TextTone;
  onPress?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
  style?: StyleProp<ViewStyle>;
}

export function ListRow({
  title,
  subtitle,
  icon,
  leading,
  titleAdornment,
  trailing,
  chevron,
  last,
  titleTone = "default",
  onPress,
  testID,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  style,
}: ListRowProps) {
  const { row, forwardChevron } = useDirection();

  const content = (
    <>
      {icon ? (
        <View style={styles.iconWell}>
          <Ionicons
            name={icon}
            size={20}
            color={titleTone === "danger" ? colors.danger : colors.text}
          />
        </View>
      ) : (
        leading
      )}
      <View
        style={[
          styles.body,
          { flexDirection: row },
          subtitle ? styles.bodyTwoLines : null,
          !last && styles.divider,
        ]}
      >
        <View style={styles.text}>
          <View style={[styles.titleLine, { flexDirection: row }]}>
            <AppText
              variant="rowTitle"
              tone={titleTone}
              style={[styles.title, !titleAdornment && styles.titleFill]}
            >
              {title}
            </AppText>
            {titleAdornment}
          </View>
          {subtitle ? (
            <AppText variant="secondary" tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {trailing}
        {chevron ? (
          <Ionicons name={forwardChevron} size={18} color={colors.textMuted} />
        ) : null}
      </View>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, { flexDirection: row }, style]} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        { flexDirection: row },
        pressed && styles.pressed,
        style,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    gap: 14,
    minHeight: 64,
  },
  pressed: {
    opacity: 0.6,
  },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: radius.round,
    backgroundColor: colors.surfaceFill,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 64,
    paddingVertical: spacing.md,
  },
  bodyTwoLines: {
    minHeight: 76,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  text: {
    flex: 1,
    gap: 3,
  },
  titleLine: {
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    flexShrink: 1,
  },
  // Without an adornment the title takes the whole line: Android
  // under-measures shrink-wrapped Arabic bold text and clips its last word.
  titleFill: {
    flexGrow: 1,
  },
});
