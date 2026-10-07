import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import type {
  FlatListProps,
  ScrollViewProps,
  StyleProp,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BOTTOM_SAFE_MIN, colors, spacing } from "../../theme/tokens";
import { Chevron } from "./icons";
import { AppText, useDirection } from "./text";

// ------------------------------------------------------------ safe area
//
// Android 15 / Expo SDK 57 draw edge-to-edge and the native stack header is
// hidden, so every screen keeps its content clear of the status bar and the
// system navigation bar through these primitives.

function baseSpacing(
  style: ViewStyle,
  edge: "paddingBottom" | "paddingTop",
): number {
  const value = style[edge] ?? style.paddingVertical ?? style.padding ?? 0;
  return typeof value === "number" ? value : 0;
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
    paddingBottom: baseSpacing(flat, "paddingBottom") + insets.bottom,
  };
  if (options.top) {
    safe.paddingTop = baseSpacing(flat, "paddingTop") + insets.top;
  }
  return [contentContainerStyle, safe];
}

/** Bottom padding for a fixed bottom bar, button or sheet. */
export function useSafeBottomBar(base: number = BOTTOM_SAFE_MIN): number {
  return Math.max(base, useSafeAreaInsets().bottom);
}

/** Top padding for a headerless screen's first block. */
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

// ---------------------------------------------------------------- header

/**
 * Non-map screen header: a 44 px back chevron (mirrors in RTL) above a
 * 32/800 display title aligned to the reading start. The chevron is shown
 * when there is somewhere to go back to (or an `onBack` override).
 */
export function ScreenHeader({
  title,
  onBack,
  hideBack,
  titleTestID,
}: {
  title?: string;
  onBack?: () => void;
  hideBack?: boolean;
  titleTestID?: string;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { flipRows } = useDirection();
  let canGoBack = false;
  try {
    canGoBack = router.canGoBack();
  } catch {
    // No navigation container (bare unit render).
  }
  const showBack = !hideBack && (!!onBack || canGoBack);

  return (
    <View style={styles.header}>
      {showBack ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("nav.back")}
          onPress={() => (onBack ? onBack() : router.back())}
          style={[styles.back, flipRows && styles.backFlipped]}
          hitSlop={spacing.xs}
          testID="screen-back"
        >
          <Chevron direction="back" size={24} color={colors.text} />
        </Pressable>
      ) : null}
      {title ? (
        <AppText
          variant="display"
          accessibilityRole="header"
          testID={titleTestID}
        >
          {title}
        </AppText>
      ) : null}
    </View>
  );
}

/** 13/700 muted group label above a list ("Account", "Language"). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <AppText
      variant="caption"
      weight="700"
      color={colors.textMuted}
      style={styles.section}
    >
      {children}
    </AppText>
  );
}

// ---------------------------------------------------------------- screens

export interface ScreenProps {
  /** Display title in the ScreenHeader; omit for a bare back chevron. */
  title?: string;
  onBack?: () => void;
  hideBack?: boolean;
  /** Replaces the default header (e.g. the wizard's progress header). */
  header?: React.ReactNode;
  children: React.ReactNode;
  /** Pinned bottom action area (the screen's primary button). */
  footer?: React.ReactNode;
  testID?: string;
  refreshControl?: ScrollViewProps["refreshControl"];
  keyboardShouldPersistTaps?: ScrollViewProps["keyboardShouldPersistTaps"];
}

/**
 * The non-map screen frame: white surface, a scrolling body that starts
 * below the status bar with the ScreenHeader, and an optional pinned
 * footer above the navigation bar.
 */
export function Screen({
  title,
  onBack,
  hideBack,
  header,
  children,
  footer,
  testID,
  refreshControl,
  keyboardShouldPersistTaps,
}: ScreenProps) {
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SafeScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        refreshControl={refreshControl}
        keyboardShouldPersistTaps={keyboardShouldPersistTaps}
        safeTop
        testID={testID}
      >
        {header ?? (
          <ScreenHeader title={title} onBack={onBack} hideBack={hideBack} />
        )}
        {children}
      </SafeScrollView>
      {footer ? <PinnedFooter>{footer}</PinnedFooter> : null}
    </KeyboardAvoidingView>
  );
}

/** A form screen: a Screen whose taps reach buttons while the keyboard is up. */
export function FormScreen(props: ScreenProps) {
  return <Screen keyboardShouldPersistTaps="handled" {...props} />;
}

/** Fixed bottom action area: top rule, 16/20 padding, clear of the nav bar. */
export function PinnedFooter({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  const bottom = useSafeBottomBar();
  return (
    <View style={[styles.footer, { paddingBottom: bottom }]} testID={testID}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    gap: spacing.ms,
  },
  header: { gap: 18, paddingBottom: spacing.sm },
  back: {
    width: 44,
    height: 44,
    alignSelf: "flex-start",
    marginStart: -10,
    alignItems: "center",
    justifyContent: "center",
  },
  // RTL language while the native layout is still LTR: mirror by hand.
  backFlipped: { alignSelf: "flex-end", marginStart: 0, marginEnd: -10 },
  section: { marginTop: spacing.sm },
  footer: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.ml,
    gap: spacing.sm,
  },
});
