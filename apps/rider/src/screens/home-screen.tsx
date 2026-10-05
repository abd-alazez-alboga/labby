import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from '../components/api-status';
import { useLocale } from '../i18n/locale-context';
import { useOptionalRegion } from '../region/region-context';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

// Copy of /assets/images/labby-logo.png (repo root is the source of truth).
const logo = require('../../assets/branding/labby-logo.png');

export default function HomeScreen() {
  const { t, isRTL } = useLocale();
  const router = useRouter();
  // Null when rendered outside the signed-in layout (provider-less tests).
  const region = useOptionalRegion();
  // Outside the operating area, location denied or unresolved-with-no-cache:
  // these replace the welcome copy with the matching state (M4-T4).
  const blocked =
    region && region.status !== 'resolved' && region.status !== 'loading' ? region : null;

  return (
    <View style={styles.container} testID="home-screen">
      <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityRole="image" />
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
            onPress={blocked.retry}
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
      <ApiStatus />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgLight,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  logo: {
    width: 180,
    height: 72,
    marginBottom: spacing.md,
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
    marginTop: spacing.lg,
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
