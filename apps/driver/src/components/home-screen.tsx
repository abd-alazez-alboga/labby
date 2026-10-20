import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ApiStatus } from "./api-status";
import {
  HeatmapSheetSection,
  HeatmapToggle,
} from "./heatmap/heatmap-sheet";
import {
  AvailabilityGoButton,
  AvailabilitySheet,
} from "./availability/availability-sheet";
import { OsmMap } from "./map/osm-map";
import { ScheduledEntry } from "./scheduled/scheduled-entry";
import { NotificationsBell } from "./notifications/notifications-bell";
import { BackgroundLocationBanner } from "./availability/background-location-banner";
import { RideNoticeBanner } from "./ride/ride-parts";
import { RideScreen } from "./ride/ride-screen";
import { SharedCollectScreen } from "./ride/shared-parts";
import { FloorBlockedCard, FloorWarningBanner } from "./money/floor";
import { TripEarningsScreen } from "./money/trip-earnings-screen";
import { RateRiderScreen, reportHrefFor } from "./trust/rate-rider-screen";
import { ratingKey } from "../api/trust-types";
import type { BridgeZone } from "../map/leaflet-bridge";
import { useOptionalHeatmap } from "../heatmap/HeatmapProvider";
import { mapZones } from "../heatmap/levels";
import { takeReturnRoute } from "../i18n/direction-reload";
import { useLocale } from "../i18n/LocaleProvider";
import { useOptionalDriverMoney } from "../money/DriverMoneyProvider";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";
import type { AvailabilityContextValue } from "../realtime/AvailabilityProvider";
import { useOptionalRegion } from "../region/RegionProvider";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";
import { useOptionalRatingPrompt } from "../trust/RatingPromptProvider";
import type { RegionContextValue } from "../region/RegionProvider";
import { colors, radius, spacing } from "../theme/tokens";
import {
  AppText,
  Banner,
  BottomSheet,
  MapFab,
  MapScreen,
  SecondaryButton,
  useDirection,
} from "./ui";

/** Floating FAB row height (48) + its offset below the status bar. */
const FAB_ROW = 48 + spacing.sm;

/**
 * The map layer: the driver's own position while online (follow-me), a
 * "waiting for GPS" note until the first fix, and the plain map ground
 * while offline (no position is read while offline).
 */
