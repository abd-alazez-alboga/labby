import { Link } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from './api-status';
import { useLocale } from '../i18n/LocaleProvider';
import { colors, gradients, radius, spacing } from '../theme/tokens';

// Brand asset copied from /assets/images/labby-logo-white.png (source of truth).
const logoWhite = require('../../assets/images/labby-logo-white.png');

export function HomeScreen() {
  const { t } = useTranslation();
  const { direction } = useLocale();
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  return (
    <View style={styles.container} testID="home-screen">
      <View style={styles.hero}>
        <Image
          source={logoWhite}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={t('app.name')}
        />
        <Text style={[styles.title, { textAlign }]}>{t('home.title')}</Text>
        <Text style={[styles.subtitle, { textAlign }]}>
          {t('home.subtitle')}
        </Text>
      </View>
      <View style={styles.body}>
        <Link href="/settings" style={styles.settingsLink} testID="settings-link">
          {t('home.goToSettings')}
        </Link>
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
  hero: {
    // Solid fallback for --labby-gradient-hero (no gradient lib in the shell).
    backgroundColor: gradients.hero[0],
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xl,
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  logo: {
    width: 180,
    height: 40,
    alignSelf: 'center',
    marginBottom: spacing.lg,
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
    flex: 1,
    padding: spacing.lg,
    alignItems: 'center',
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
