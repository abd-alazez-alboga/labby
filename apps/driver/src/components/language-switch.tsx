import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text } from "react-native";

import { updateMyProfile } from "../api/auth";
import { useOptionalAuth } from "../auth/AuthProvider";
import type { Language } from "../i18n";
import { useLocale } from "../i18n/LocaleProvider";
import { fontFamilyFor } from "../theme/fonts";
import { colors, radius, shadows, spacing } from "../theme/tokens";
import { Icon, useDirection } from "./ui";

/**
 * UC-S-10 / NFR-I1: switches the app language on the device at once, then —
 * for a signed-in account — saves it to the account best-effort so pushes
 * and the notification center follow it (W14), before a direction reload
 * can cut the request off. `returnTo` is the screen a direction reload
 * reopens (home reads it); screens the stack lands on by itself (welcome,
 * the driver gate) pass none.
 */
export function useSwitchLanguage(
  returnTo?: string,
): (next: Language) => Promise<void> {
  const { setLanguage } = useLocale();
  const auth = useOptionalAuth();
  return useCallback(
    (next: Language) =>
      setLanguage(next, {
        returnTo,
        beforeReload: async () => {
          const user = auth?.status === "signedIn" ? auth.user : null;
          if (!auth || !user || user.language === next) return;
          try {
            await auth.setUser(
              await updateMyProfile({ name: user.name, language: next }),
            );
          } catch {
            // Offline: the device switch already happened; the account
            // follows the next time the profile is saved.
          }
        },
      }),
    [auth, returnTo, setLanguage],
  );
}

/**
 * W7 (boards V1FDriverSignedOutLanguage / …Ar, V1FDriverApplicantLanguage,
 * V1FDriverSuspendedLanguageAr): the one-tap EN ⇄ العربية pill on screens
 * that cannot reach Settings — welcome, the applicant and suspended gates.
 * It names the OTHER language in its own script; `floating` sits on the
 * map backdrop, `outline` on a white screen.
 */
export function LanguagePill({
  variant,
  testID = "language-pill",
}: {
  variant: "floating" | "outline";
  testID?: string;
}) {
  const { t } = useTranslation();
  const { language } = useLocale();
  const { flipRows } = useDirection();
  const switchLanguage = useSwitchLanguage();
  const [busy, setBusy] = useState(false);
  const target: Language = language === "ar" ? "en" : "ar";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(`settings.switchTo.${target}`)}
      accessibilityState={{ busy }}
      onPress={() => {
        if (busy) return;
        setBusy(true);
        void switchLanguage(target).finally(() => setBusy(false));
      }}
      style={({ pressed }) => [
        styles.pill,
        variant === "floating" ? styles.floating : styles.outline,
        flipRows && styles.rowReverse,
        pressed && styles.pressed,
      ]}
      testID={testID}
    >
      <Icon name="globe-outline" size={18} />
      <Text
        style={[styles.label, { fontFamily: fontFamilyFor("700", target) }]}
        testID={`${testID}-label`}
      >
        {t(target === "ar" ? "settings.arabic" : "settings.english")}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    height: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.round,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  floating: { ...shadows.floating },
  outline: { borderWidth: 1.5, borderColor: colors.lineStrong },
  rowReverse: { flexDirection: "row-reverse" },
  pressed: { opacity: 0.7 },
  label: { fontSize: 15, lineHeight: 20, color: colors.text },
});
