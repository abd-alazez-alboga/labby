import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, TextButton } from './ui';
import { useLocale } from '../../i18n/LocaleProvider';
import { colors, gradients, radius, spacing } from '../../theme/tokens';

// Brand asset copied from /assets/images/labby-logo-white.png (source of truth).
const logoWhite = require('../../../assets/images/labby-logo-white.png');

export function WelcomeScreen() {
  const { t } = useTranslation();
  const { direction } = useLocale();
  const router = useRouter();
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  return (
    <View style={styles.container} testID="welcome-screen">
      <View style={styles.hero}>
        <Image
          source={logoWhite}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={t('app.name')}
        />
        <Text style={[styles.title, { textAlign }]}>
          {t('auth.welcome.title')}
        </Text>
        <Text style={[styles.subtitle, { textAlign }]}>
          {t('auth.welcome.subtitle')}
        </Text>
      </View>
      <View style={styles.body}>
        <PrimaryButton
          title={t('auth.welcome.login')}
          onPress={() => router.push('/login')}
          testID="welcome-login"
        />
        <TextButton
          title={t('auth.welcome.register')}
          onPress={() => router.push('/register')}
          testID="welcome-register"
        />
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
    // Solid fallback for --labby-gradient-hero.
    backgroundColor: gradients.hero[0],
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl * 2,
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
    fontSize: 24,
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
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
});
