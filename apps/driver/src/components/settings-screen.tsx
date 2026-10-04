import { Link } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from './api-status';
import { useOptionalAuth } from '../auth/AuthProvider';
import { useLocale } from '../i18n/LocaleProvider';
import { SUPPORTED_LANGUAGES } from '../i18n';
import type { Language } from '../i18n';
import { colors, radius, spacing } from '../theme/tokens';

const ACCOUNT_LINKS = [
  { href: '/profile-edit', labelKey: 'account.editProfile' },
  { href: '/change-password', labelKey: 'account.changePassword' },
  { href: '/change-phone', labelKey: 'account.changePhone' },
  { href: '/delete-account', labelKey: 'account.deleteAccount' },
] as const;

const LANGUAGE_LABEL_KEYS: Record<Language, string> = {
  en: 'settings.english',
  ar: 'settings.arabic',
};

export function SettingsScreen() {
  const { t } = useTranslation();
  const { language, direction, setLanguage } = useLocale();
  // Optional: unit tests render this screen without an AuthProvider, and
  // the account section only makes sense for a signed-in session anyway.
  const auth = useOptionalAuth();
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  return (
    <View style={styles.container} testID="settings-screen">
      {auth?.status === 'signedIn' && auth.user ? (
        <>
          <Text style={[styles.sectionLabel, { textAlign }]}>
            {t('account.section')}
          </Text>
          <View style={styles.accountList}>
            {ACCOUNT_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                style={[styles.accountLink, { textAlign }]}
                testID={`settings-link-${item.href.slice(1)}`}
              >
                {t(item.labelKey)}
              </Link>
            ))}
            <Pressable
              accessibilityRole="button"
              testID="settings-logout"
              onPress={() => auth.signOut()}
              style={styles.logoutRow}
            >
              <Text style={[styles.logoutText, { textAlign }]}>
                {t('account.logout')}
              </Text>
            </Pressable>
          </View>
        </>
      ) : null}
      <Text style={[styles.sectionLabel, { textAlign }]}>
        {t('settings.language')}
      </Text>
      <View style={styles.optionsRow}>
        {SUPPORTED_LANGUAGES.map((option) => {
          const selected = option === language;
          return (
            <Pressable
              key={option}
              testID={`language-option-${option}`}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setLanguage(option)}
              style={[styles.option, selected && styles.optionSelected]}
            >
              <Text
                style={[
                  styles.optionText,
                  selected && styles.optionTextSelected,
                ]}
              >
                {t(LANGUAGE_LABEL_KEYS[option])}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionLabel, { textAlign }]}>
        {t('settings.direction')}
      </Text>
      <View style={styles.directionRow}>
        <Text style={styles.directionBadge} testID="direction-flag">
          {direction.toUpperCase()}
        </Text>
        <Text style={[styles.directionLabel, { textAlign }]}>
          {t(direction === 'rtl' ? 'settings.rtl' : 'settings.ltr')}
        </Text>
      </View>
      <Text style={[styles.restartNote, { textAlign }]}>
        {t('settings.restartNote')}
      </Text>
      <ApiStatus />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgLight,
    padding: spacing.lg,
  },
  sectionLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  option: {
    flex: 1,
    backgroundColor: colors.white,
    borderColor: colors.lilac200,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  optionSelected: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  optionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  optionTextSelected: {
    color: colors.white,
  },
  directionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  directionBadge: {
    backgroundColor: colors.lilac100,
    color: colors.purple700,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: 'hidden',
  },
  directionLabel: {
    color: colors.text,
    fontSize: 15,
  },
  restartNote: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.md,
  },
  accountList: {
    backgroundColor: colors.white,
    borderColor: colors.lilac200,
    borderWidth: 1,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  accountLink: {
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomColor: colors.lilac200,
    borderBottomWidth: 1,
  },
  logoutRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  logoutText: {
    color: colors.danger,
    fontSize: 16,
    fontWeight: '600',
  },
});
