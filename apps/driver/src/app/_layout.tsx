import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getMyProfile } from '../api/auth';
import { AuthProvider, useAuth } from '../auth/AuthProvider';
import { loadStoredSession, updateSessionUser } from '../auth/session';
import { initI18n } from '../i18n';
import type { Language } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { RegionProvider } from '../region/RegionProvider';
import { colors } from '../theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden (e.g. fast refresh) — nothing to do.
});

function AppStack() {
  const { t, i18n: i18nInstance } = useTranslation();
  const { status, isDriver } = useAuth();
  const signedIn = status === 'signedIn';

  return (
    <Stack
      // Re-evaluate titles when the language changes.
      key={i18nInstance.language}
      screenOptions={{
        headerStyle: { backgroundColor: colors.purple700 },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bgLight },
      }}
    >
      {/* Signed-out stack (UC-S-01/02/04). */}
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: t('auth.login.title') }} />
        <Stack.Screen
          name="register"
          options={{ title: t('auth.register.title') }}
        />
        <Stack.Screen
          name="forgot-password"
          options={{ title: t('auth.reset.title') }}
        />
      </Stack.Protected>

      {/* Signed-in app — only for accounts with an ACTIVE driver role. */}
      <Stack.Protected guard={signedIn && isDriver}>
        <Stack.Screen name="index" options={{ title: t('app.name') }} />
        <Stack.Screen
          name="settings"
          options={{ title: t('settings.title') }}
        />
        <Stack.Screen
          name="profile-edit"
          options={{ title: t('account.profile.title') }}
        />
        <Stack.Screen
          name="change-password"
          options={{ title: t('account.password.title') }}
        />
        <Stack.Screen
          name="change-phone"
          options={{ title: t('account.phone.title') }}
        />
        <Stack.Screen
          name="delete-account"
          options={{ title: t('account.delete.title') }}
        />
        {/* Vehicle switch (UC-D-18) — approved, active drivers only. */}
        <Stack.Screen
          name="vehicles"
          options={{ title: t('onboarding.vehicles.title') }}
        />
        <Stack.Screen
          name="vehicle-switch"
          options={{ title: t('onboarding.switch.title') }}
        />
      </Stack.Protected>

      {/* The driver gate: signed in, but no active driver role (M2-T4). */}
      <Stack.Protected guard={signedIn && !isDriver}>
        <Stack.Screen
          name="apply-to-drive"
          options={{ title: t('gate.title'), headerShown: false }}
        />
        {/* Driver application (UC-D-01) and flagged-item resubmission (UC-D-02). */}
        <Stack.Screen
          name="driver-application"
          options={{ title: t('onboarding.apply.title') }}
        />
        <Stack.Screen
          name="application-resubmit"
          options={{ title: t('onboarding.resubmit.title') }}
        />
      </Stack.Protected>

      {/* Document renewal (UC-D-19) — active drivers AND drivers suspended
          for an expired document (renewal is how that suspension lifts). */}
      <Stack.Protected guard={signedIn}>
        <Stack.Screen
          name="documents"
          options={{ title: t('onboarding.documents.title') }}
        />
        <Stack.Screen
          name="renew-document"
          options={{ title: t('onboarding.renewal.title') }}
        />
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  const [language, setLanguage] = useState<Language | null>(null);

  useEffect(() => {
    // Splash stays up until BOTH the persisted language and the stored
    // session are loaded, so the first frame is already the right stack.
    Promise.all([initI18n(), loadStoredSession()])
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
          <StatusBar style="light" />
          <AppStack />
        </RegionProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
