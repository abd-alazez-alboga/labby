import { Link } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiStatus } from './api-status';
import { AvailabilityCard } from './availability/availability-card';
import { NotificationsBell } from './notifications/notifications-bell';
import { useLocale } from '../i18n/LocaleProvider';
import { useOptionalAvailability } from '../realtime/AvailabilityProvider';
import { useOptionalRegion } from '../region/RegionProvider';
import { colors, gradients, radius, spacing } from '../theme/tokens';

// Brand asset copied from /assets/images/labby-logo-white.png (source of truth).
const logoWhite = require('../../assets/images/labby-logo-white.png');

export function HomeScreen() {
  const { t } = useTranslation();
  const { direction, flipRows } = useLocale();
  const textAlign = direction === 'rtl' ? 'right' : 'left';
  const availability = useOptionalAvailability();
  // Null when rendered without the provider (provider-less unit tests).
  const region = useOptionalRegion();
  // Outside the operating area, location denied or unresolved-with-no-cache:
  // these replace the region line with the matching state card (M4-T4).
  const blocked =
    region && region.status !== 'resolved' && region.status !== 'loading'
      ? region
      : null;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scroll}
      refreshControl={
        availability ? (
          <RefreshControl
            refreshing={false}
            onRefresh={() => void availability.reload()}
          />
        ) : undefined
      }
      testID="home-screen"
    >
      <View style={styles.hero}>
        <View style={[styles.heroTop, flipRows && styles.heroTopRtl]}>
          <Image
            source={logoWhite}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={t('app.name')}
          />
          <NotificationsBell />
        </View>
        <Text style={[styles.title, { textAlign }]}>{t('home.title')}</Text>
        <Text style={[styles.subtitle, { textAlign }]}>
          {t('home.subtitle')}
        </Text>
      </View>
      <View style={styles.body}>
        <AvailabilityCard />
        {blocked ? (
          <View style={styles.regionCard} testID={`region-${blocked.status}`}>
            <Text style={[styles.regionTitle, { textAlign }]}>
              {t(`region.${blocked.status}Title`)}
            </Text>
            <Text style={[styles.regionBody, { textAlign }]}>
              {t(`region.${blocked.status}Body`)}
            </Text>
            <Pressable
              accessibilityRole="button"
              style={styles.regionButton}
              onPress={blocked.retry}
              testID="region-retry"
            >
              <Text style={styles.regionButtonLabel}>{t('region.retry')}</Text>
            </Pressable>
            {blocked.status === 'permissionDenied' && (
              <Pressable
                accessibilityRole="button"
                style={styles.regionButtonSecondary}
                onPress={blocked.openLocationSettings}
                testID="region-open-settings"
              >
                <Text style={styles.regionButtonSecondaryLabel}>
                  {t('region.openSettings')}
                </Text>
              </Pressable>
            )}
          </View>
        ) : region?.status === 'resolved' && region.config ? (
          <Text style={styles.regionBadge} testID="region-badge">
            {`${region.config.name} · ${region.config.currency}`}
          </Text>
        ) : region ? (
          <Text style={styles.regionLoading} testID="region-loading">
            {t('region.finding')}
          </Text>
        ) : null}
        <Link href="/vehicles" style={styles.secondaryLink} testID="vehicles-link">
          {t('home.myVehicle')}
        </Link>
        <Link href="/documents" style={styles.secondaryLink} testID="documents-link">
          {t('home.myDocuments')}
        </Link>
        <Link href="/settings" style={styles.settingsLink} testID="settings-link">
          {t('home.goToSettings')}
        </Link>
        <ApiStatus />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  scroll: {
    flexGrow: 1,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  heroTopRtl: {
    flexDirection: 'row-reverse',
  },
  hero: {
    // Solid fallback for --labby-gradient-hero (no gradient lib in the shell).
    backgroundColor: gradients.hero[0],
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  logo: {
    width: 150,
    height: 36,
  },
  title: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: spacing.sm,
  },
  subtitle: {
    color: colors.lilac200,
    fontSize: 15,
    lineHeight: 22,
  },
  body: {
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  regionCard: {
    alignSelf: 'stretch',
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
    alignItems: 'center',
  },
  regionTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  regionBody: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  regionButton: {
    marginTop: spacing.sm,
    backgroundColor: colors.purple700,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  regionButtonLabel: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  regionButtonSecondary: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.purple700,
  },
  regionButtonSecondaryLabel: {
    color: colors.purple700,
    fontSize: 15,
    fontWeight: '600',
  },
  regionBadge: {
    color: colors.purple700,
    fontSize: 15,
    fontWeight: '600',
  },
  regionLoading: {
    color: colors.textSecondary,
    fontSize: 14,
  },
  secondaryLink: {
    color: colors.purple700,
    borderColor: colors.purple700,
    borderWidth: 1,
    backgroundColor: colors.white,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  settingsLink: {
    // Solid fallback for --labby-gradient-button.
    backgroundColor: gradients.button[0],
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    overflow: 'hidden',
    textAlign: 'center',
  },
});
