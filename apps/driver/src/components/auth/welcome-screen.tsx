import { useRouter } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, View } from "react-native";

import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  PrimaryButton,
  TextButton,
  useDirection,
  useSafeBottomBar,
  useSafeTop,
} from "../ui";

// Brand asset copied from /assets/images/labby-logo.png (source of truth).
const logo = require("../../../assets/images/labby-logo.png");

export function WelcomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { flipRows } = useDirection();
  // Headerless + edge-to-edge: content starts below the status bar and the
  // buttons stay above the system navigation bar.
  const top = useSafeTop(spacing.xl);
  const bottom = useSafeBottomBar();

  return (
    <View style={styles.container} testID="welcome-screen">
      <View style={[styles.hero, { paddingTop: top }]}>
        <Image
          source={logo}
          style={[styles.logo, flipRows && styles.logoEnd]}
          resizeMode="contain"
          accessibilityLabel={t("app.name")}
        />
        <View style={styles.copy}>
          <AppText variant="display">{t("auth.welcome.title")}</AppText>
          <AppText variant="body" color={colors.textSecondary}>
            {t("auth.welcome.subtitle")}
          </AppText>
        </View>
      </View>
      <View
        style={[styles.actions, { paddingBottom: bottom }]}
        testID="welcome-actions"
      >
        <PrimaryButton
          title={t("auth.welcome.login")}
          onPress={() => router.push("/login")}
          testID="welcome-login"
        />
        <TextButton
          title={t("auth.welcome.register")}
          onPress={() => router.push("/register")}
          testID="welcome-register"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  hero: { flex: 1, paddingHorizontal: spacing.ml, gap: spacing.xl },
  logo: { width: 150, height: 27, alignSelf: "flex-start" },
  logoEnd: { alignSelf: "flex-end" },
  copy: { flex: 1, justifyContent: "center", gap: spacing.ms },
  actions: {
    paddingHorizontal: spacing.ml,
    paddingTop: spacing.md,
    gap: spacing.xs,
  },
});
