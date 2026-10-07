/**
 * Safe-area primitives every screen builds on. Android 15 / Expo SDK 57 draw
 * edge-to-edge: content runs under the status bar and the system navigation
 * bar, so the last controls of a screen end up under the nav buttons / gesture
 * bar and cannot be tapped. The native stack header already clears the status
 * bar; these helpers handle the rest:
 *
 * - `ScreenScrollView` — a ScrollView whose content gets the bottom inset added
 *   to its own bottom padding, so the last item scrolls fully above the nav bar.
 * - `useInsetContentStyle` — the same for a FlatList's contentContainerStyle.
 * - `useBottomBarPadding` — bottom padding for a fixed bottom panel/button bar.
 * - `Screen` — a non-scrolling full-screen container inset on the given edges
 *   (headerless screens pass `top` as well).
 * - `screenStyles` — the white page ground and the 20 px gutter every
 *   non-map screen uses below its ScreenHeader.
 *
 * Insets always come from react-native-safe-area-context (expo-router mounts
 * its SafeAreaProvider), never from react-native's iOS-only SafeAreaView.
 */
import React from "react";
import {
  ScrollView,
  type ScrollViewProps,
  type StyleProp,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../../theme/tokens";

/** The padding a style already declares on one edge (paddingX > paddingVertical > padding). */
function declaredPadding(
  style: StyleProp<ViewStyle>,
  edge: "top" | "bottom",
): number {
  const flat = StyleSheet.flatten(style) ?? {};
  const value =
    (edge === "top" ? flat.paddingTop : flat.paddingBottom) ??
    flat.paddingVertical ??
    flat.padding ??
    0;
  return typeof value === "number" ? value : 0;
}

/** Scroll content style with the bottom inset added on top of its own bottom padding. */
export function useInsetContentStyle(
  style?: StyleProp<ViewStyle>,
): StyleProp<ViewStyle> {
  const { bottom } = useSafeAreaInsets();
  return [style, { paddingBottom: declaredPadding(style, "bottom") + bottom }];
}

/** Bottom padding for a fixed bottom bar: its own spacing, or the inset when larger. */
export function useBottomBarPadding(base: number): number {
  const { bottom } = useSafeAreaInsets();
  return Math.max(base, bottom);
}

/** ScrollView that keeps its last item reachable above the system navigation bar. */
export function ScreenScrollView({
  contentContainerStyle,
  ...props
}: ScrollViewProps) {
  const insetStyle = useInsetContentStyle(contentContainerStyle);
  return <ScrollView {...props} contentContainerStyle={insetStyle} />;
}

export type ScreenEdge = "top" | "bottom";

/** Non-scrolling screen container padded by the safe-area insets on `edges`. */
export function Screen({
  edges = ["bottom"],
  style,
  ...props
}: ViewProps & { edges?: ScreenEdge[] }) {
  const insets = useSafeAreaInsets();
  const inset: ViewStyle = {};
  if (edges.includes("top"))
    inset.paddingTop = declaredPadding(style, "top") + insets.top;
  if (edges.includes("bottom")) {
    inset.paddingBottom = declaredPadding(style, "bottom") + insets.bottom;
  }
  return <View {...props} style={[style, inset]} />;
}

/** Page ground + content gutter shared by every non-map screen. */
export const screenStyles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  content: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xxl,
    gap: spacing.lg,
  },
});
