import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { updateProfile } from '../api/auth';
import { ApiStatus } from '../components/api-status';
import { useAuth } from '../auth/auth-context';
import { Button } from '../components/form';
import { type AppLocale, SUPPORTED_LOCALES } from '../i18n/translations';
import { useLocale } from '../i18n/locale-context';
import { useOptionalNotifications } from '../notifications/notifications-context';
import { UnreadBadge } from '../notifications/unread-badge';
import { ScreenScrollView } from '../components/screen';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

const LOCALE_LABEL_KEY: Record<AppLocale, string> = {
  en: 'settings.english',
  ar: 'settings.arabic',
};

/**
 * Settings hub: language (UC-S-10 — instant switch, best-effort account
 * sync), notifications (center with unread badge + push preferences, M6-T4),
 * account section (profile, password, phone, delete) and logout.
 */
export default function SettingsScreen() {
  const { t, locale, isRTL, direction, setLocale, flipRows } = useLocale();
  const { user, setUser, signOut } = useAuth();
  const router = useRouter();
  const notifications = useOptionalNotifications();

  const switchLanguage = async (next: AppLocale) => {
    // Instant local switch (M1 behavior preserved)…
    await setLocale(next);
    // …then persist to the account best-effort (UC-S-10: the preference
    // applies to notifications and SMS templates server-side).
    if (user && user.language !== next) {
      try {
        const updated = await updateProfile({ name: user.name, language: next });
        setUser(updated);
      } catch {
        // offline — the local switch already happened; server sync will
        // happen the next time the profile is saved.
      }
    }
  };

  const notificationRows = [
    {
      key: 'notifications',
      label: t('settings.notificationCenter'),
      href: '/notifications' as const,
      badge: notifications?.unread ?? null,
    },
    {
      key: 'notification-preferences',
      label: t('settings.notificationPreferences'),
      href: '/notification-preferences' as const,
      badge: null,
    },
  ];

  const accountRows = [
    { key: 'profile', label: t('settings.editProfile'), href: '/profile-edit' as const },
    { key: 'password', label: t('settings.changePassword'), href: '/change-password' as const },
    { key: 'phone', label: t('settings.changePhone'), href: '/change-phone' as const },
    { key: 'delete', label: t('settings.deleteAccount'), href: '/delete-account' as const },
  ];

  return (
    <ScreenScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      testID="settings-screen"
    >
      {user ? (
        <View style={[styles.profileCard, flipRows && styles.rowRtl]} testID="settings-profile-card">
          {user.photoUrl ? (
            <Image
              source={{ uri: user.photoUrl }}
              style={styles.avatar}
              testID="settings-avatar"
            />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback]} testID="settings-avatar-fallback">
              <Text style={styles.avatarInitial}>{user.name.trim().charAt(0) || '?'}</Text>
            </View>
          )}
          <View style={styles.profileText}>
            <Text style={[styles.profileName, isRTL && styles.textRtl]}>{user.name}</Text>
            <Text style={[styles.profilePhone, isRTL && styles.textRtl]}>{user.phone}</Text>
          </View>
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.textRtl]}>{t('settings.language')}</Text>
        <View style={[styles.row, flipRows && styles.rowRtl]}>
          {SUPPORTED_LOCALES.map((candidate) => {
            const selected = candidate === locale;
            return (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`language-${candidate}`}
                style={[styles.languageButton, selected && styles.languageButtonSelected]}
                onPress={() => switchLanguage(candidate)}
              >
                <Text style={[styles.languageLabel, selected && styles.languageLabelSelected]}>
                  {t(LOCALE_LABEL_KEY[candidate])}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.directionRow, flipRows && styles.rowRtl]}>
          <Text style={[styles.directionLabel, isRTL && styles.textRtl]}>
            {t('settings.direction')}
          </Text>
          <Text style={styles.directionValue} testID="direction-flag">
            {direction}
          </Text>
        </View>
        <Text style={[styles.note, isRTL && styles.textRtl]}>{t('settings.rtlNote')}</Text>
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.textRtl]}>
          {t('settings.notifications')}
        </Text>
        {notificationRows.map((row) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            testID={`settings-${row.key}`}
            style={({ pressed }) => [
              styles.navRow,
              flipRows && styles.rowRtl,
              pressed && styles.navRowPressed,
            ]}
            onPress={() => router.push(row.href)}
          >
            <Text style={[styles.navLabel, styles.navLabelFlex, isRTL && styles.textRtl]}>
              {row.label}
            </Text>
            <UnreadBadge count={row.badge} testID={`settings-${row.key}-badge`} />
            <Text style={styles.navChevron}>{isRTL ? '‹' : '›'}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.textRtl]}>{t('settings.account')}</Text>
        {accountRows.map((row) => (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            testID={`settings-${row.key}`}
            style={({ pressed }) => [
              styles.navRow,
              flipRows && styles.rowRtl,
              pressed && styles.navRowPressed,
            ]}
            onPress={() => router.push(row.href)}
          >
            <Text
              style={[
                styles.navLabel,
                row.key === 'delete' && styles.navLabelDanger,
                isRTL && styles.textRtl,
              ]}
            >
              {row.label}
            </Text>
            <Text style={styles.navChevron}>{isRTL ? '‹' : '›'}</Text>
          </Pressable>
        ))}
      </View>

      <Button
        variant="secondary"
        label={t('settings.logout')}
        onPress={() => void signOut()}
        testID="settings-logout"
      />

      <ApiStatus />
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
  },
  avatarFallback: {
    backgroundColor: colors.lavender100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: colors.purple700,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  profileText: {
    flex: 1,
    gap: spacing.xs,
  },
  profileName: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
  },
  profilePhone: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  languageButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.sm + spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lavender200,
    backgroundColor: colors.lavender100,
  },
  languageButtonSelected: {
    backgroundColor: colors.purple700,
    borderColor: colors.purple700,
  },
  languageLabel: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  languageLabelSelected: {
    color: colors.white,
  },
  directionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  directionLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  directionValue: {
    color: colors.purple700,
    fontSize: fontSize.sm,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  note: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    lineHeight: 18,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm + spacing.xs,
  },
  navRowPressed: {
    opacity: 0.6,
  },
  navLabel: {
    color: colors.text,
    fontSize: fontSize.md,
  },
  navLabelFlex: {
    flex: 1,
  },
  navLabelDanger: {
    color: '#C0392B',
  },
  navChevron: {
    color: colors.textSubtle,
    fontSize: fontSize.lg,
  },
});
