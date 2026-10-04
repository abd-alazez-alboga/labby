import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';

import { LocaleProvider, useLocale } from '../i18n/locale-context';
import { colors } from '../theme/tokens';

function RootStack() {
  const { t } = useLocale();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.purple700 },
        headerTintColor: colors.white,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.bgLight },
      }}
    >
      <Stack.Screen name="index" options={{ title: t('common.appName') }} />
      <Stack.Screen name="settings" options={{ title: t('settings.title') }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <LocaleProvider>
      <StatusBar style="light" />
      <RootStack />
    </LocaleProvider>
  );
}