function HomeMap({
  ctx,
  bottom,
  zones,
}: {
  ctx: AvailabilityContextValue | null;
  bottom: number;
  /** M9-T2: the demand heatmap layer (empty while it is off). */
  zones: BridgeZone[];
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { flipRows } = useDirection();
  const online = ctx?.load.status === "loaded" && ctx.load.data.online;
  if (!ctx || !online || ctx.gps !== "granted") return null;

  const frame = [
    StyleSheet.absoluteFill,
    { bottom: Math.max(0, bottom - radius.sheet) },
  ];
  if (!ctx.position) {
    return (
      <View style={[frame, styles.waiting]} pointerEvents="none">
        <View
          style={[styles.waitingPill, flipRows && styles.rowReverse]}
          testID="waiting-for-gps"
        >
          <ActivityIndicator color={colors.accent} />
          <AppText variant="secondary" weight="600">
            {t("availability.waitingForGps")}
          </AppText>
        </View>
      </View>
    );
  }
  const position = { lat: ctx.position.lat, lng: ctx.position.lng };
  return (
    <View style={frame}>
      <OsmMap
        center={position}
        markers={[{ id: "self", kind: "self", position }]}
        zones={zones}
        followMe
        fill
        overlayTop={insets.top + FAB_ROW + spacing.sm}
        testID="own-position-map"
      />
    </View>
  );
}

/**
 * Region resolution (M4-T4) under the status title: region + currency and
 * its service types once resolved, "finding your area" while loading.
 */
function RegionLine({ region }: { region: RegionContextValue | null }) {
  const { t } = useTranslation();
  const { language } = useLocale();
  if (!region) return null;
  if (region.status === "resolved" && region.config) {
    const { config } = region;
    const services = config.serviceTypes
      .map((type) => (language === "ar" ? type.nameAr : type.nameEn))
      .join(language === "ar" ? "، " : ", ");
    return (
      <AppText variant="secondary" color={colors.textSecondary}>
        <AppText
          variant="secondary"
          color={colors.textSecondary}
          testID="region-badge"
        >
          {`${config.name} · ${config.currency}`}
        </AppText>
        {services ? ` · ${services}` : null}
      </AppText>
    );
  }
  if (region.status === "loading") {
    return (
      <AppText
        variant="secondary"
        color={colors.textMuted}
        testID="region-loading"
      >
        {t("region.finding")}
      </AppText>
    );
  }
  return null;
}

/** Outside the area, location denied or unresolved: the region's own state + retry. */
function RegionBlocked({ region }: { region: RegionContextValue }) {
  const { t } = useTranslation();
  return (
    <Banner
      tone={region.status === "outside" ? "neutral" : "warning"}
      icon={
        region.status === "permissionDenied" ? "location-outline" : undefined
      }
      title={t(`region.${region.status}Title`)}
      message={t(`region.${region.status}Body`)}
      testID={`region-${region.status}`}
    >
      <SecondaryButton
        title={t("region.retry")}
        icon="refresh"
        onPress={region.retry}
        testID="region-retry"
      />
      {region.status === "permissionDenied" ? (
        <SecondaryButton
          title={t("region.openSettings")}
          icon="settings-outline"
          onPress={region.openLocationSettings}
          testID="region-open-settings"
        />
      ) : null}
    </Banner>
  );
}

/**
 * Driver home (design canvas "Driver offline"): full-bleed map, the Menu
 * and notification FABs, the GO button and the status bottom sheet. While
 * an offer is open or a ride is active, the home route IS the ride flow
 * (map-first, design canvas "Driver offer" … "Driver complete").
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  // Back to the screen a direction-changing language switch reloaded from.
  useEffect(() => {
    void takeReturnRoute().then((route) => {
      if (route) router.push(route as never);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);
  const availability = useOptionalAvailability();
  // Null when rendered without the provider (provider-less unit tests).
  const region = useOptionalRegion();
  const { height: windowHeight } = useWindowDimensions();
  const [sheetHeight, setSheetHeight] = useState(0);
  const regionBlocked =
    region && region.status !== "resolved" && region.status !== "loading"
      ? region
      : null;
  const rides = useOptionalDriverRide();
  // M11: the post-trip rating prompt (after the earnings breakdown).
  const ratings = useOptionalRatingPrompt();
  // M8: balance floor state (COM-03) of the operating currency (W16) —
  // refreshed with the availability data. Blocked stops offers, not GO.
  const money = useOptionalDriverMoney();
  const floorBlocked = money?.floor === "blocked";
  // M9-T2 (DRV-09, UC-D-14): the demand heatmap while online, toggle on.
  const heat = useOptionalHeatmap();
  const { language, flipRows } = useLocale();
  const heatmap = heat?.heatmap ?? null;
  const zones = useMemo(
    () => (heatmap ? mapZones(t, heatmap.zones, language) : []),
    [t, heatmap, language],
  );

  if (rides && (rides.offer || rides.ride)) {
    return <RideScreen ctx={rides} />;
  }
  if (rides?.collected) {
    // W23: the settled shared ride's collection, Done unlocked.
    return (
      <SharedCollectScreen
        ctx={rides}
        ride={rides.collected}
        onDone={rides.dismissCollected}
      />
    );
  }
  if (rides?.settled) {
    // UC-D-15: the just-settled ride's earnings breakdown.
    return (
      <TripEarningsScreen ride={rides.settled} onDone={rides.dismissSettled} />
    );
  }
  if (ratings?.prompt) {
    // UC-S-17: rate the rider after the trip (skippable).
    const { target, payment } = ratings.prompt;
    return (
      <RateRiderScreen
        // M12 review H4: a fresh screen per prompt — the next member starts empty.
        key={ratingKey(target)}
        target={target}
        payment={payment}
        mode="prompt"
        onSkip={ratings.skip}
        onDone={ratings.finish}
        onReport={() => router.push(reportHrefFor(target))}
      />
    );
  }

  return (
    <MapScreen
      testID="home-screen"
      map={
        <HomeMap ctx={availability} bottom={sheetHeight} zones={zones} />
      }
      top={
        <>
          <MapFab
            icon="menu"
            accessibilityLabel={t("home.goToSettings")}
            onPress={() => router.push("/settings")}
            testID="settings-link"
          />
          <View style={[styles.fabGroup, flipRows && styles.rowReverse]}>
            <NotificationsBell />
            <HeatmapToggle ctx={heat} />
          </View>
        </>
      }
      bottom={
        <>
          <AvailabilityGoButton ctx={availability} />
          <View
            onLayout={(event) =>
              setSheetHeight(event.nativeEvent.layout.height)
            }
          >
            <BottomSheet
              maxHeight={Math.round(windowHeight * 0.62)}
              refreshControl={
                availability ? (
                  <RefreshControl
                    refreshing={false}
                    onRefresh={() => void availability.reload()}
                  />
                ) : undefined
              }
              testID="home-sheet"
            >
              {rides?.notice ? (
                <RideNoticeBanner
                  notice={rides.notice}
                  onDismiss={rides.dismissNotice}
                />
              ) : null}
              {/* COM-03: the blocked floor state is unmistakable (UC-D-16). */}
              {floorBlocked && money?.alert ? (
                <FloorBlockedCard
                  entry={money.alert}
                  onSeeBalance={() => router.push("/balance")}
                />
              ) : null}
              {money?.floor === "warning" && money.alert ? (
                <FloorWarningBanner entry={money.alert} />
              ) : null}
              <BackgroundLocationBanner />
              <AvailabilitySheet
                ctx={availability}
                regionLine={<RegionLine region={region} />}
                floorBlocked={floorBlocked}
              />
              {/* M12 (UC-D-11): claim board + claimed rides. */}
              <ScheduledEntry />
              {regionBlocked ? <RegionBlocked region={regionBlocked} /> : null}
              {heatmap ? (
                <HeatmapSheetSection
                  heatmap={heatmap}
                  regionName={
                    region?.status === "resolved" ? region.config?.name : null
                  }
                />
              ) : null}
              <ApiStatus />
            </BottomSheet>
          </View>
        </>
      }
    />
  );
}

const styles = StyleSheet.create({
  waiting: { alignItems: "center", justifyContent: "center" },
  waitingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.round,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.ms,
  },
  rowReverse: { flexDirection: "row-reverse" },
  fabGroup: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
});
