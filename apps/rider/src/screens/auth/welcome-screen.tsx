import { useRouter } from "expo-router";
import React from "react";
import { Image, StyleSheet, View } from "react-native";

import { useAuth } from "../../auth/auth-context";
import {
  AppText,
  Banner,
  PrimaryButton,
  Screen,
  SecondaryButton,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors, spacing } from "../../theme/tokens";

// Copy of /assets/images/labby-logo.png (repo root is the source of truth).
const logo = require("../../../assets/branding/labby-logo.png");

/**
 * Signed-out landing screen: clean white, bold headline, one dominant
 * action (create account) with log-in as the secondary. Also hosts the
 * post-deletion "goodbye" state and the session-expired note (UC-S-07 /
 * token refresh failure).
 */
export default function WelcomeScreen() {
  const { t } = useLocale();
  const { flipRows } = useDirection();
  const { signOutReason } = useAuth();
  const router = useRouter();

  return (
    <Screen
      edges={["top", "bottom"]}
      style={styles.container}
      testID="welcome-screen"
    >
      <View style={styles.hero}>
        <Image
          source={logo}
          style={[styles.logo, flipRows ? styles.logoRtl : styles.logoLtr]}
          resizeMode="contain"
          accessibilityRole="image"
          accessibilityLabel={t("common.appName")}
        />
        <AppText variant="display">{t("welcome.tagline")}</AppText>
      </View>

      <View style={styles.bottom}>
        {signOutReason === "deleted" ? (
          <Banner
            tone="neutral"
            title={t("welcome.goodbyeTitle")}
            message={t("welcome.goodbyeBody")}
            testID="goodbye-banner"
          />
        ) : null}
        {signOutReason === "expired" ? (
          <Banner
            tone="warning"
            message={t("welcome.sessionExpired")}
            testID="session-expired-banner"
          />
        ) : null}
        <PrimaryButton
          label={t("welcome.createAccount")}
          onPress={() => router.push("/register")}
          testID="welcome-register"
        />
        <SecondaryButton
          label={t("welcome.logIn")}
          onPress={() => router.push("/login")}
          testID="welcome-login"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
    justifyContent: "space-between",
  },
  hero: {
    flex: 1,
    justifyContent: "center",
    gap: spacing.xxl,
  },
  logo: {
    width: 160,
    height: 29,
  },
  logoLtr: {
    alignSelf: "flex-start",
  },
  logoRtl: {
    alignSelf: "flex-end",
  },
  bottom: {
    gap: spacing.md,
  },
});
