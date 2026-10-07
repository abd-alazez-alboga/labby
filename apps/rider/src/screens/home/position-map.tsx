/**
 * Home map panel: the rider's own position on the OSM map (M6-T4), with an
 * explicit state for every way it can fail to show it. The M7 booking
 * screen builds on the same LabbyMap.
 */
import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText, SecondaryButton, TextButton } from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import type { CurrentPosition } from "../../location/use-current-position";
import { LabbyMap } from "../../map/labby-map";
import type { MapMarker } from "../../map/map-bridge";
import { colors, radius, spacing } from "../../theme/tokens";

export function PositionMap({
  current,
  showPermissionActions,
}: {
  current: CurrentPosition;
  /** False when the screen already explains the denied permission elsewhere. */
  showPermissionActions: boolean;
}) {
  const { t } = useLocale();
  // Placeholder copy clears the status bar and the floating buttons above it.
  const { top } = useSafeAreaInsets();
  const placeholderTop = { paddingTop: top + FLOATING_CLEARANCE };
  const { status, position } = current;

  const markers = useMemo<MapMarker[]>(
    () => (position ? [{ id: "self", kind: "self", position }] : []),
    [position],
  );

  if (position && status === "ready") {
    return (
      <LabbyMap
        center={position}
        markers={markers}
        followMe
        noticeTop={top + FLOATING_CLEARANCE}
        style={styles.fill}
        testID="home-map"
      />
    );
  }

  if (status === "locating") {
    return (
      <View
        style={[styles.fill, styles.placeholder, placeholderTop]}
        testID="map-locating"
      >
        <ActivityIndicator color={colors.accent} />
        <AppText variant="secondary" tone="secondary" align="center">
          {t("map.locating")}
        </AppText>
      </View>
    );
  }

  const denied = status === "permissionDenied";
  return (
    <View
      style={[styles.fill, styles.placeholder, placeholderTop]}
      testID={denied ? "map-permission-denied" : "map-unavailable"}
    >
      <View style={styles.iconWell}>
        <Ionicons
          name={denied ? "location-outline" : "navigate-circle-outline"}
          size={28}
          color={colors.text}
        />
      </View>
      <AppText variant="bodyStrong" align="center">
        {t(denied ? "map.permissionDeniedTitle" : "map.unavailableTitle")}
      </AppText>
      <AppText variant="secondary" tone="secondary" align="center">
        {t(denied ? "map.permissionDeniedBody" : "map.unavailableBody")}
      </AppText>
      {!denied || showPermissionActions ? (
        <View style={styles.actions}>
          <SecondaryButton
            label={t("map.retry")}
            onPress={current.retry}
            testID="map-retry"
          />
          {denied ? (
            <TextButton
              label={t("region.openSettings")}
              onPress={current.openLocationSettings}
              testID="map-open-settings"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Floating-button row (8 px offset + 48 px button) plus breathing room. */
const FLOATING_CLEARANCE = 72;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  placeholder: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.xxxl,
    paddingBottom: spacing.lg,
    backgroundColor: colors.surfaceMap,
  },
  iconWell: {
    width: 56,
    height: 56,
    borderRadius: radius.round,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  actions: {
    marginTop: spacing.sm,
    alignSelf: "stretch",
    gap: spacing.xs,
  },
});
