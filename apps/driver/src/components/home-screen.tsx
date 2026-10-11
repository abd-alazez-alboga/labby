import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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
  AvailabilityGoButton,
  AvailabilitySheet,
} from "./availability/availability-sheet";
import { OsmMap } from "./map/osm-map";
import { NotificationsBell } from "./notifications/notifications-bell";
import { BackgroundLocationBanner } from "./availability/background-location-banner";
import { RideNoticeBanner } from "./ride/ride-parts";
import { RideScreen } from "./ride/ride-screen";
import { takeReturnRoute } from "../i18n/direction-reload";
import { useLocale } from "../i18n/LocaleProvider";
import { useOptionalAvailability } from "../realtime/AvailabilityProvider";
import type { AvailabilityContextValue } from "../realtime/AvailabilityProvider";
import { useOptionalRegion } from "../region/RegionProvider";
import { useOptionalDriverRide } from "../rides/DriverRideProvider";
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
}: {
  ctx: AvailabilityContextValue | null;
  bottom: number;
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

  if (rides && (rides.offer || rides.ride)) {
    return <RideScreen ctx={rides} />;
  }

  return (
    <MapScreen
      testID="home-screen"
      map={<HomeMap ctx={availability} bottom={sheetHeight} />}
      top={
        <>
          <MapFab
            icon="menu"
            accessibilityLabel={t("home.goToSettings")}
            onPress={() => router.push("/settings")}
            testID="settings-link"
          />
          <NotificationsBell />
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
              <BackgroundLocationBanner />
              <AvailabilitySheet
                ctx={availability}
                regionLine={<RegionLine region={region} />}
              />
              {regionBlocked ? <RegionBlocked region={regionBlocked} /> : null}
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
});
