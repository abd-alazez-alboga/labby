import { Redirect, Stack } from 'expo-router';
import React from 'react';

import { useAuth } from '../../auth/auth-context';
import { useLocale } from '../../i18n/locale-context';
import { NotificationsProvider } from '../../notifications/notifications-context';
import { RegionProvider } from '../../region/region-context';
import { colors } from '../../theme/tokens';

/**
 * Signed-in stack: home, settings, the account-management screens and the
 * notification center + preferences. Region resolution and notification
 * state (badge, push registration, push taps) live only while signed in.
 */
export default function AppLayout() {
  const { status } = useAuth();
  const { t } = useLocale();

  if (status !== 'signedIn') {
    return <Redirect href="/welcome" />;
  }

  return (
    <RegionProvider>
      <NotificationsProvider>
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
          <Stack.Screen name="profile-edit" options={{ title: t('profile.title') }} />
          <Stack.Screen name="change-password" options={{ title: t('changePassword.title') }} />
          <Stack.Screen name="change-phone" options={{ title: t('changePhone.title') }} />
          <Stack.Screen name="delete-account" options={{ title: t('deleteAccount.title') }} />
          <Stack.Screen name="notifications" options={{ title: t('notifications.title') }} />
          <Stack.Screen
            name="notification-preferences"
            options={{ title: t('preferences.title') }}
          />
          <Stack.Screen name="dev-route-preview" options={{ title: t('routePreview.title') }} />
        </Stack>
      </NotificationsProvider>
    </RegionProvider>
  );
}
