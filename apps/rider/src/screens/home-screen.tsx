import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from '../components/api-status';
import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

// Copy of /assets/images/labby-logo.png (repo root is the source of truth).
const logo = require('../../assets/branding/labby-logo.png');

export default function HomeScreen() {
  const { t, isRTL } = useLocale();
  const router = useRouter();

  return (
    <View style={styles.container} testID="home-screen">
      <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityRole="image" />
      <Text style={[styles.welcome, isRTL && styles.textRtl]}>{t('home.welcome')}</Text>
      <Text style={[styles.subtitle, isRTL && styles.textRtl]}>{t('home.subtitle')}</Text>
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
