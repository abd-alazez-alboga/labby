import React from 'react';
import { FlatList, ScrollView, StyleSheet } from 'react-native';
import type {
  FlatListProps,
  ScrollViewProps,
  StyleProp,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Safe-area primitives. Android 15 / Expo SDK 57 draw edge-to-edge, so every
 * screen must keep its content clear of the status bar and the system
 * navigation bar. Screens use these instead of plain ScrollView/FlatList so
 * new screens get the insets by default.
 */

function baseSpacing(
  style: ViewStyle,
  edge: 'paddingBottom' | 'paddingTop',
): number {
  const value = style[edge] ?? style.paddingVertical ?? style.padding ?? 0;
  return typeof value === 'number' ? value : 0;
}

/**
 * A scroll container's content style with the insets ADDED to its existing
 * padding, so the last item scrolls fully above the navigation bar (and,
 * with `top`, the first one starts below the status bar).
 */
export function useSafeContentStyle(
  contentContainerStyle?: StyleProp<ViewStyle>,
  options: { top?: boolean } = {},
): StyleProp<ViewStyle> {
  const insets = useSafeAreaInsets();
  const flat = StyleSheet.flatten(contentContainerStyle) ?? {};
  const safe: ViewStyle = {
    paddingBottom: baseSpacing(flat, 'paddingBottom') + insets.bottom,
  };
  if (options.top) {
    safe.paddingTop = baseSpacing(flat, 'paddingTop') + insets.top;
  }
  return [contentContainerStyle, safe];
}

/** Bottom padding for a fixed (non-scrolling) bottom bar, button or sheet. */
export function useSafeBottomBar(base: number): number {
  return Math.max(base, useSafeAreaInsets().bottom);
}

/** Top padding for a headerless screen's first block (e.g. a hero). */
export function useSafeTop(base: number): number {
  return base + useSafeAreaInsets().top;
}

type SafeTopProp = {
  /** Headerless screens: also keep the content below the status bar. */
  safeTop?: boolean;
};

/** ScrollView whose content always clears the system bars. */
export function SafeScrollView({
  contentContainerStyle,
  safeTop,
  ...props
}: ScrollViewProps & SafeTopProp) {
  const style = useSafeContentStyle(contentContainerStyle, { top: safeTop });
  return <ScrollView {...props} contentContainerStyle={style} />;
}

/** FlatList whose content always clears the system bars. */
export function SafeFlatList<T>({
  contentContainerStyle,
  safeTop,
  ...props
}: FlatListProps<T> & SafeTopProp) {
  const style = useSafeContentStyle(contentContainerStyle, { top: safeTop });
  return <FlatList {...props} contentContainerStyle={style} />;
}
