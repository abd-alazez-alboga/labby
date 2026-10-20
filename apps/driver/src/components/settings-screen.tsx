import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { ApiStatus } from "./api-status";
import { updateMyProfile } from "../api/auth";
import { useOptionalAuth } from "../auth/AuthProvider";
import { useLocale } from "../i18n/LocaleProvider";
import { SUPPORTED_LANGUAGES } from "../i18n";
import type { Language } from "../i18n";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";
import { spacing } from "../theme/tokens";
import { ListRow, OptionGroup, Screen, SectionLabel, StatusChip } from "./ui";
import type { IconName } from "./ui";

/** Driver tools that used to sit on home; the home Menu button leads here. */
const DRIVING_LINKS: {
  href: Href;
  labelKey: string;
  icon: IconName;
  testID: string;
}[] = [
  {
    href: "/earnings",
    labelKey: "earnings.title",
    icon: "stats-chart-outline",
    testID: "earnings-link",
  },
  {
    href: "/balance",
    labelKey: "balance.title",
    icon: "wallet-outline",
    testID: "balance-link",
  },
  // M15 (UC-D-17): weekly trip, peak-hour and rating incentives.
  {
    href: "/incentives",
    labelKey: "incentives.title",
    icon: "ribbon-outline",
    testID: "incentives-link",
  },
  // M11 (UC-D-20, UC-S-18): performance dashboard + the driver's reports.
  {
    href: "/performance",
    labelKey: "trust.links.performance",
    icon: "speedometer-outline",
    testID: "performance-link",
  },
  {
    href: "/reports",
    labelKey: "trust.links.reports",
    icon: "flag-outline",
    testID: "reports-link",
  },
  // M13 (UC-S-23/24): level & badges, challenges.
  {
    href: "/level",
    labelKey: "growth.links.level",
    icon: "medal-outline",
    testID: "level-link",
  },
  {
    href: "/challenges",
    labelKey: "growth.links.challenges",
    icon: "trophy-outline",
    testID: "challenges-link",
  },
  {
    href: "/vehicles",
    labelKey: "home.myVehicle",
    icon: "car-outline",
    testID: "vehicles-link",
  },
  {
    href: "/documents",
    labelKey: "home.myDocuments",
    icon: "document-text-outline",
    testID: "documents-link",
  },
  // M14 (UC-S-19/21): the support home — help center first.
  {
    href: "/support",
    labelKey: "support.title",
    icon: "help-circle-outline",
    testID: "settings-link-support",
  },
];

const ACCOUNT_LINKS: {
  href: Href;
  labelKey: string;
  icon: IconName;
  testID: string;
}[] = [
  {
    href: "/profile-edit",
    labelKey: "account.editProfile",
    icon: "person-outline",
    testID: "settings-link-profile-edit",
  },
  {
    href: "/change-password",
    labelKey: "account.changePassword",
    icon: "lock-closed-outline",
    testID: "settings-link-change-password",
  },
  {
    href: "/change-phone",
    labelKey: "account.changePhone",
    icon: "call-outline",
    testID: "settings-link-change-phone",
  },
  {
    href: "/delete-account",
    labelKey: "account.deleteAccount",
    icon: "trash-outline",
    testID: "settings-link-delete-account",
  },
];

const LANGUAGE_LABEL_KEYS: Record<Language, string> = {
  en: "settings.english",
  ar: "settings.arabic",
};

export function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { language, direction, setLanguage } = useLocale();
  // Optional: unit tests render this screen without an AuthProvider, and
  // the driving/account sections only make sense for a signed-in session.
  const auth = useOptionalAuth();
  const signedIn = auth?.status === "signedIn" && !!auth.user;
  // UC-S-03 E1: no logging out while a job is running (accepted..payment).
  const rideActive = !!useOptionalDriverRide()?.ride;

  // UC-S-10: the switch applies on the device at once, then is saved to
  // the account best-effort so pushes and the notification center follow
  // it (W14) — before a direction reload can cut the request off.
  const switchLanguage = (next: Language) =>
    setLanguage(next, {
      returnTo: "/settings",
      beforeReload: async () => {
        const user = auth?.user;
        if (!signedIn || !user || user.language === next) return;
        try {
          await auth.setUser(
            await updateMyProfile({ name: user.name, language: next }),
          );
        } catch {
          // Offline: the device switch already happened; the account
          // follows the next time the profile is saved.
        }
      },
    });

  return (
    <Screen title={t("settings.title")} testID="settings-screen">
      {signedIn ? (
        <>
          <View>
            {DRIVING_LINKS.map((item, index) => (
              <ListRow
                key={item.testID}
                icon={item.icon}
                title={t(item.labelKey)}
                chevron
                onPress={() => router.push(item.href)}
                last={index === DRIVING_LINKS.length - 1}
                testID={item.testID}
              />
            ))}
          </View>
          <SectionLabel>{t("account.section")}</SectionLabel>
          <View>
            {ACCOUNT_LINKS.map((item) => (
              <ListRow
                key={item.testID}
                icon={item.icon}
                title={t(item.labelKey)}
                chevron
                onPress={() => router.push(item.href)}
                testID={item.testID}
              />
            ))}
            <ListRow
              icon="log-out-outline"
              title={t("account.logout")}
              subtitle={rideActive ? t("account.logoutBlockedRide") : null}
              tone="danger"
              onPress={() => auth.signOut()}
              disabled={rideActive}
              last
              testID="settings-logout"
            />
          </View>
        </>
      ) : null}

      <SectionLabel>{t("settings.language")}</SectionLabel>
      <OptionGroup
        options={SUPPORTED_LANGUAGES}
        value={language}
        onChange={(option) => void switchLanguage(option)}
        labelFor={(option) => t(LANGUAGE_LABEL_KEYS[option])}
        testIDPrefix="language-option"
      />

      {/* I96: M1 shell diagnostics — development builds only. */}
      {__DEV__ ? (
        <>
          <SectionLabel>{t("settings.direction")}</SectionLabel>
          <ListRow
            title={t(direction === "rtl" ? "settings.rtl" : "settings.ltr")}
            trailing={
              <StatusChip
                label={direction.toUpperCase()}
                tone="accent"
                testID="direction-flag"
              />
            }
            last
          />
          <View style={styles.api}>
            <ApiStatus />
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  api: { marginTop: spacing.sm },
});
