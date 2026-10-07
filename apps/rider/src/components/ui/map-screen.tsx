/**
 * Map-first screen primitives (design system):
 * - `MapScreen`   full-bleed map (surface-map ground) with floating buttons
 *                 laid over it below the status bar, and a bottom sheet.
 * - `MapFab`      48 px round white floating button, 20 px icon, required
 *                 accessibility label, optional badge.
 * - `BottomSheet` white, 24 px top radius, sheet shadow, 40×5 grab handle,
 *                 padding 20, bottom padding = 34 or the safe-area inset.
 */
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, shadows, spacing } from "../../theme/tokens";
import { useDirection } from "./direction";
import { useBottomBarPadding } from "./screen";

export function MapScreen({
  map,
  floating,
  sheet,
  testID,
}: {
  map: React.ReactNode;
  /** Floating buttons along the top edge, laid out start → end. */
  floating?: React.ReactNode;
  sheet: React.ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const { row } = useDirection();
  return (
    <View style={styles.screen} testID={testID}>
      <View style={styles.map}>{map}</View>
      {floating ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.floating,
            { top: insets.top + spacing.sm, flexDirection: row },
          ]}
        >
          {floating}
        </View>
      ) : null}
      {sheet}
    </View>
  );
}

export function MapFab({
  icon,
  accessibilityLabel,
  onPress,
  badge,
  testID,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  accessibilityLabel: string;
  onPress: () => void;
  badge?: React.ReactNode;
  testID?: string;
}) {
  const { flipRows } = useDirection();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={colors.text} />
      {badge ? (
        <View
          style={[styles.badge, flipRows ? styles.badgeRtl : styles.badgeLtr]}
        >
          {badge}
        </View>
      ) : null}
    </Pressable>
  );
}

export function BottomSheet({
  children,
  testID,
  style,
}: {
  children: React.ReactNode;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const paddingBottom = useBottomBarPadding(SHEET_BOTTOM_PADDING);
  return (
    <View style={[styles.sheet, style, { paddingBottom }]} testID={testID}>
      <View style={styles.handle} />
      {children}
    </View>
  );
}

/** Sheet bottom padding when the device has no larger inset. */
export const SHEET_BOTTOM_PADDING = 34;

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surfaceMap,
  },
  // The map ends at the sheet's top edge (its rounded corners show the
  // surface-map ground) so the tile attribution stays visible.
  map: {
    flex: 1,
  },
  floating: {
    position: "absolute",
    start: spacing.lg,
    end: spacing.lg,
    justifyContent: "space-between",
    alignItems: "center",
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: radius.round,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.floating,
  },
  fabPressed: {
    backgroundColor: colors.surfaceFill,
  },
  badge: {
    position: "absolute",
    top: -4,
  },
  badgeLtr: {
    end: -4,
  },
  badgeRtl: {
    start: -4,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopStartRadius: radius.sheet,
    borderTopEndRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    ...shadows.sheet,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
  },
});
