import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  StyleSheet,
  Switch,
  View,
} from "react-native";

import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "../../api/notifications";
import { NOTIFICATION_CATEGORIES } from "../../api/realtime-types";
import type {
  NotificationCategory,
  NotificationPreference,
} from "../../api/realtime-types";
import { getPushPermission } from "../../notifications/push";
import { useRemote } from "../../onboarding/use-remote";
import { colors, spacing } from "../../theme/tokens";
import {
  AppText,
  Banner,
  BodyText,
  FailureState,
  LoadingState,
  Screen,
  SecondaryButton,
  useDirection,
} from "../ui";

function ordered(
  preferences: NotificationPreference[],
): NotificationPreference[] {
  return [...preferences].sort(
    (a, b) =>
      NOTIFICATION_CATEGORIES.indexOf(a.category) -
      NOTIFICATION_CATEGORIES.indexOf(b.category),
  );
}

function PreferenceRow({
  preference,
  saving,
  onToggle,
  last,
}: {
  preference: NotificationPreference;
  saving: boolean;
  onToggle: (category: NotificationCategory, enabled: boolean) => void;
  last: boolean;
}) {
  const { t } = useTranslation();
  const { flipRows } = useDirection();
  const { category, locked } = preference;
  // Locked categories always deliver, whatever the stored flag says (NTF-02).
  const enabled = locked ? true : preference.enabled;
  return (
    <View
      style={[
        styles.row,
        flipRows && styles.rowReverse,
        !last && styles.divider,
      ]}
      testID={`pref-${category}`}
    >
      <View style={styles.rowText}>
        <AppText variant="bodyStrong">
          {t(`notifications.categories.${category}`)}
        </AppText>
        <AppText variant="secondary" color={colors.textMuted}>
          {t(`notifications.prefs.descriptions.${category}`)}
        </AppText>
        {locked ? (
          <View
            style={[styles.locked, flipRows && styles.rowReverse]}
            testID={`pref-${category}-locked`}
          >
            <Ionicons name="lock-closed" size={14} color={colors.textMuted} />
            <AppText
              variant="caption"
              color={colors.textMuted}
              style={styles.lockedText}
            >
              {`${t("notifications.prefs.locked")} · ${t("notifications.prefs.lockedHint")}`}
            </AppText>
          </View>
        ) : null}
      </View>
      {saving ? (
        <ActivityIndicator
          color={colors.accent}
          testID={`pref-${category}-saving`}
        />
      ) : (
        <Switch
          value={enabled}
          disabled={locked}
          onValueChange={(next) => onToggle(category, next)}
          trackColor={{ true: colors.accent, false: colors.lineStrong }}
          thumbColor={colors.surface}
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
  const [preferences, setPreferences] = useState<
    NotificationPreference[] | null
  >(null);
  const [saving, setSaving] = useState<NotificationCategory | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pushDenied, setPushDenied] = useState(false);

  useEffect(() => {
    if (state.status === "loaded") setPreferences(ordered(state.data));
  }, [state]);

  useEffect(() => {
    let cancelled = false;
    void getPushPermission().then((permission) => {
      if (!cancelled && permission === "denied") setPushDenied(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = useCallback(
    async (category: NotificationCategory, enabled: boolean) => {
      setErrorKey(null);
      setSaving(category);
      try {
        const updated = await updateNotificationPreferences([
          { category, enabled },
        ]);
        setPreferences(ordered(updated));
      } catch {
        setErrorKey("notifications.prefs.saveFailed");
      } finally {
        setSaving(null);
      }
    },
    [],
  );

  return (
    <Screen
      title={t("notifications.settings")}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => void reload()}
        />
      }
      testID="notification-preferences"
    >
      {pushDenied ? (
        <Banner
          tone="warning"
          icon="notifications-off-outline"
          title={t("notifications.prefs.pushOffTitle")}
          message={t("notifications.prefs.pushOffBody")}
          testID="push-permission-denied"
        >
          <SecondaryButton
            title={t("notifications.prefs.openSettings")}
            icon="settings-outline"
            onPress={() => {
              Linking.openSettings().catch(() => {});
            }}
            testID="push-open-settings"
          />
        </Banner>
      ) : null}
      <BodyText>{t("notifications.prefs.intro")}</BodyText>
      {errorKey ? (
        <Banner tone="danger" message={t(errorKey)} testID="prefs-error" />
      ) : null}
      {state.status === "loading" && !preferences ? <LoadingState /> : null}
      {state.status === "error" && !preferences ? (
        <FailureState kind={state.kind} onRetry={() => void reload()} />
      ) : null}
      {preferences ? (
        <View>
          {preferences.map((preference, index) => (
            <PreferenceRow
              key={preference.category}
              preference={preference}
              saving={saving === preference.category}
              last={index === preferences.length - 1}
              onToggle={(category, enabled) => {
                if (!saving) void toggle(category, enabled);
              }}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 76,
    paddingVertical: spacing.ms,
    gap: spacing.md,
  },
  rowReverse: { flexDirection: "row-reverse" },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rowText: { flex: 1, gap: 2 },
  locked: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: 2,
  },
  lockedText: { flexShrink: 1 },
});
