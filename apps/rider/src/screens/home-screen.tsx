import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import type { Ride } from "../api/rides";
import type { SharedRide } from "../api/scheduled-shared";
import { getMyOpenSharedRide, listScheduledRides } from "../api/scheduled-shared";
import { useOptionalAuth } from "../auth/auth-context";
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
import { useFocusRefresh } from "../hooks/use-focus-refresh";
import { takeReturnRoute } from "../i18n/direction-reload";
import { useLocale } from "../i18n/locale-context";
import { useCurrentPosition } from "../location/use-current-position";
import { useOptionalNotifications } from "../notifications/notifications-context";
import { UnreadBadge } from "../notifications/unread-badge";
import { useOptionalRegion } from "../region/region-context";
import { useOptionalActiveRide } from "../ride/ride-context";
import { placeLabel } from "../ride/ride-format";
import { formatScheduleDay } from "../ride/schedule-format";
import { useSavedPlaces } from "../ride/use-saved-places";
import { colors, radius, spacing } from "../theme/tokens";
import { useColdStartRatingPrompt } from "../trust/rating-prompts";
import { riderSuspension } from "../trust/suspension";
import { PositionMap } from "./home/position-map";
import { RideView } from "./ride/ride-view";
import { departureShort } from "./shared/shared-parts";
import { savedPlaceIcon } from "./ride/route-planner";
import SuspendedScreen from "./trust/suspended-screen";

/** Saved places listed under "Where to?" (approved artboard Main). */
const HOME_SAVED_PLACES = 3;

/** Open-shared-ride card frame (approved artboard RiderSharedHomeCard). */
const OPEN_SHARED_BORDER = "#D9BFEA";
const OPEN_SHARED_BG = "#FBF8FD";

/**
 * Rider home, map-first: the full-bleed map with the rider's own position
 * (M6-T4), floating Menu (settings) and notification buttons (with the
 * unread badge), and a bottom sheet with "Where to?" (approved artboard
 * Main: the destination search that opens booking and the saved places as
 * one-tap destinations) or the region state (M4-T4). While the ride facade
 * holds a ride, home IS the ride: the map + the sheet of its state (M7).
 *
 * M12 (approved artboard RiderM12Home): a "Later" pill in the search row
 * starts scheduling, the soonest upcoming scheduled ride (with the count)
 * opens the scheduled list, and "Shared rides" opens browsing.
 *
 * M11: while the rider role or the whole account is suspended, the
 * suspended screen replaces booking — but a ride already in flight keeps
 * showing (SOS + finishing the ride stay available, owner ruling
 * 2026-10-15). Unless the whole account is suspended, the first home of a
 * launch opens the rating prompt for the newest pending ride never
 * prompted (cold start, RATE-01).
 */
export default function HomeScreen() {
  const rides = useOptionalActiveRide();
  const auth = useOptionalAuth();
  const suspension = riderSuspension(
    auth?.user ?? null,
    auth?.suspensionSignal ?? null,
  );
  // Rating stays open to a role-only suspension; never to a suspended account.
  useColdStartRatingPrompt(
    !!rides && !rides.loading && !rides.ride && suspension?.scope !== "account",
  );
  if (rides?.ride) {
    return <RideView ride={rides.ride} onDone={() => {}} />;
  }
  if (suspension) {
    return <SuspendedScreen suspension={suspension} />;
  }
  return <WhereToHome />;
}

