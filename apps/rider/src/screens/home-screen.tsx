import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ApiStatus } from "../components/api-status";
import {
  AppText,
  BottomSheet,
  ListRow,
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
import { useOptionalActiveRide } from "../ride/ride-context";
import { placeLabel } from "../ride/ride-format";
import { useSavedPlaces } from "../ride/use-saved-places";
import { colors, radius, spacing } from "../theme/tokens";
import { PositionMap } from "./home/position-map";
import { RideView } from "./ride/ride-view";
import { savedPlaceIcon } from "./ride/route-planner";

/** Saved places listed under "Where to?" (approved artboard Main). */
const HOME_SAVED_PLACES = 3;

/**
 * Rider home, map-first: the full-bleed map with the rider's own position
 * (M6-T4), floating Menu (settings) and notification buttons (with the
 * unread badge), and a bottom sheet with "Where to?" (approved artboard
 * Main: the destination search that opens booking and the saved places as
 * one-tap destinations) or the region state (M4-T4). While the ride facade
 * holds a ride, home IS the ride: the map + the sheet of its state (M7).
 */
export default function HomeScreen() {
  const rides = useOptionalActiveRide();
  if (rides?.ride) {
    return <RideView ride={rides.ride} onDone={() => {}} />;
  }
  return <WhereToHome />;
}

function WhereToHome() {
  const { t } = useLocale();
  const { flipRows, row } = useDirection();
  const router = useRouter();
  const saved = useSavedPlaces();

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
              <AppText variant="title">{t("home.whereTo")}</AppText>
              <Pressable
                accessibilityRole="search"
                accessibilityLabel={t("home.searchDestination")}
                onPress={() => router.push("/booking")}
                style={({ pressed }) => [
                  styles.search,
                  { flexDirection: row },
                  pressed && styles.pressed,
                ]}
                testID="home-where-to"
              >
                <Ionicons name="search" size={20} color={colors.text} />
                <AppText variant="rowTitle" weight={600} tone="muted">
                  {t("home.searchDestination")}
                </AppText>
              </Pressable>
              {saved.places.length > 0 ? (
                <View>
                  {saved.places.slice(0, HOME_SAVED_PLACES).map((place, i, list) => (
                    <ListRow
                      key={place.id}
                      icon={savedPlaceIcon(place.name)}
                      title={place.name}
                      subtitle={place.address ?? placeLabel(place)}
                      last={i === list.length - 1}
                      onPress={() =>
                        router.push(
                          `/booking?destinationId=${encodeURIComponent(place.id)}` as never,
                        )
                      }
                      testID={`home-saved-${place.id}`}
                    />
                  ))}
                </View>
              ) : null}
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
  search: {
    alignItems: "center",
    gap: spacing.md,
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceFill,
    paddingHorizontal: spacing.lg,
  },
  pressed: {
    opacity: 0.7,
  },
  chipLtr: {
    alignSelf: "flex-start",
  },
  chipRtl: {
    alignSelf: "flex-end",
  },
});
