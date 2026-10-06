import { useRouter } from 'expo-router';
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../../auth/auth-context';
import { Button } from '../../components/form';
import { Screen } from '../../components/screen';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

// Copy of /assets/images/labby-logo.png (repo root is the source of truth).
const logo = require('../../../assets/branding/labby-logo.png');

/**
 * Signed-out landing screen. Also hosts the post-deletion "goodbye" state
 * and the session-expired note (UC-S-07 / token refresh failure).
 */
export default function WelcomeScreen() {
  const { t, isRTL } = useLocale();
  const { signOutReason } = useAuth();
  const router = useRouter();

  return (
    <Screen edges={['top', 'bottom']} style={styles.container} testID="welcome-screen">
      <Image source={logo} style={styles.logo} resizeMode="contain" accessibilityRole="image" />
      <Text style={[styles.tagline, isRTL && styles.textRtl]}>{t('welcome.tagline')}</Text>

      {signOutReason === 'deleted' ? (
        <View style={styles.notice} testID="goodbye-banner">
          <Text style={[styles.noticeTitle, isRTL && styles.textRtl]}>
            {t('welcome.goodbyeTitle')}
          </Text>
          <Text style={[styles.noticeBody, isRTL && styles.textRtl]}>
            {t('welcome.goodbyeBody')}
          </Text>
        </View>
      ) : null}
      {signOutReason === 'expired' ? (
        <View style={styles.notice} testID="session-expired-banner">
          <Text style={[styles.noticeBody, isRTL && styles.textRtl]}>
            {t('welcome.sessionExpired')}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t('welcome.createAccount')}
          onPress={() => router.push('/register')}
          testID="welcome-register"
        />
        <Button
          variant="secondary"
          label={t('welcome.logIn')}
          onPress={() => router.push('/login')}
          testID="welcome-login"
        />
      </View>
    </Screen>
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
    width: 200,
    height: 80,
  },
  tagline: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    textAlign: 'center',
  },
  textRtl: {
    writingDirection: 'rtl',
  },
  notice: {
    backgroundColor: colors.lavender100,
    borderRadius: radius.lg,
    padding: spacing.md,
    gap: spacing.sm,
    alignSelf: 'stretch',
  },
  noticeTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  noticeBody: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 20,
  },
  actions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
});
