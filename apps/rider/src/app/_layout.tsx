import { IBMPlexSansArabic_400Regular } from "@expo-google-fonts/ibm-plex-sans-arabic/400Regular";
import { IBMPlexSansArabic_600SemiBold } from "@expo-google-fonts/ibm-plex-sans-arabic/600SemiBold";
import { IBMPlexSansArabic_700Bold } from "@expo-google-fonts/ibm-plex-sans-arabic/700Bold";
import { Manrope_400Regular } from "@expo-google-fonts/manrope/400Regular";
import { Manrope_600SemiBold } from "@expo-google-fonts/manrope/600SemiBold";
import { Manrope_700Bold } from "@expo-google-fonts/manrope/700Bold";
import { Manrope_800ExtraBold } from "@expo-google-fonts/manrope/800ExtraBold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";

import { AuthProvider } from "../auth/auth-context";
import { LocaleProvider } from "../i18n/locale-context";

/**
 * Root layout: fonts, providers + the two route groups. The (auth) and (app)
 * group layouts own their headers and redirect based on the auth state, so
 * the root stack is header-less. Nothing renders until the design-system
 * fonts (Manrope + IBM Plex Sans Arabic, per weight) are loaded; then
 * LocaleProvider and AuthProvider render null until their persisted state is
 * restored — all of which keeps the native splash screen visible.
 */
export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
  });

  // A font that fails to load falls back to the system font; never block the app.
  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <LocaleProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </AuthProvider>
    </LocaleProvider>
  );
}
