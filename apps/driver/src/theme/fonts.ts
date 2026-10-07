import { IBMPlexSansArabic_400Regular } from "@expo-google-fonts/ibm-plex-sans-arabic/400Regular";
import { IBMPlexSansArabic_600SemiBold } from "@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold";
import { IBMPlexSansArabic_700Bold } from "@expo-google-fonts/ibm-plex-sans-arabic/700Bold";
import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import * as Font from "expo-font";

import type { Language } from "../i18n";
import type { FontWeight } from "./tokens";

/**
 * Typography (docs/design/design-system.md): Manrope for EN, IBM Plex Sans
 * Arabic for AR. Android ignores `fontWeight` on custom fonts, so every
 * weight is its own family name; AppText maps weight → family. Only the
 * weights the spec uses are bundled (400/600/700/800; Plex tops out at 700).
 */
const FONT_ASSETS = {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
};

const LATIN: Record<FontWeight, keyof typeof FONT_ASSETS> = {
  "400": "Manrope_400Regular",
  "600": "Manrope_600SemiBold",
  "700": "Manrope_700Bold",
  "800": "Manrope_800ExtraBold",
};

const ARABIC: Record<FontWeight, keyof typeof FONT_ASSETS> = {
  "400": "IBMPlexSansArabic_400Regular",
  "600": "IBMPlexSansArabic_600SemiBold",
  "700": "IBMPlexSansArabic_700Bold",
  "800": "IBMPlexSansArabic_700Bold",
};

/** Snaps any RN weight to the nearest bundled one. */
export function normalizeWeight(weight: unknown): FontWeight {
  const value =
    weight === "bold" ? 700 : weight === "normal" ? 400 : Number(weight);
  if (!Number.isFinite(value) || value < 500) return "400";
  if (value < 650) return "600";
  if (value < 750) return "700";
  return "800";
}

export function fontFamilyFor(weight: FontWeight, language: Language): string {
  return (language === "ar" ? ARABIC : LATIN)[weight];
}

/** Loads every app font; the root layout keeps the splash up until it settles. */
export async function loadAppFonts(): Promise<void> {
  try {
    await Font.loadAsync(FONT_ASSETS);
  } catch {
    // A font failure must never block startup — text falls back to the system face.
  }
}
