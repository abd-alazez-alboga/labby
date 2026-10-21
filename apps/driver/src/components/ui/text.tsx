import React from "react";
import { StyleSheet, Text } from "react-native";
import type { StyleProp, TextProps, TextStyle } from "react-native";

import { useOptionalLocale } from "../../i18n/LocaleProvider";
import type { Language } from "../../i18n";
import { fontFamilyFor, normalizeWeight } from "../../theme/fonts";
import { colors, typography } from "../../theme/tokens";
import type { FontWeight, TypeVariant } from "../../theme/tokens";

/** Locale facts every primitive needs; safe outside a LocaleProvider. */
export function useDirection(): {
  language: Language;
  rtl: boolean;
  /** Rows must be reversed by hand (RTL language, native layout still LTR). */
  flipRows: boolean;
  textAlign: "left" | "right";
} {
  const locale = useOptionalLocale();
  const language = locale?.language ?? "en";
  const rtl = locale?.direction === "rtl";
  return {
    language,
    rtl,
    flipRows: !!locale?.flipRows,
    // Physical start side. React Native swaps left/right while native RTL is
    // live, so the value is relative to the launch layout, i.e. `flipRows`.
    textAlign: locale?.flipRows ? "right" : "left",
  };
}

export type AppTextProps = TextProps & {
  variant?: TypeVariant;
  /** Overrides the variant's weight. */
  weight?: FontWeight;
  color?: string;
  align?: TextStyle["textAlign"];
  style?: StyleProp<TextStyle>;
};

/**
 * The app's only text primitive: type scale from the design system, the
 * per-weight Manrope / IBM Plex Sans Arabic family for the active locale,
 * and text alignment that follows the reading direction.
 */
export function AppText({
  variant = "body",
  weight,
  color,
  align,
  style,
  ...props
}: AppTextProps) {
  const { language, rtl, textAlign } = useDirection();
  const scale = typography[variant];
  const flat = StyleSheet.flatten(style) ?? {};
  const resolvedWeight = normalizeWeight(
    flat.fontWeight ?? weight ?? scale.weight,
  );
  const base: TextStyle = {
    color: color ?? colors.text,
    fontSize: scale.fontSize,
    lineHeight: scale.lineHeight,
    // Tracking is for Latin display type only — it breaks Arabic joining.
    letterSpacing:
      "letterSpacing" in scale && language !== "ar"
        ? scale.letterSpacing
        : undefined,
    textAlign: align ?? textAlign,
    // L-I3: an explicit RTL base direction, as the rider app does, so bidi
    // isolates (U+2066…U+2069 around a "+963…" phone) resolve inside an Arabic
    // sentence instead of leaking the "+" to the wrong end. A caller's own
    // writingDirection (style) still wins.
    writingDirection: rtl ? "rtl" : undefined,
  };
  return (
    <Text
      {...props}
      style={[
        base,
        flat,
        {
          fontFamily: fontFamilyFor(resolvedWeight, language),
          fontWeight: undefined,
        },
      ]}
    />
  );
}

/** Body copy in the secondary text colour (intros, hints). */
export function BodyText({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <AppText variant="body" color={colors.textSecondary} testID={testID}>
      {children}
    </AppText>
  );
}

/** 14 px muted secondary line (captions under content, dates). */
export function Muted({
  children,
  testID,
}: {
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <AppText variant="secondary" color={colors.textMuted} testID={testID}>
      {children}
    </AppText>
  );
}
