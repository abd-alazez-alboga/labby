import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiStatus } from '../components/api-status';
import { type AppLocale, SUPPORTED_LOCALES } from '../i18n/translations';
import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../theme/tokens';

const LOCALE_LABEL_KEY: Record<AppLocale, string> = {
  en: 'settings.english',
  ar: 'settings.arabic',
};

export default function SettingsScreen() {
  const { t, locale, isRTL, direction, setLocale } = useLocale();

  return (
    <View style={styles.container} testID="settings-screen">
      <View style={styles.section}>
        <Text style={[styles.sectionTitle, isRTL && styles.textRtl]}>{t('settings.language')}</Text>
        <View style={[styles.row, isRTL && styles.rowRtl]}>
          {SUPPORTED_LOCALES.map((candidate) => {
            const selected = candidate === locale;
            return (
              <Pressable
                key={candidate}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`language-${candidate}`}
                style={[styles.languageButton, selected && styles.languageButtonSelected]}
                onPress={() => setLocale(candidate)}
              >
                <Text
                  style={[styles.languageLabel, selected && styles.languageLabelSelected]}
                >
                  {t(LOCALE_LABEL_KEY[candidate])}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={[styles.directionRow, isRTL && styles.rowRtl]}>
          <Text style={[styles.directionLabel, isRTL && styles.textRtl]}>
            {t('settings.direction')}
          </Text>
          <Text style={styles.directionValue} testID="direction-flag">
            {direction}
          </Text>
        </View>
        <Text style={[styles.note, isRTL && styles.textRtl]}>{t('settings.rtlNote')}</Text>
      </View>
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
});
