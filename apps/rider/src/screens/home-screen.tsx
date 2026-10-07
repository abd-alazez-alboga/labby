import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { ApiStatus } from "../components/api-status";
import {
  AppText,
  BottomSheet,
  MapFab,
  MapScreen,
  PrimaryButton,
  SecondaryButton,
  StatusChip,
  TextButton,
  useDirection,
} from "../components/ui";
import { takeReturnRoute } from "../i18n/direction-reload";
import { useLocale } from "../i18n/locale-context";
import { useCurrentPosition } from "../location/use-current-position";
import { useOptionalNotifications } from "../notifications/notifications-context";
import { UnreadBadge } from "../notifications/unread-badge";
import { useOptionalRegion } from "../region/region-context";
import { spacing } from "../theme/tokens";
import { PositionMap } from "./home/position-map";

/**
 * Rider home, map-first: the full-bleed map with the rider's own position
 * (M6-T4 — the base the M7 booking flow builds on), floating Menu (settings)
 * and notification buttons (with the unread badge), and a bottom sheet with
 * the welcome copy or the region state (M4-T4).
 */
export default function HomeScreen() {
  const { t } = useLocale();
  const { flipRows } = useDirection();
  const router = useRouter();

  // Back to the screen a direction-changing language switch reloaded from.
  useEffect(() => {
    void takeReturnRoute().then((route) => {
      if (route) router.push(route as never);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);
  // Null when rendered outside the signed-in layout (provider-less tests).
  const region = useOptionalRegion();
  const notifications = useOptionalNotifications();
  const current = useCurrentPosition();
  // Outside the operating area, location denied or unresolved-with-no-cache:
  // these replace the welcome copy with the matching state (M4-T4).
  const blocked =
    region && region.status !== "resolved" && region.status !== "loading"
      ? region
      : null;

  const retryRegion = () => {
    blocked?.retry();
    if (current.status !== "ready") current.retry();
  };

  const unread = notifications?.unread ?? null;

  return (
    <MapScreen
      testID="home-screen"
      map={
        <PositionMap
          current={current}
          showPermissionActions={region?.status !== "permissionDenied"}
        />
      }
      floating={
        <>
          <MapFab
            icon="menu"
            accessibilityLabel={t("home.openSettings")}
            onPress={() => router.push("/settings")}
            testID="open-settings"
          />
          <MapFab
            icon="notifications-outline"
            accessibilityLabel={
              unread
                ? t("notifications.openWithUnread", { count: unread })
                : t("notifications.open")
            }
            onPress={() => router.push("/notifications")}
            badge={
              unread ? (
                <UnreadBadge count={unread} testID="home-unread-badge" />
              ) : null
            }
            testID="home-notifications"
          />
        </>
      }
      sheet={
        <BottomSheet testID="home-panel">
          {blocked ? (
            <View style={styles.block} testID={`region-${blocked.status}`}>
              <AppText variant="title">
                {t(`region.${blocked.status}Title`)}
              </AppText>
              <AppText variant="body" tone="secondary">
                {t(`region.${blocked.status}Body`)}
              </AppText>
              <PrimaryButton
                label={t("region.retry")}
                onPress={retryRegion}
                testID="region-retry"
              />
              {blocked.status === "permissionDenied" && (
                <SecondaryButton
                  label={t("region.openSettings")}
                  onPress={blocked.openLocationSettings}
                  testID="region-open-settings"
                />
              )}
            </View>
          ) : (
            <View style={styles.block}>
              <AppText variant="title">{t("home.welcome")}</AppText>
              <AppText variant="body" tone="secondary">
                {t("home.subtitle")}
              </AppText>
              {region?.status === "resolved" && region.config ? (
                <StatusChip
                  tone="accent"
                  label={`${region.config.name} · ${region.config.currency}`}
                  testID="region-badge"
                  style={flipRows ? styles.chipRtl : styles.chipLtr}
                />
              ) : null}
              {region?.status === "loading" ? (
                <AppText
                  variant="secondary"
                  tone="muted"
                  testID="region-loading"
                >
                  {t("region.finding")}
                </AppText>
              ) : null}
            </View>
          )}
          {__DEV__ ? (
            <TextButton
              label={t("routePreview.open")}
              onPress={() => router.push("/dev-route-preview")}
              testID="open-route-preview"
            />
          ) : null}
          <ApiStatus />
        </BottomSheet>
      }
    />
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.md,
  },
  chipLtr: {
    alignSelf: "flex-start",
  },
  chipRtl: {
    alignSelf: "flex-end",
  },
});
