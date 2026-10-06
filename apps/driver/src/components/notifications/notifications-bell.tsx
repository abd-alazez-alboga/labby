import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { refreshUnread, useUnreadCount } from '../../notifications/unread-store';
import { colors } from '../../theme/tokens';

/** Bell + unread badge (UC-S-11); refreshes the count whenever its screen gains focus. */
export function NotificationsBell({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const { t } = useTranslation();
  const router = useRouter();
  const unread = useUnreadCount();

  useFocusEffect(
    useCallback(() => {
      void refreshUnread();
    }, []),
  );

  const label = unread > 0 ? t('notifications.bellUnread', { count: unread }) : t('notifications.bell');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push('/notifications')}
      style={styles.button}
      hitSlop={8}
      testID="notifications-bell"
    >
      <Ionicons
        name={unread > 0 ? 'notifications' : 'notifications-outline'}
        size={28}
        color={tone === 'light' ? colors.white : colors.purple700}
      />
      {unread > 0 ? (
        <View style={styles.badge} testID="notifications-badge">
          <Text style={styles.badgeText}>{unread > 99 ? '99+' : String(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  badgeText: { color: colors.white, fontSize: 11, fontWeight: '700' },
});
