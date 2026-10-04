import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { initI18n } from '../i18n';
import type { Language } from '../i18n';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { colors } from '../theme/tokens';

SplashScreen.preventAutoHideAsync().catch(() => {
  // Already hidden (e.g. fast refresh) — nothing to do.
});

function AppStack() {
  const { t, i18n: i18nInstance } = useTranslation();

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
      <Stack.Screen name="index" options={{ title: t('app.name') }} />
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [language, setLanguage] = useState<Language | null>(null);

  useEffect(() => {
    initI18n()
      .then(setLanguage)
      .finally(() => {
        SplashScreen.hideAsync().catch(() => {});
      });
  }, []);

  if (language === null) {
    // Splash screen is still visible while the persisted language loads.
    return null;
  }

  return (
    <LocaleProvider initialLanguage={language}>
      <StatusBar style="light" />
      <AppStack />
    </LocaleProvider>
  );
}
