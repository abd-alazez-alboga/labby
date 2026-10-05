import React from 'react';
import { useTranslation } from 'react-i18next';
import { Image, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from './ui';
import { useAuth } from '../../auth/AuthProvider';
import { useLocale } from '../../i18n/LocaleProvider';
import { colors, gradients, radius, spacing } from '../../theme/tokens';

// Brand asset copied from /assets/images/labby-logo-white.png (source of truth).
const logoWhite = require('../../../assets/images/labby-logo-white.png');

/**
 * The driver gate (M2-T4): shown to signed-in accounts WITHOUT an active
 * `driver` role. A SUSPENDED driver role gets its own copy (UC-S-02 E2;
 * the suspension reason arrives with a later milestone's contract — the
 * deferral is recorded in the tracker). The real driver-application flow
 * arrives in M5 — this is a placeholder with logout as the only action.
 */
export function ApplyToDriveScreen() {
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const { direction } = useLocale();
  const textAlign = direction === 'rtl' ? 'right' : 'left';
  const driverSuspended =
    user?.roles.some(
      (assignment) => assignment.role === 'driver' && assignment.state === 'suspended',
    ) ?? false;

  return (
    <View style={styles.container} testID="apply-to-drive-screen">
      <View style={styles.hero}>
        <Image
          source={logoWhite}
          style={styles.logo}
          resizeMode="contain"
          accessibilityLabel={t('app.name')}
        />
        <Text style={[styles.title, { textAlign }]}>
          {t(driverSuspended ? 'gate.suspendedTitle' : 'gate.title')}
        </Text>
        <Text style={[styles.subtitle, { textAlign }]} testID="gate-body">
          {t(driverSuspended ? 'gate.suspendedBody' : 'gate.body')}
        </Text>
      </View>
      <View style={styles.body}>
        {user ? (
          <Text style={[styles.signedInAs, { textAlign }]} testID="gate-user">
            {t('gate.signedInAs', { name: user.name })}
          </Text>
        ) : null}
        <PrimaryButton
          title={t('gate.logout')}
          onPress={() => signOut()}
          testID="gate-logout"
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
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  signedInAs: {
    color: colors.textMuted,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
});
