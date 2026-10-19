import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { getMyProfile } from "../api/auth";
import { AuthProvider, useAuth } from "../auth/AuthProvider";
import { ChatProvider } from "../chat/ChatProvider";
import { loadStoredSession, updateSessionUser } from "../auth/session";
import { initI18n } from "../i18n";
import type { Language } from "../i18n";
import { HeatmapProvider } from "../heatmap/HeatmapProvider";
import { LocaleProvider } from "../i18n/LocaleProvider";
import { DriverMoneyProvider } from "../money/DriverMoneyProvider";
import { PushBridge } from "../notifications/PushBridge";
// M6-X2: the background GPS task must be defined at load, before anything mounts.
import "../realtime/background-location-task";
import { AvailabilityProvider } from "../realtime/AvailabilityProvider";
import { RegionProvider } from "../region/RegionProvider";
import { DriverRideProvider } from "../rides/DriverRideProvider";
import { loadAppFonts } from "../theme/fonts";
import { RatingPromptProvider } from "../trust/RatingPromptProvider";
import { colors } from "../theme/tokens";

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden (e.g. fast refresh) — nothing to do.
});

function AppStack() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { status, isDriver, driverAccess } = useAuth();
  const signedIn = status === "signedIn";
  // M11: a suspended driver ROLE still reads earnings, balance and
  // performance (the suspended screen links there).
  const driverTools = isDriver || driverAccess === "roleSuspended";

  return (
    <Stack
      // Re-evaluate titles when the language changes.
      key={i18nInstance.language}
      // Every screen draws its own header (ScreenHeader / map FABs) —
      // design system 2026-10-07; titles below stay for accessibility.
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.surface },
      }}
    >
      {/* Signed-out stack (UC-S-01/02/04). */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" />
        <Stack.Screen name="login" options={{ title: t("auth.login.title") }} />
        <Stack.Screen
          name="register"
          options={{ title: t("auth.register.title") }}
        />
        <Stack.Screen
          name="forgot-password"
          options={{ title: t("auth.reset.title") }}
        />
      </Stack.Protected>

      {/* Signed-in app — only for accounts with an ACTIVE driver role. */}
      <Stack.Protected guard={signedIn && isDriver}>
        <Stack.Screen name="index" options={{ title: t("app.name") }} />
        <Stack.Screen
          name="settings"
          options={{ title: t("settings.title") }}
        />
        <Stack.Screen
          name="profile-edit"
          options={{ title: t("account.profile.title") }}
        />
        <Stack.Screen
          name="change-password"
          options={{ title: t("account.password.title") }}
        />
        <Stack.Screen
          name="change-phone"
          options={{ title: t("account.phone.title") }}
        />
        <Stack.Screen
          name="delete-account"
          options={{ title: t("account.delete.title") }}
        />
        {/* Vehicle switch (UC-D-18) — approved, active drivers only. */}
        <Stack.Screen
          name="vehicles"
          options={{ title: t("onboarding.vehicles.title") }}
        />
        <Stack.Screen
          name="vehicle-switch"
          options={{ title: t("onboarding.switch.title") }}
        />
        {/* Per-ride chat (M10, UC-S-13/14). */}
        <Stack.Screen name="chat" options={{ title: t("chat.title") }} />
        {/* Support & content (M14, UC-S-19..22, UC-D-21). */}
        <Stack.Screen name="support" options={{ title: t("support.title") }} />
        <Stack.Screen
          name="help-category"
          options={{ title: t("support.topics") }}
        />
        <Stack.Screen
          name="help-article"
          options={{ title: t("support.topics") }}
        />
        <Stack.Screen
          name="help-search"
          options={{ title: t("support.searchEntry") }}
        />
        <Stack.Screen
          name="ticket-create"
          options={{ title: t("support.create.title") }}
        />
        <Stack.Screen
          name="tickets"
          options={{ title: t("support.tickets.title") }}
        />
        <Stack.Screen
          name="ticket"
          options={{ title: t("support.tickets.title") }}
        />
        <Stack.Screen
          name="lost-item-case"
          options={{ title: t("support.lost.title") }}
        />
        <Stack.Screen
          name="feedback"
          options={{ title: t("support.feedback.title") }}
        />
        {/* Shared ride: one private thread per member (M12, ruling 2026-10-16). */}
        <Stack.Screen
          name="shared-chats"
          options={{ title: t("chat.sharedTitle") }}
        />
        {/* Scheduled rides (M12): claim board + claims, availability windows. */}
        <Stack.Screen
          name="scheduled-rides"
          options={{ title: t("scheduled.title") }}
        />
        <Stack.Screen
          name="availability-windows"
          options={{ title: t("scheduled.availability.title") }}
        />
      </Stack.Protected>

      {/* The driver gate: signed in, but no active driver role (M2-T4). */}
      <Stack.Protected guard={signedIn && !isDriver}>
        <Stack.Screen
          name="apply-to-drive"
          options={{ title: t("gate.title") }}
        />
        {/* Driver application (UC-D-01) and flagged-item resubmission (UC-D-02). */}
        <Stack.Screen
          name="driver-application"
          options={{ title: t("onboarding.apply.title") }}
        />
        <Stack.Screen
          name="application-resubmit"
          options={{ title: t("onboarding.resubmit.title") }}
        />
      </Stack.Protected>

      {/* Earnings & balance (M8, UC-D-15/16), performance (M11, UC-D-20)
          and rating / reporting (M11) — active drivers AND a suspended
          driver role. Declared after the
          gate so a suspended driver lands on the gate, not here. */}
      <Stack.Protected guard={signedIn && driverTools}>
        <Stack.Screen
          name="earnings"
          options={{ title: t("earnings.title") }}
        />
        <Stack.Screen
          name="balance"
          options={{ title: t("balance.title") }}
        />
        {/* Incentives (M15, UC-D-17) — weekly progress, informational like
            earnings, so a role-suspended driver may look. */}
        <Stack.Screen
          name="incentives"
          options={{ title: t("incentives.title") }}
        />
        <Stack.Screen
          name="performance"
          options={{ title: t("trust.performance.title") }}
        />
        {/* Level & badges and challenges (M13, UC-S-23/24) — informational,
            never affect dispatch, so a role-suspended driver may look. */}
        <Stack.Screen
          name="level"
          options={{ title: t("growth.level.title") }}
        />
        <Stack.Screen
          name="challenges"
          options={{ title: t("growth.challenges.title") }}
        />
        {/* Rate / report the rider and the driver's reports (M11,
            UC-S-17/18) — the backend allows them on a ROLE suspension;
            only a whole-account suspension refuses them. */}
        <Stack.Screen
          name="rate-rider"
          options={{ title: t("trust.rate.submit") }}
        />
        <Stack.Screen
          name="report-rider"
          options={{ title: t("trust.report.send") }}
        />
        <Stack.Screen
          name="report-member"
          options={{ title: t("trust.report.pickTitle") }}
        />
        <Stack.Screen
          name="reports"
          options={{ title: t("trust.reports.title") }}
        />
      </Stack.Protected>

      {/* Document renewal (UC-D-19) — active drivers AND drivers suspended
          for an expired document (renewal is how that suspension lifts). */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen
          name="documents"
          options={{ title: t("onboarding.documents.title") }}
        />
        <Stack.Screen
          name="renew-document"
          options={{ title: t("onboarding.renewal.title") }}
        />
        {/* Notification center + preferences (M6, UC-S-11/12) — every
            signed-in account: applicants get their stage updates here too. */}
        <Stack.Screen
          name="notifications"
          options={{ title: t("notifications.title") }}
        />
        <Stack.Screen
          name="notification-preferences"
          options={{ title: t("notifications.settings") }}
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [language, setLanguage] = useState<Language | null>(null);

  useEffect(() => {
    // Splash stays up until the language, the stored session AND the fonts
    // are loaded, so the first frame is already the right stack and type.
    Promise.all([initI18n(), loadStoredSession(), loadAppFonts()])
      .then(([storedLanguage, session]) => {
        setLanguage(storedLanguage);
        if (session) {
          // Refresh the cached profile in the background — role changes
          // (e.g. driver approval) re-evaluate the gate without a re-login.
          getMyProfile()
            .then(updateSessionUser)
            .catch(() => {});
        }
      })
      .finally(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
  }, []);

  if (language === null) {
    // Splash screen is still visible while startup state loads.
    return null;
  }

  return (
    <LocaleProvider initialLanguage={language}>
      <AuthProvider>
        {/* Region resolution (M4-T4) — only active for a signed-in driver. */}
        <RegionProvider>
          {/* Online/offline + location streaming (M6-T4) — active drivers only. */}
          <AvailabilityProvider>
            {/* Balance / floor status, refreshed with availability (M8-T4). */}
            <DriverMoneyProvider>
              {/* Open offer + active ride facade on the same socket (M7-T4). */}
              <DriverRideProvider>
                {/* Post-trip rating prompt + pending ratings (M11-T3). */}
                <RatingPromptProvider>
                  {/* Per-ride chat thread on the same socket (M10-T3). */}
                  <ChatProvider>
                    {/* Demand heatmap, refreshed once per surge cycle (M9-T2). */}
                    <HeatmapProvider>
                      <StatusBar style="dark" />
                      <AppStack />
                    </HeatmapProvider>
                    {/* Push registration + notification-tap deep links (M6-T4). */}
                    <PushBridge />
                  </ChatProvider>
                </RatingPromptProvider>
              </DriverRideProvider>
            </DriverMoneyProvider>
          </AvailabilityProvider>
        </RegionProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
