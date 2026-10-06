/**
 * Notification preferences (UC-S-12, NTF-02): one push toggle per category.
 * Ride and safety notifications are locked on (E1) — their toggles are shown
 * disabled with a lock. Muting a category stops push only; the center still
 * records it (UC-S-25 A1), which the intro copy says.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import { type FailureKind, failureKind } from '../../api/http-client';
import {
  getNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreference,
  updateNotificationPreferences,
} from '../../api/notifications';
import { ErrorBanner } from '../../components/form';
import { ErrorView, LoadingView } from '../../components/status-view';
import { useLocale } from '../../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; failure: FailureKind }
  | { kind: 'ready'; preferences: NotificationPreference[] };

/** Contract order, whatever order the server answers in. */
function ordered(preferences: NotificationPreference[]): NotificationPreference[] {
  const byCategory = new Map(preferences.map((pref) => [pref.category, pref]));
  return NOTIFICATION_CATEGORIES.flatMap((category) => {
    const pref = byCategory.get(category);
    return pref ? [pref] : [];
  });
}

export default function NotificationPreferencesScreen() {
  const { t, isRTL, flipRows } = useLocale();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [saveError, setSaveError] = useState<FailureKind | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    setSaveError(null);
    try {
      const preferences = await getNotificationPreferences();
      if (mounted.current) setState({ kind: 'ready', preferences: ordered(preferences) });
    } catch (error) {
      if (mounted.current) setState({ kind: 'error', failure: failureKind(error) });
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const toggle = async (pref: NotificationPreference, enabled: boolean) => {
    if (pref.locked || saving || state.kind !== 'ready') return;
    const previous = state.preferences;
    // Optimistic: the switch moves at once, the server answer is the truth.
    setState({
      kind: 'ready',
      preferences: previous.map((p) => (p.category === pref.category ? { ...p, enabled } : p)),
    });
    setSaving(pref.category);
    setSaveError(null);
    try {
      const updated = await updateNotificationPreferences([{ category: pref.category, enabled }]);
      if (mounted.current) setState({ kind: 'ready', preferences: ordered(updated) });
    } catch (error) {
      if (mounted.current) {
        setState({ kind: 'ready', preferences: previous });
        setSaveError(failureKind(error));
      }
    } finally {
      if (mounted.current) setSaving(null);
    }
  };

  if (state.kind === 'loading') {
    return (
      <View style={styles.fill} testID="notification-preferences-screen">
        <LoadingView testID="preferences-loading" />
      </View>
    );
  }
  if (state.kind === 'error') {
    return (
      <View style={styles.fill} testID="notification-preferences-screen">
        <ErrorView
          kind={state.failure}
          onRetry={() => void load()}
          testID={`preferences-error-${state.failure}`}
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.container}
      testID="notification-preferences-screen"
    >
      <Text style={[styles.intro, isRTL && styles.textRtl]}>{t('preferences.intro')}</Text>

      {saveError ? (
        <ErrorBanner
          message={t(saveError === 'network' ? 'common.networkErrorBody' : 'preferences.saveFailed')}
          testID="preferences-save-error"
        />
      ) : null}

      <View style={styles.section}>
        {state.preferences.map((pref, index) => (
          <View
            key={pref.category}
            style={[
              styles.row,
              flipRows && styles.rowRtl,
              index > 0 && styles.rowDivider,
            ]}
            testID={`preference-${pref.category}`}
          >
            <View style={styles.rowText}>
              <View style={[styles.labelLine, flipRows && styles.rowRtl]}>
                <Text style={[styles.label, isRTL && styles.textRtl]}>
                  {t(`notifications.categories.${pref.category}`)}
                </Text>
                {pref.locked ? (
                  <Ionicons
                    name="lock-closed"
                    size={14}
                    color={colors.textMuted}
                    testID={`preference-${pref.category}-locked`}
                  />
                ) : null}
              </View>
              <Text style={[styles.caption, isRTL && styles.textRtl]}>
                {t(
                  pref.locked
                    ? 'preferences.lockedCaption'
                    : `preferences.descriptions.${pref.category}`,
                )}
              </Text>
            </View>
            {saving === pref.category ? (
              <ActivityIndicator
                color={colors.purple700}
                style={styles.saving}
                testID={`preference-${pref.category}-saving`}
              />
            ) : null}
            <Switch
              value={pref.locked ? true : pref.enabled}
              disabled={pref.locked || saving !== null}
              accessibilityState={{
                disabled: pref.locked || saving !== null,
                checked: pref.locked ? true : pref.enabled,
              }}
              onValueChange={(next) => void toggle(pref, next)}
              trackColor={{ false: colors.lavender200, true: colors.purple500 }}
              thumbColor={colors.white}
              accessibilityLabel={t(`notifications.categories.${pref.category}`)}
              accessibilityHint={pref.locked ? t('preferences.lockedCaption') : undefined}
              testID={`preference-${pref.category}-switch`}
            />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  intro: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    lineHeight: 19,
  },
  section: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowRtl: {
    flexDirection: 'row-reverse',
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.lavender200,
  },
  rowText: {
    flex: 1,
    gap: spacing.xs,
  },
  labelLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  caption: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  saving: {
    marginHorizontal: spacing.xs,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
});
