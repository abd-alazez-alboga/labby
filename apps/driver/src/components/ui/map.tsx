import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type { ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  BOTTOM_SAFE_MIN,
  colors,
  radius,
  shadows,
  spacing,
} from "../../theme/tokens";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { AppText, useDirection } from "./text";

/**
 * Full-bleed map screen: the `map` layer fills the screen on the
 * `surface-map` ground; `top` floats below the status bar (the FAB row) and
 * `bottom` (GO button + sheet) is anchored to the bottom edge.
 */
export function MapScreen({
  map,
  top,
  bottom,
  testID,
}: {
  map?: React.ReactNode;
  top?: React.ReactNode;
  bottom?: React.ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const { flipRows } = useDirection();
  return (
    <View style={styles.screen} testID={testID}>
      <View style={StyleSheet.absoluteFill}>{map}</View>
      {top ? (
        <View
          style={[
            styles.top,
            { top: insets.top + spacing.sm },
            flipRows && styles.rowReverse,
          ]}
          pointerEvents="box-none"
        >
          {top}
        </View>
      ) : null}
      {bottom ? (
        <View style={styles.bottom} pointerEvents="box-none">
          {bottom}
        </View>
      ) : null}
    </View>
  );
}

/**
 * 48 px round white floating button with an optional accent count badge.
 * `plain` is the same control on a white screen: `surface-fill`, no shadow.
 * `selected` makes it an on/off toggle: accent ground + white icon while on.
 */
export function MapFab({
  icon,
  accessibilityLabel,
  onPress,
  badge,
  badgeTestID,
  variant = "floating",
  selected,
  testID,
}: {
  icon: IconName;
  variant?: "floating" | "plain";
  accessibilityLabel: string;
  onPress: () => void;
  /** A count (shown, capped at 99+) or `true` for a plain dot. */
  badge?: number | boolean;
  badgeTestID?: string;
  /** Set for a toggle FAB: its on/off state. */
  selected?: boolean;
  testID?: string;
}) {
  const showBadge = badge === true || (typeof badge === "number" && badge > 0);
  const count =
    typeof badge === "number" ? (badge > 99 ? "99+" : String(badge)) : null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={selected === undefined ? undefined : { selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fab,
        variant === "plain" && styles.fabPlain,
        selected && styles.fabSelected,
        pressed && styles.fabPressed,
      ]}
      testID={testID}
    >
      <Icon name={icon} color={selected ? colors.onAccent : colors.text} />
      {showBadge ? (
        <View
          style={[styles.badge, count ? styles.badgeCount : styles.badgeDot]}
          testID={badgeTestID}
        >
          {count ? (
            <AppText
              variant="caption"
              weight="700"
              color={colors.onAccent}
              style={styles.badgeText}
              align="center"
            >
              {count}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/**
 * White bottom sheet: 24 px top radius, sheet shadow, 40×5 grab handle,
 * 20 px padding and a bottom padding of 34 or the inset, whichever is
 * larger. The body scrolls when it outgrows `maxHeight`.
 */
export function BottomSheet({
  children,
  testID,
  refreshControl,
  maxHeight,
}: {
  children: React.ReactNode;
  testID?: string;
  refreshControl?: ScrollViewProps["refreshControl"];
  maxHeight?: number | `${number}%`;
}) {
  const insets = useSafeAreaInsets();
  const bottom = Math.max(BOTTOM_SAFE_MIN, insets.bottom);
  return (
    <View style={[styles.sheet, maxHeight !== undefined && { maxHeight }]}>
      <View style={styles.handle} />
      <ScrollView
        contentContainerStyle={[styles.sheetBody, { paddingBottom: bottom }]}
        refreshControl={refreshControl}
        testID={testID}
        bounces={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/**
 * The driver's 96 px round accent GO button with a 5 px white ring. Busy
 * shows a spinner; disabled dims it and blocks presses.
 */
export function GoButton({
  label,
  accessibilityLabel,
  onPress,
  disabled,
  busy,
  testID,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  testID?: string;
}) {
  const blocked = !!disabled || !!busy;
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: false, disabled: blocked, busy: !!busy }}
      onPress={() => {
        if (!blocked) onPress();
      }}
      style={({ pressed }) => [
        styles.go,
        pressed && !blocked && styles.goPressed,
        disabled && styles.goDisabled,
      ]}
      testID={testID}
    >
      {busy ? (
        <ActivityIndicator color={colors.onAccent} />
      ) : (
        <AppText variant="title" color={colors.onAccent} align="center">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surfaceMap },
  top: {
    position: "absolute",
    left: spacing.md,
    right: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  rowReverse: { flexDirection: "row-reverse" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.floating,
  },
  fabPlain: {
    backgroundColor: colors.surfaceFill,
    shadowOpacity: 0,
    elevation: 0,
  },
  fabSelected: { backgroundColor: colors.accent },
  fabPressed: { opacity: 0.7 },
  badge: {
    position: "absolute",
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeDot: { top: 10, right: 11, width: 11, height: 11, borderRadius: 6 },
  badgeCount: {
    top: -2,
    right: -2,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 11, lineHeight: 14 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    ...shadows.sheet,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
    marginTop: 10,
  },
  sheetBody: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.md,
    gap: spacing.md,
  },
  go: {
    alignSelf: "center",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 5,
    borderColor: colors.surface,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
    shadowColor: colors.accentPressed,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 20,
    elevation: 8,
  },
  goPressed: { backgroundColor: colors.accentPressed },
  goDisabled: { opacity: 0.4 },
});