function WhereToHome() {
  const { t, locale } = useLocale();
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

  // M12: the upcoming scheduled rides (soonest first), re-read on focus.
  const [scheduled, setScheduled] = useState<Ride[]>([]);
  // W10 (approved artboard RiderSharedHomeCard): the rider's still-gathering
  // shared ride — its card replaces the browse entry below.
  const [openShared, setOpenShared] = useState<SharedRide | null>(null);
  const refreshScheduled = useCallback(() => {
    let cancelled = false;
    listScheduledRides()
      .then((list) => {
        if (!cancelled) setScheduled(list);
      })
      .catch(() => {});
    getMyOpenSharedRide()
      .then((ride) => {
        if (!cancelled) setOpenShared(ride);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useFocusRefresh(refreshScheduled);
  const next = scheduled.find((ride) => ride.scheduled) ?? null;

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
                <View style={styles.searchIcon}>
                  <Ionicons name="search" size={20} color={colors.text} />
                </View>
                <AppText
                  variant="rowTitle"
                  weight={600}
                  tone="muted"
                  style={styles.flex}
                >
                  {t("home.searchDestination")}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("scheduled.laterA11y")}
                  onPress={() => router.push("/schedule" as never)}
                  style={({ pressed }) => [
                    styles.later,
                    { flexDirection: row },
                    pressed && styles.pressed,
                  ]}
                  testID="home-later"
                >
                  <Ionicons name="time-outline" size={16} color={colors.text} />
                  <AppText variant="label" weight={800}>
                    {t("scheduled.later")}
                  </AppText>
                </Pressable>
              </Pressable>
              {next?.scheduled ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push("/scheduled" as never)}
                  style={({ pressed }) => [
                    styles.upcoming,
                    { flexDirection: row },
                    pressed && styles.pressed,
                  ]}
                  testID="home-upcoming"
                >
                  <View style={styles.upcomingIcon}>
                    <Ionicons
                      name="calendar-outline"
                      size={20}
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" weight={800}>
                      {formatScheduleDay(next.scheduled.scheduledAt, locale, t)}
                    </AppText>
                    <AppText variant="caption" weight={400} tone="secondary">
                      {t("scheduled.homeSubtitle", {
                        place: placeLabel(next.destination),
                        status:
                          next.scheduled.claimState === "claimed"
                            ? t("scheduled.claimed")
                            : t("scheduled.open"),
                      })}
                    </AppText>
                  </View>
                  <AppText
                    variant="caption"
                    weight={800}
                    tone="accent"
                    testID="home-upcoming-count"
                  >
                    {t("scheduled.homeCount", { count: scheduled.length })}
                  </AppText>
                </Pressable>
              ) : null}
              {openShared ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    router.push(
                      `/shared/${encodeURIComponent(openShared.rideId)}` as never,
                    )
                  }
                  style={({ pressed }) => [
                    styles.openShared,
                    { flexDirection: row },
                    pressed && styles.pressed,
                  ]}
                  testID="home-open-shared"
                >
                  <View style={styles.upcomingIcon}>
                    <Ionicons
                      name="people-outline"
                      size={20}
                      color={colors.accent}
                    />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodyStrong" weight={800}>
                      {t("shared.openTitle")}
                    </AppText>
                    <AppText variant="caption" weight={400} tone="secondary">
                      {t("shared.openSubtitle", {
                        place: placeLabel(openShared.destination),
                        taken: openShared.seatsTaken,
                        total: openShared.totalSeats,
                        departure: departureShort(
                          openShared.departure,
                          locale,
                          t,
                        ),
                      })}
                    </AppText>
                  </View>
                  <AppText variant="caption" weight={800} tone="accent">
                    {t("shared.openStatus")}
                  </AppText>
                </Pressable>
              ) : (
                <ListRow
                  icon="people-outline"
                  title={t("shared.homeTitle")}
                  subtitle={t("shared.homeSubtitle")}
                  chevron
                  last
                  onPress={() => router.push("/shared" as never)}
                  testID="home-shared"
                />
              )}
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
    // Symmetric so the Later pill sits right in both row directions.
    paddingHorizontal: spacing.sm,
  },
  pressed: {
    opacity: 0.7,
  },
  flex: {
    flex: 1,
  },
  searchIcon: {
    width: 32,
    alignItems: "center",
  },
  later: {
    alignItems: "center",
    gap: 6,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 24,
    backgroundColor: colors.surface,
  },
  upcoming: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.line,
  },
  openShared: {
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: OPEN_SHARED_BORDER,
    backgroundColor: OPEN_SHARED_BG,
  },
  upcomingIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  chipLtr: {
    alignSelf: "flex-start",
  },
  chipRtl: {
    alignSelf: "flex-end",
  },
});
