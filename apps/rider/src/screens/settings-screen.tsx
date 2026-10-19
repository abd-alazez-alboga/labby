import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Image, StyleSheet, View } from "react-native";

import { updateProfile } from "../api/auth";
import { ApiStatus } from "../components/api-status";
import { useAuth } from "../auth/auth-context";
import {
  AppText,
  ChoiceChip,
  ListRow,
  ScreenScrollView,
  screenStyles,
  SecondaryButton,
  useDirection,
} from "../components/ui";
import { type AppLocale, SUPPORTED_LOCALES } from "../i18n/translations";
import { reloadIfDirectionChanged, useLocale } from "../i18n/locale-context";
import { useOptionalNotifications } from "../notifications/notifications-context";
import { UnreadBadge } from "../notifications/unread-badge";
import { colors, radius, spacing } from "../theme/tokens";
import { isAccountSuspended } from "../trust/suspension";

const LOCALE_LABEL_KEY: Record<AppLocale, string> = {
  en: "settings.english",
  ar: "settings.arabic",
};

/**
 * Settings hub: language (UC-S-10 — instant switch, best-effort account
 * sync), notifications (center with unread badge + push preferences, M6-T4),
 * account section (profile, password, phone, delete) and logout. Laid out
 * as the design-system list screen: grouped rows with icon wells + chevrons.
 */
