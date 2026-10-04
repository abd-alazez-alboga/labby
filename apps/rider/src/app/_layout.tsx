import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';

import { AuthProvider } from '../auth/auth-context';
import { LocaleProvider } from '../i18n/locale-context';

/**
 * Root layout: providers + the two route groups. The (auth) and (app)
 * group layouts own their headers and redirect based on the auth state,
 * so the root stack is header-less. LocaleProvider and AuthProvider both
 * render null until their persisted state is restored, which keeps the
 * native splash screen visible.
 */
export default function RootLayout() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
          <Stack.Screen name="(app)" />
        </Stack>
      </AuthProvider>
    </LocaleProvider>
  );
}
