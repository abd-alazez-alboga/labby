/**
 * Notification preferences (UC-S-12, NTF-02): one push toggle per category.
 * Ride and safety notifications are locked on (E1) — their toggles are shown
 * disabled with a lock. Muting a category stops push only; the center still
 * records it (UC-S-25 A1), which the intro copy says.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Switch, View } from "react-native";

import { type FailureKind, failureKind } from "../../api/http-client";
import {
  getNotificationPreferences,
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreference,
  updateNotificationPreferences,
} from "../../api/notifications";
import {
  AppText,
  Banner,
  ErrorView,
  ListRow,
  LoadingView,
  Screen,
  ScreenScrollView,
  screenStyles,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { colors } from "../../theme/tokens";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; failure: FailureKind }
  | { kind: "ready"; preferences: NotificationPreference[] };

/** Contract order, whatever order the server answers in. */
function ordered(
  preferences: NotificationPreference[],
): NotificationPreference[] {
  const byCategory = new Map(preferences.map((pref) => [pref.category, pref]));
  return NOTIFICATION_CATEGORIES.flatMap((category) => {
    const pref = byCategory.get(category);
    return pref ? [pref] : [];
  });
}

export default function NotificationPreferencesScreen() {
  const { t } = useLocale();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
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
    setState({ kind: "loading" });
    setSaveError(null);
    try {
      const preferences = await getNotificationPreferences();
      if (mounted.current)
        setState({ kind: "ready", preferences: ordered(preferences) });
    } catch (error) {
      if (mounted.current)
        setState({ kind: "error", failure: failureKind(error) });
    }
  }, []);

  useEffect(() => {
    (async () => {
      await load();
    })();
  }, [load]);

  const toggle = async (pref: NotificationPreference, enabled: boolean) => {
    if (pref.locked || saving || state.kind !== "ready") return;
    const previous = state.preferences;
    // Optimistic: the switch moves at once, the server answer is the truth.
    setState({
      kind: "ready",
      preferences: previous.map((p) =>
        p.category === pref.category ? { ...p, enabled } : p,
      ),
    });
    setSaving(pref.category);
    setSaveError(null);
    try {
      const updated = await updateNotificationPreferences([
        { category: pref.category, enabled },
      ]);
      if (mounted.current)
        setState({ kind: "ready", preferences: ordered(updated) });
    } catch (error) {
      if (mounted.current) {
        setState({ kind: "ready", preferences: previous });
        setSaveError(failureKind(error));
      }
    } finally {
      if (mounted.current) setSaving(null);
    }
  };

  if (state.kind === "loading") {
    return (
      <Screen
        style={screenStyles.page}
        testID="notification-preferences-screen"
      >
        <LoadingView testID="preferences-loading" />
      </Screen>
    );
  }
  if (state.kind === "error") {
    return (
      <Screen
        style={screenStyles.page}
        testID="notification-preferences-screen"
      >
        <ErrorView
          kind={state.failure}
          onRetry={() => void load()}
          testID={`preferences-error-${state.failure}`}
        />
      </Screen>
    );
  }

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="notification-preferences-screen"
    >
      <AppText variant="secondary" tone="muted" style={styles.intro}>
        {t("preferences.intro")}
      </AppText>

      {saveError ? (
        <Banner
          tone="danger"
          message={t(
            saveError === "network"
              ? "common.networkErrorBody"
              : "preferences.saveFailed",
          )}
          testID="preferences-save-error"
        />
      ) : null}

      <View>
        {state.preferences.map((pref, index) => (
          <ListRow
            key={pref.category}
            testID={`preference-${pref.category}`}
            title={t(`notifications.categories.${pref.category}`)}
            subtitle={t(
              pref.locked
                ? "preferences.lockedCaption"
                : `preferences.descriptions.${pref.category}`,
            )}
            titleAdornment={
              pref.locked ? (
                <Ionicons
                  name="lock-closed"
                  size={14}
                  color={colors.textMuted}
                  testID={`preference-${pref.category}-locked`}
                />
              ) : null
            }
            last={index === state.preferences.length - 1}
            trailing={
              <>
                {saving === pref.category ? (
                  <ActivityIndicator
                    color={colors.accent}
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
                  trackColor={{ false: colors.lineStrong, true: colors.accent }}
                  thumbColor={colors.surface}
                  accessibilityLabel={t(
                    `notifications.categories.${pref.category}`,
                  )}
                  accessibilityHint={
                    pref.locked ? t("preferences.lockedCaption") : undefined
                  }
                  testID={`preference-${pref.category}-switch`}
                />
              </>
            }
          />
        ))}
      </View>
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  intro: {
    lineHeight: 20,
  },
});
