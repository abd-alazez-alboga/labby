import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, View } from "react-native";

import { colors, radius, shadows, spacing } from "../../theme/tokens";
import { LanguagePill } from "../language-switch";
import {
  AppText,
  Icon,
  MapScreen,
  PrimaryButton,
  SecondaryButton,
  useDirection,
  useSafeBottomBar,
} from "../ui";

/**
 * The map-style ground of the welcome screen (decorative, as drawn on the
 * board): a few streets and the driver's car marker. Hidden from assistive
 * technology.
 */
function WelcomeBackdrop() {
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      testID="welcome-backdrop"
    >
      <View style={[styles.street, styles.streetA]} />
      <View style={[styles.street, styles.streetB]} />
      <View style={[styles.street, styles.streetC]} />
      <View style={styles.car}>
        <View style={styles.carIcon}>
          <Icon name="navigate" size={18} color={colors.onAccent} />
        </View>
      </View>
    </View>
  );
}

/** The app mark + name pill at the top start. */
function BrandPill() {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  return (
    <View
      style={[styles.brand, flipRows && styles.rowReverse]}
      testID="welcome-brand"
    >
      {/* The real Labby icon (owner-approved boards LFLogoDriverWelcome(Ar), 2026-10-21). */}
      <Image
        source={require("../../../assets/images/labby-icon.png")}
        style={styles.mark}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        accessible={false}
      />
      <AppText variant="label" weight="800">
        {t("auth.welcome.brand")}
      </AppText>
    </View>
  );
}

/**
 * Signed-out landing (UC-S-01/02), boards V1FDriverSignedOutLanguage /
 * V1FDriverSignedOutLanguageAr (W7): map-style ground, the brand pill and
 * the one-tap language pill on top, and a bottom sheet with the headline,
 * Log in (the one dominant action) and Create account.
 */
export function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const bottom = useSafeBottomBar();

  return (
    <MapScreen
      testID="welcome-screen"
      map={<WelcomeBackdrop />}
      top={
        <>
          <BrandPill />
          <LanguagePill variant="floating" />
        </>
      }
      bottom={
        <View
          style={[styles.sheet, { paddingBottom: bottom }]}
          testID="welcome-actions"
        >
          <View style={styles.handle} />
          <View style={styles.copy}>
            <AppText variant="display">{t("auth.welcome.title")}</AppText>
            <AppText variant="body" color={colors.textSecondary}>
              {t("auth.welcome.subtitle")}
            </AppText>
          </View>
          <PrimaryButton
            title={t("auth.welcome.login")}
            onPress={() => router.push("/login")}
            testID="welcome-login"
          />
          <SecondaryButton
            title={t("auth.welcome.register")}
            onPress={() => router.push("/register")}
            testID="welcome-register"
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  street: { position: "absolute", backgroundColor: colors.surface },
  streetA: {
    left: -40,
    top: 150,
    width: 520,
    height: 16,
    transform: [{ rotate: "-10deg" }],
  },
  streetB: {
    left: 210,
    top: -40,
    width: 12,
    height: 460,
    transform: [{ rotate: "10deg" }],
  },
  streetC: {
    left: -30,
    top: 330,
    width: 480,
    height: 10,
    transform: [{ rotate: "18deg" }],
  },
  car: {
    position: "absolute",
    left: 150,
    top: 250,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 4,
    borderColor: colors.surface,
    backgroundColor: colors.text,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.floating,
  },
  // Ionicons "navigate" points up-right; the board's arrow points up.
  carIcon: { transform: [{ rotate: "-45deg" }] },
  brand: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingStart: spacing.sm,
    paddingEnd: 14,
    borderRadius: radius.round,
    backgroundColor: colors.surface,
    ...shadows.floating,
  },
  rowReverse: { flexDirection: "row-reverse" },
  mark: { width: 32, height: 32 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingTop: 10,
    paddingHorizontal: spacing.ml,
    gap: spacing.md,
    ...shadows.sheet,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.grabHandle,
  },
  copy: { gap: 6 },
});
