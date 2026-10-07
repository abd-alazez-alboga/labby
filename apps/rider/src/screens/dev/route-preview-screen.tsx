/**
 * DEV-ONLY route preview (M6-T4): proves the routing contract end-to-end —
 * two points → `POST /api/v1/routing/route` → polyline + distance/duration,
 * with the "approximate" label when the backend fell back to a straight
 * line (NFR-A3). Reachable only in __DEV__ builds (the home entry and the
 * route both check it); it is NOT the M7 booking UI.
 */
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";

import { failureKind } from "../../api/http-client";
import { getRoute, type Route } from "../../api/routing";
import {
  AppText,
  Banner,
  PrimaryButton,
  ScreenScrollView,
  screenStyles,
  StatusChip,
  TextField,
  useDirection,
} from "../../components/ui";
import { useLocale } from "../../i18n/locale-context";
import { isValidLatLng, type LatLng } from "../../map/geo";
import { LabbyMap } from "../../map/labby-map";
import type { MapMarker } from "../../map/map-bridge";
import { colors, radius, spacing } from "../../theme/tokens";

/** Demo points in Damascus (the launch region's seed data). */
const DEFAULT_ORIGIN = "33.5138, 36.2765";
const DEFAULT_DESTINATION = "33.5132, 36.3159";

/** "lat, lng" → point, or null when malformed / out of range. */
export function parseLatLngInput(input: string): LatLng | null {
  const parts = input.split(",").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === "")) return null;
  const point = { lat: Number(parts[0]), lng: Number(parts[1]) };
  return isValidLatLng(point) ? point : null;
}

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; messageKey: string }
  | { kind: "ready"; route: Route; origin: LatLng; destination: LatLng };

export default function RoutePreviewScreen() {
  const { t } = useLocale();
  const { flipRows } = useDirection();
  const [originText, setOriginText] = useState(DEFAULT_ORIGIN);
  const [destinationText, setDestinationText] = useState(DEFAULT_DESTINATION);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  const submit = async () => {
    const origin = parseLatLngInput(originText);
    const destination = parseLatLngInput(destinationText);
    if (!origin || !destination) {
      setInputError(t("routePreview.invalidPoint"));
      return;
    }
    setInputError(null);
    setResult({ kind: "loading" });
    try {
      const route = await getRoute([origin, destination]);
      setResult({ kind: "ready", route, origin, destination });
    } catch (error) {
      setResult({
        kind: "error",
        messageKey:
          failureKind(error) === "network"
            ? "common.networkErrorBody"
            : "routePreview.failed",
      });
    }
  };

  const markers: MapMarker[] =
    result.kind === "ready"
      ? [
          { id: "origin", kind: "origin", position: result.origin },
          {
            id: "destination",
            kind: "destination",
            position: result.destination,
          },
        ]
      : [];

  return (
    <ScreenScrollView
      style={screenStyles.page}
      contentContainerStyle={screenStyles.content}
      testID="route-preview-screen"
    >
      <Banner tone="neutral" message={t("routePreview.devNote")} />
      <TextField
        label={t("routePreview.origin")}
        value={originText}
        onChangeText={setOriginText}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        testID="route-origin"
      />
      <TextField
        label={t("routePreview.destination")}
        value={destinationText}
        onChangeText={setDestinationText}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        error={inputError}
        testID="route-destination"
      />
      <PrimaryButton
        label={t("routePreview.submit")}
        onPress={() => void submit()}
        loading={result.kind === "loading"}
        testID="route-submit"
      />

      {result.kind === "error" ? (
        <Banner
          tone="danger"
          message={t(result.messageKey)}
          testID="route-error"
        />
      ) : null}

      {result.kind === "ready" ? (
        <View style={styles.result} testID="route-result">
          <View style={styles.stats}>
            <AppText variant="rowTitle" testID="route-distance">
              {t("routePreview.distance", {
                km: (result.route.distanceMeters / 1000).toFixed(1),
              })}
            </AppText>
            <AppText variant="body" tone="secondary" testID="route-duration">
              {t("routePreview.duration", {
                minutes: Math.max(
                  1,
                  Math.round(result.route.durationSeconds / 60),
                ),
              })}
            </AppText>
            {result.route.approximate ? (
              <StatusChip
                tone="warning"
                label={t("routePreview.approximate")}
                testID="route-approximate"
                style={flipRows ? styles.chipRtl : styles.chipLtr}
              />
            ) : null}
          </View>
          <LabbyMap
            center={result.origin}
            markers={markers}
            route={result.route.geometry}
            routeApproximate={result.route.approximate}
            style={styles.map}
            testID="route-map"
          />
        </View>
      ) : null}
    </ScreenScrollView>
  );
}

const styles = StyleSheet.create({
  result: {
    gap: spacing.md,
  },
  stats: {
    backgroundColor: colors.surfaceFill,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  chipLtr: {
    alignSelf: "flex-start",
    marginTop: spacing.xs,
  },
  chipRtl: {
    alignSelf: "flex-end",
    marginTop: spacing.xs,
  },
  map: {
    height: 320,
    borderRadius: radius.lg,
  },
});
