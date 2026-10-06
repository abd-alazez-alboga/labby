import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../../api/notifications';
import { NOTIFICATION_CATEGORIES } from '../../api/realtime-types';
import type { NotificationCategory, NotificationPreference } from '../../api/realtime-types';
import { getPushPermission } from '../../notifications/push';
import { useRemote } from '../../onboarding/use-remote';
import { colors, radius, spacing } from '../../theme/tokens';
import { BodyText, ErrorBanner } from '../auth/ui';
import { FailureState, LoadingState, SecondaryButton, useRowStyle, useTextAlign } from '../onboarding/ui';

function ordered(preferences: NotificationPreference[]): NotificationPreference[] {
  return [...preferences].sort(
    (a, b) =>
      NOTIFICATION_CATEGORIES.indexOf(a.category) - NOTIFICATION_CATEGORIES.indexOf(b.category),
  );
}

function PreferenceRow({
  preference,
  saving,
  onToggle,
}: {
  preference: NotificationPreference;
  saving: boolean;
  onToggle: (category: NotificationCategory, enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  const textAlign = useTextAlign();
  const rowStyle = useRowStyle();
  const { category, locked } = preference;
  // Locked categories always deliver, whatever the stored flag says (NTF-02).
  const enabled = locked ? true : preference.enabled;
  return (
    <View style={[rowStyle, styles.row]} testID={`pref-${category}`}>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { textAlign }]}>
          {t(`notifications.categories.${category}`)}
        </Text>
        <Text style={[styles.rowBody, { textAlign }]}>
          {t(`notifications.prefs.descriptions.${category}`)}
        </Text>
        {locked ? (
          <View style={[rowStyle, styles.locked]} testID={`pref-${category}-locked`}>
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <Text style={styles.lockedText}>
              {`${t('notifications.prefs.locked')} · ${t('notifications.prefs.lockedHint')}`}
            </Text>
          </View>
        ) : null}
      </View>
      {saving ? (
        <ActivityIndicator color={colors.purple700} testID={`pref-${category}-saving`} />
      ) : (
        <Switch
          value={enabled}
          disabled={locked}
          onValueChange={(next) => onToggle(category, next)}
          trackColor={{ true: colors.purple500, false: colors.lavender300 }}
          thumbColor={colors.white}
          accessibilityLabel={t(`notifications.categories.${category}`)}
          accessibilityState={{ disabled: locked, checked: enabled }}
          testID={`pref-${category}-switch`}
        />
      )}
    </View>
  );
}

/**
 * UC-S-12 — per-category push preferences. Each toggle saves immediately
 * (partial PUT of that one category; the answer is the full list). Ride
 * and safety are shown locked on (E1). Muting stops push only — the
 * center still records everything (UC-S-25 A1).
 */
export function NotificationPreferencesScreen() {
  const { t } = useTranslation();
  const { state, refreshing, reload } = useRemote(getNotificationPreferences);
  const [preferences, setPreferences] = useState<NotificationPreference[] | null>(null);
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pushDenied, setPushDenied] = useState(false);

  useEffect(() => {
    if (state.status === 'loaded') setPreferences(ordered(state.data));
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    void getPushPermission().then((permission) => {
      if (!cancelled && permission === 'denied') setPushDenied(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(async (category: NotificationCategory, enabled: boolean) => {
    setErrorKey(null);
    setSaving(category);
    try {
      const updated = await updateNotificationPreferences([{ category, enabled }]);
      setPreferences(ordered(updated));
    } catch {
      setErrorKey('notifications.prefs.saveFailed');
    } finally {
      setSaving(null);
    }
  }, []);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => void reload()} />
      }
      testID="notification-preferences"
    >
      {pushDenied ? (
        <View style={styles.pushOff} testID="push-permission-denied">
          <Text style={styles.pushOffTitle}>{t('notifications.prefs.pushOffTitle')}</Text>
          <Text style={styles.pushOffBody}>{t('notifications.prefs.pushOffBody')}</Text>
          <SecondaryButton
            title={t('notifications.prefs.openSettings')}
            icon="settings-outline"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
            testID="push-open-settings"
          />
        </View>
      ) : null}
      <BodyText>{t('notifications.prefs.intro')}</BodyText>
      {errorKey ? <ErrorBanner testID="prefs-error">{t(errorKey)}</ErrorBanner> : null}
      {state.status === 'loading' && !preferences ? <LoadingState /> : null}
      {state.status === 'error' && !preferences ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {preferences ? (
        <View style={styles.list}>
          {preferences.map((preference) => (
            <PreferenceRow
              key={preference.category}
              preference={preference}
              saving={saving === preference.category}
              onToggle={(category, enabled) => {
                if (!saving) void toggle(category, enabled);
              }}
            />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bgLight },
  content: { padding: spacing.lg, gap: spacing.md },
  list: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.lilac200,
  },
  row: {
    minHeight: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.md,
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.lilac200,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rowBody: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  locked: { gap: spacing.xs, marginTop: 2 },
  lockedText: { color: colors.textMuted, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  pushOff: {
    backgroundColor: colors.warningBg,
    borderColor: colors.warning,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pushOffTitle: { color: colors.warning, fontSize: 15, fontWeight: '700' },
  pushOffBody: { color: colors.textSecondary, fontSize: 14 },
});
