import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from '../components/api-status';
import { Button } from '../components/form';
import { useLocale } from '../i18n/locale-context';
import { useCurrentPosition } from '../location/use-current-position';
import { useOptionalNotifications } from '../notifications/notifications-context';
import { UnreadBadge } from '../notifications/unread-badge';
import { useOptionalRegion } from '../region/region-context';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { PositionMap } from './home/position-map';

/**
 * Rider home: the map with the rider's own position (M6-T4 — the base the
 * M7 booking flow builds on), the notification-center entry with its unread
 * badge, and the region state (M4-T4).
 */
export default function HomeScreen() {
  const { t, isRTL, flipRows } = useLocale();
  const router = useRouter();
  // Null when rendered outside the signed-in layout (provider-less tests).
  const region = useOptionalRegion();
  const notifications = useOptionalNotifications();
  const current = useCurrentPosition();
  // Outside the operating area, location denied or unresolved-with-no-cache:
  // these replace the welcome copy with the matching state (M4-T4).
  const blocked =
    region && region.status !== 'resolved' && region.status !== 'loading' ? region : null;

  const retryRegion = () => {
    blocked?.retry();
    if (current.status !== 'ready') current.retry();
  };

  const unread = notifications?.unread ?? null;

  return (
    <View style={styles.container} testID="home-screen">
      <View style={styles.mapCard}>
        <PositionMap
          current={current}
          showPermissionActions={region?.status !== 'permissionDenied'}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            unread
              ? t('notifications.openWithUnread', { count: unread })
              : t('notifications.open')
          }
          onPress={() => router.push('/notifications')}
          style={({ pressed }) => [
            styles.bell,
            flipRows && styles.bellRtl,
            pressed && styles.bellPressed,
          ]}
          testID="home-notifications"
        >
          <Ionicons name="notifications-outline" size={22} color={colors.purple700} />
          <View style={[styles.bellBadge, flipRows && styles.bellBadgeRtl]}>
            <UnreadBadge count={unread} testID="home-unread-badge" />
          </View>
        </Pressable>
      </View>

      <View style={styles.panel}>
        {blocked ? (
          <View style={styles.regionBlock} testID={`region-${blocked.status}`}>
            <Text style={[styles.welcome, isRTL && styles.textRtl]}>
              {t(`region.${blocked.status}Title`)}
            </Text>
            <Text style={[styles.subtitle, isRTL && styles.textRtl]}>
              {t(`region.${blocked.status}Body`)}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={({ pressed }) => [styles.retryButton, pressed && styles.retryButtonPressed]}
              onPress={retryRegion}
              testID="region-retry"
            >
              <Text style={styles.retryButtonLabel}>{t('region.retry')}</Text>
            </Pressable>
            {blocked.status === 'permissionDenied' && (
              <Pressable
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={blocked.openLocationSettings}
                testID="region-open-settings"
              >
                <Text style={styles.secondaryButtonLabel}>{t('region.openSettings')}</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <Text style={[styles.welcome, isRTL && styles.textRtl]}>{t('home.welcome')}</Text>
            <Text style={[styles.subtitle, isRTL && styles.textRtl]}>{t('home.subtitle')}</Text>
            {region?.status === 'resolved' && region.config ? (
              <Text style={[styles.regionBadge, isRTL && styles.textRtl]} testID="region-badge">
                {`${region.config.name} · ${region.config.currency}`}
              </Text>
            ) : null}
            {region?.status === 'loading' ? (
              <Text style={[styles.subtitle, isRTL && styles.textRtl]} testID="region-loading">
                {t('region.finding')}
              </Text>
            ) : null}
          </>
        )}
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.settingsButton, pressed && styles.settingsButtonPressed]}
          onPress={() => router.push('/settings')}
          testID="open-settings"
        >
          <Text style={styles.settingsButtonLabel}>{t('home.openSettings')}</Text>
        </Pressable>
        {__DEV__ ? (
          <Button
            variant="link"
            label={t('routePreview.open')}
            onPress={() => router.push('/dev-route-preview')}
            testID="open-route-preview"
          />
        ) : null}
        <ApiStatus />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  mapCard: {
    flex: 1,
    minHeight: 220,
  },
  bell: {
    position: 'absolute',
    top: spacing.md,
    end: spacing.md,
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.logoCharcoal,
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bellRtl: {
    end: undefined,
    start: spacing.md,
  },
  bellPressed: {
    backgroundColor: colors.lavender100,
  },
  bellBadge: {
    position: 'absolute',
    top: -4,
    end: -4,
  },
  bellBadgeRtl: {
    end: undefined,
    start: -4,
  },
  panel: {
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
    backgroundColor: colors.bgLight,
  },
  welcome: {
    color: colors.text,
    fontSize: fontSize.xl,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    textAlign: 'center',
  },
  textRtl: {
    writingDirection: 'rtl',
  },
  regionBlock: {
    alignItems: 'center',
    gap: spacing.md,
  },
  regionBadge: {
    color: colors.purple700,
    fontSize: fontSize.md,
    fontWeight: '600',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.purple700,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  retryButtonPressed: {
    backgroundColor: colors.purple500,
  },
  retryButtonLabel: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  secondaryButton: {
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.purple700,
  },
  secondaryButtonLabel: {
    color: colors.purple700,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  settingsButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.purple700,
    paddingVertical: spacing.sm + spacing.xs,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.pill,
  },
  settingsButtonPressed: {
    backgroundColor: colors.purple500,
  },
  settingsButtonLabel: {
    color: colors.white,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
});