export default function SettingsScreen() {
  const { t, locale, direction, setLocale } = useLocale();
  const { row } = useDirection();
  const { user, setUser, signOut, suspensionSignal } = useAuth();
  // GET /reports/mine is refused while the WHOLE account is suspended (M11).
  const accountSuspended = isAccountSuspended(user, suspensionSignal);
  const router = useRouter();
  const notifications = useOptionalNotifications();

  const switchLanguage = async (next: AppLocale) => {
    // Instant local switch (M1 behavior preserved)…
    await setLocale(next);
    // …then persist to the account best-effort (UC-S-10: the preference
    // applies to notifications and SMS templates server-side).
    if (user && user.language !== next) {
      try {
        const updated = await updateProfile({
          name: user.name,
          language: next,
        });
        setUser(updated);
      } catch {
        // offline — the local switch already happened; server sync will
        // happen the next time the profile is saved.
      }
    }
    // A direction change reloads the app so the native layout mirrors.
    await reloadIfDirectionChanged(next, "/settings");
  };

  type IconName = React.ComponentProps<typeof Ionicons>["name"];

  const notificationRows: {
    key: string;
    label: string;
    icon: IconName;
    href: "/notifications" | "/notification-preferences";
    badge: number | null;
  }[] = [
    {
      key: "notifications",
      label: t("settings.notificationCenter"),
      icon: "notifications-outline",
      href: "/notifications",
      badge: notifications?.unread ?? null,
    },
    {
      key: "notification-preferences",
      label: t("settings.notificationPreferences"),
      icon: "options-outline",
      href: "/notification-preferences",
      badge: null,
    },
  ];

  const walletRows: {
    key: string;
    label: string;
    icon: IconName;
    href: "/wallet";
  }[] = [
    {
      key: "wallet",
      label: t("settings.wallet"),
      icon: "wallet-outline",
      href: "/wallet",
    },
  ];

  // M13 growth (approved boards R13Referral/Loyalty/Profile/Challenges).
  const rewardsRows: {
    key: string;
    label: string;
    icon: IconName;
    href: "/loyalty" | "/referral" | "/badges" | "/challenges";
  }[] = [
    {
      key: "loyalty",
      label: t("growth.rowLoyalty"),
      icon: "sparkles-outline",
      href: "/loyalty",
    },
    {
      key: "referral",
      label: t("growth.rowReferral"),
      icon: "gift-outline",
      href: "/referral",
    },
    {
      key: "badges",
      label: t("growth.rowBadges"),
      icon: "ribbon-outline",
      href: "/badges",
    },
    {
      key: "challenges",
      label: t("growth.rowChallenges"),
      icon: "flag-outline",
      href: "/challenges",
    },
  ];

  const rideRows: {
    key: string;
    label: string;
    icon: IconName;
    href: "/rides" | "/reports" | "/saved-places" | "/ride-preferences";
  }[] = [
    {
      key: "rides",
      label: t("settings.rideHistory"),
      icon: "car-outline",
      href: "/rides",
    },
    // M11 (REP-02): the outcome of the reports the rider sent — not
    // while the whole account is suspended (a role-only one keeps it).
    ...(accountSuspended
      ? []
      : [
          {
            key: "reports",
            label: t("reports.title"),
            icon: "flag-outline" as IconName,
            href: "/reports" as const,
          },
        ]),
    {
      key: "saved-places",
      label: t("settings.savedPlaces"),
      icon: "location-outline",
      href: "/saved-places",
    },
    {
      key: "ride-preferences",
      label: t("settings.ridePreferences"),
      icon: "options-outline",
      href: "/ride-preferences",
    },
  ];

  // M14: support home (help center first) + feedback (approved S14 boards).
  const supportRows: {
    key: string;
    label: string;
    icon: IconName;
    href: "/support" | "/feedback";
  }[] = [
    {
      key: "support",
      label: t("support.settingsRow"),
      icon: "help-buoy-outline",
      href: "/support",
    },
    {
      key: "feedback",
      label: t("support.shareFeedback"),
      icon: "chatbox-ellipses-outline",
      href: "/feedback",
    },
  ];

  const accountRows: {
    key: string;
    label: string;
    icon: IconName;
    href:
      | "/profile-edit"
      | "/change-password"
      | "/change-phone"
      | "/delete-account";
  }[] = [
    {
      key: "profile",
      label: t("settings.editProfile"),
      icon: "person-outline",
      href: "/profile-edit",
    },
    {
      key: "password",
      label: t("settings.changePassword"),
      icon: "lock-closed-outline",
      href: "/change-password",
    },
    {
      key: "phone",
      label: t("settings.changePhone"),
      icon: "call-outline",
      href: "/change-phone",
    },
    {
      key: "delete",
      label: t("settings.deleteAccount"),
      icon: "trash-outline",
      href: "/delete-account",
    },
  ];

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="settings-screen"
    >
      {user ? (
        <ListRow
          testID="settings-profile-card"
          title={user.name}
          // A phone number stays left-to-right inside Arabic text.
          subtitle={
            direction === "rtl" ? `\u2066${user.phone}\u2069` : user.phone
          }
          last
          leading={
            user.photoUrl ? (
              <Image
                source={{ uri: user.photoUrl }}
                style={styles.avatar}
                testID="settings-avatar"
              />
            ) : (
              <View
                style={[styles.avatar, styles.avatarFallback]}
                testID="settings-avatar-fallback"
              >
                <AppText variant="heading" tone="accent" align="center">
                  {user.name.trim().charAt(0) || "?"}
                </AppText>
              </View>
            )
          }
        />
      ) : null}

      <View style={styles.section}>
        <AppText variant="heading">{t("settings.language")}</AppText>
        <View style={[styles.choices, { flexDirection: row }]}>
          {SUPPORTED_LOCALES.map((candidate) => (
            <ChoiceChip
              key={candidate}
              label={t(LOCALE_LABEL_KEY[candidate])}
              selected={candidate === locale}
              onPress={() => void switchLanguage(candidate)}
              testID={`language-${candidate}`}
              style={styles.choice}
            />
          ))}
        </View>
        <View style={[styles.directionRow, { flexDirection: row }]}>
          <AppText variant="secondary" tone="muted">
            {t("settings.direction")}
          </AppText>
          <AppText
            variant="caption"
            weight={800}
            tone="accent"
            style={styles.flag}
            testID="direction-flag"
          >
            {direction}
          </AppText>
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="heading">{t("settings.walletSection")}</AppText>
        <View>
          {walletRows.map((item, index) => (
            <ListRow
              key={item.key}
              testID={`settings-${item.key}`}
              title={item.label}
              icon={item.icon}
              chevron
              last={index === walletRows.length - 1}
              onPress={() => router.push(item.href as never)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="heading">{t("growth.rewardsSection")}</AppText>
        <View>
          {rewardsRows.map((item, index) => (
            <ListRow
              key={item.key}
              testID={`settings-${item.key}`}
              title={item.label}
              icon={item.icon}
              chevron
              last={index === rewardsRows.length - 1}
              onPress={() => router.push(item.href as never)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="heading">{t("settings.rides")}</AppText>
        <View>
          {rideRows.map((item, index) => (
            <ListRow
              key={item.key}
              testID={`settings-${item.key}`}
              title={item.label}
              icon={item.icon}
              chevron
              last={index === rideRows.length - 1}
              onPress={() => router.push(item.href as never)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="heading">{t("settings.notifications")}</AppText>
        <View>
          {notificationRows.map((item, index) => (
            <ListRow
              key={item.key}
              testID={`settings-${item.key}`}
              title={item.label}
              icon={item.icon}
              trailing={
                <UnreadBadge
                  count={item.badge}
                  testID={`settings-${item.key}-badge`}
                />
              }
              chevron
              last={index === notificationRows.length - 1}
              onPress={() => router.push(item.href)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="heading">{t("support.settingsSection")}</AppText>
        <View>
          {supportRows.map((item, index) => (
            <ListRow
              key={item.key}
              testID={`settings-${item.key}`}
              title={item.label}
              icon={item.icon}
              chevron
              last={index === supportRows.length - 1}
              onPress={() => router.push(item.href as never)}
            />
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <AppText variant="heading">{t("settings.account")}</AppText>
        <View>
          {accountRows.map((item, index) => (
            <ListRow
              key={item.key}
              testID={`settings-${item.key}`}
              title={item.label}
              icon={item.icon}
              titleTone={item.key === "delete" ? "danger" : "default"}
              chevron
              last={index === accountRows.length - 1}
              onPress={() => router.push(item.href)}
            />
          ))}
        </View>
      </View>

      <SecondaryButton
        label={t("settings.logout")}
        onPress={() => void signOut()}
        testID="settings-logout"
      />

      <ApiStatus />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.round,
  },
  avatarFallback: {
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  section: {
    gap: spacing.md,
    paddingTop: spacing.sm,
  },
  choices: {
    gap: spacing.sm,
  },
  choice: {
    flex: 1,
  },
  directionRow: {
    justifyContent: "space-between",
    alignItems: "center",
  },
  flag: {
    textTransform: "uppercase",
  },
});
