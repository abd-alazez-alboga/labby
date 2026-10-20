/**
 * The app's only text primitive. Android ignores `fontWeight` on custom
 * fonts, so the weight is mapped to the per-weight family name; the family
 * follows the active locale (AR → IBM Plex Sans Arabic, EN → Manrope).
 * In RTL the text is right-aligned with an RTL writing direction.
 */
import React from "react";
import { StyleSheet, Text, type TextProps, type TextStyle } from "react-native";

import { useOptionalLocale } from "../../i18n/locale-context";
import {
  ARABIC_LINE_HEIGHT_RATIO,
  colors,
  type FontWeight,
  fontFamilies,
  type TypeVariant,
  typography,
} from "../../theme/tokens";

export type TextTone =
  | "default"
  | "secondary"
  | "muted"
  | "accent"
  | "onAccent"
  | "success"
  | "warning"
  | "danger";

const TONE_COLOR: Record<TextTone, string> = {
  default: colors.text,
  secondary: colors.textSecondary,
  muted: colors.textMuted,
  accent: colors.accent,
  onAccent: colors.onAccent,
  success: colors.success,
  warning: colors.warning,
  danger: colors.danger,
};

/** Arabic line height for a font size: 1.5× the size, rounded up. */
export function arabicLineHeight(fontSize: number): number {
  return Math.ceil(fontSize * ARABIC_LINE_HEIGHT_RATIO);
}

/** Font family for a weight in the active script. */
export function useFontFamily(weight: FontWeight): string {
  const locale = useOptionalLocale();
  return fontFamilies[locale?.locale === "ar" ? "arabic" : "latin"][weight];
}

export interface AppTextProps extends TextProps {
  variant?: TypeVariant;
  /** Overrides the variant's weight. */
  weight?: FontWeight;
  tone?: TextTone;
  /** `start` follows the reading direction; `center` stays centred. */
  align?: "start" | "center";
}

export function AppText({
  variant = "body",
  weight,
  tone = "default",
  align = "start",
  style,
  ...props
}: AppTextProps) {
  const locale = useOptionalLocale();
  const isRTL = locale?.isRTL ?? false;
  // Physical start side. React Native swaps left/right while native RTL is
  // live, so the value is relative to the launch layout, i.e. `flipRows`.
  const flipRows = locale?.flipRows ?? false;
  const arabic = locale?.locale === "ar";
  const type = typography[variant];
  const family = useFontFamily(weight ?? type.weight);
  const base: TextStyle = {
    fontFamily: family,
    fontSize: type.fontSize,
    // Tracking is for Latin type only — it breaks Arabic joining and makes
    // Android under-measure (and clip) Arabic lines.
    letterSpacing: arabic ? undefined : type.letterSpacing,
    color: TONE_COLOR[tone],
  };
  if (arabic) {
    // IBM Plex Sans Arabic draws taller than its font metrics: without an
    // explicit line height Android measures a wrapped line too short and
    // drops it (a name at the end of a short title vanished). The height
    // follows the size actually used, so a caller's fontSize override
    // never clips either; a caller's own lineHeight still wins.
    const own = StyleSheet.flatten(style) as TextStyle | undefined;
    base.lineHeight = arabicLineHeight(own?.fontSize ?? type.fontSize);
  }
  return (
    <Text
      // The default "highQuality" strategy under-measures Arabic runs on
      // Android and pushes the last word onto a clipped line (W2).
      textBreakStrategy="simple"
      {...props}
      style={[
        base,
        align === "center" && styles.center,
        isRTL && styles.rtl,
        isRTL &&
          align === "start" &&
          (flipRows ? styles.alignRight : styles.alignLeft),
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    textAlign: "center",
  },
  rtl: {
    writingDirection: "rtl",
  },
  alignRight: {
    textAlign: "right",
  },
  alignLeft: {
    textAlign: "left",
  },
});
