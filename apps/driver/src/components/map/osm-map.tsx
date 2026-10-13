import { Ionicons } from "@expo/vector-icons";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";

import { getConfig } from "../../config";
import { useLocale } from "../../i18n/LocaleProvider";
import { lineStringToLatLngs, toLeafletLatLng } from "../../map/geojson";
import type { GeoJsonLineString, LatLng } from "../../map/geojson";
import {
  applyStateScript,
  buildMapPage,
  parseMapMessage,
  RECENTER_SCRIPT,
} from "../../map/leaflet-bridge";
import type {
  BridgeZone,
  BridgeZoneStyle,
  MapMarkerKind,
  MapViewState,
} from "../../map/leaflet-bridge";
import { HEAT_TIER_STYLES, HEAT_TIERS } from "../../heatmap/levels";
import { colors, radius, shadows, spacing } from "../../theme/tokens";
import { AppText } from "../ui";

export interface MapMarker {
  id: string;
  /** `self` = the driver's own position (the follow-me target). */
  kind?: MapMarkerKind;
  position: LatLng;
}

export interface OsmMapProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  /** Contract GeoJSON LineString ([lng, lat]) — e.g. a routing result. */
  route?: GeoJsonLineString | null;
  /** Demand-heatmap zones (M9-T2), already resolved by `heatmapZones`. */
  zones?: BridgeZone[];
  /** Keep the `self` marker centered as it moves (until the user pans). */
  followMe?: boolean;
  height?: number;
  /** Fill the parent (full-bleed map screens) instead of a fixed-height card. */
  fill?: boolean;
  /** Keeps in-map banners clear of floating controls laid over the map. */
  overlayTop?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** No `ready` from the page within this → treat the map as unavailable. */
export const MAP_READY_TIMEOUT_MS = 15000;
const DEFAULT_ZOOM = 16;

type Phase = "loading" | "ready" | "failed";

function toViewState(props: OsmMapProps): MapViewState {
  return {
    center: toLeafletLatLng(props.center),
    zoom: props.zoom ?? DEFAULT_ZOOM,
    markers: (props.markers ?? []).map((marker) => ({
      id: marker.id,
      kind: marker.kind ?? "point",
      position: toLeafletLatLng(marker.position),
    })),
    route: props.route ? lineStringToLatLngs(props.route) : null,
    followMe: !!props.followMe,
    zones: props.zones ?? [],
  };
}

/** The heatmap tier looks for the page (one table: heatmap/levels.ts). */
function zoneStyles(): Record<string, BridgeZoneStyle> {
  const styles: Record<string, BridgeZoneStyle> = {};
  for (const tier of HEAT_TIERS) {
    const look = HEAT_TIER_STYLES[tier];
    styles[String(tier)] = {
      fill: colors.accent,
      fillOpacity: look.fillOpacity,
      stroke: colors.accent,
      strokeOpacity: look.strokeOpacity,
      dashed: look.dashed,
      chipBackground: look.chipBackground,
      chipText: look.chipText,
    };
  }
  return styles;
}

function formatPoint(point: LatLng): string {
  return `${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`;
}

/**
 * Reusable OSM-tile map (ES-04): Leaflet inside a WebView, tile URL +
 * attribution from runtime config. Props changes are pushed through the
 * bridge without reloading the page. Graceful states (NFR-A3): a spinner
 * until the page is ready, a fallback card with the coordinates when the
 * map can't load at all, and a banner when tiles fail while the markers
 * keep working.
 */
export function OsmMap(props: OsmMapProps) {
  const { t } = useTranslation();
  const { direction, flipRows } = useLocale();
  const webViewRef = useRef<WebView>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [tilesDown, setTilesDown] = useState(false);
  const [followPaused, setFollowPaused] = useState(false);
  /** Bumped by "retry" to remount the WebView with a fresh page. */
  const [attempt, setAttempt] = useState(0);

  const viewState = toViewState(props);
  const viewStateJson = JSON.stringify(viewState);
  const latestState = useRef(viewState);
  latestState.current = viewState;

  const pageBaseUrl = useMemo(() => `${getConfig().apiBaseUrl}/`, []);

  // The page is built once per attempt; later prop changes go through the
  // bridge (a new `source` would reload the WebView and lose the map).
  const html = useMemo(() => {
    const config = getConfig();
    return buildMapPage(
      {
        tileUrl: config.mapTileUrl,
        attribution: config.mapAttribution,
        rtl: direction === "rtl",
        colors: {
          self: colors.accent,
          selfBorder: colors.surface,
          point: colors.text,
          route: colors.accent,
          background: colors.surfaceMap,
        },
        zoneStyles: zoneStyles(),
      },
      latestState.current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt per attempt/direction only
  }, [attempt, direction]);

  useEffect(() => {
    if (phase !== "loading") return undefined;
    const timer = setTimeout(() => setPhase("failed"), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, attempt]);

  useEffect(() => {
    if (phase === "ready") {
      webViewRef.current?.injectJavaScript(
        applyStateScript(latestState.current),
      );
    }
  }, [phase, viewStateJson]);

  useEffect(() => {
    if (!props.followMe) setFollowPaused(false);
  }, [props.followMe]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseMapMessage(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case "ready":
        setPhase("ready");
        break;
      case "loadFailed":
        setPhase("failed");
        break;
      case "tiles":
        setTilesDown(!message.ok);
        break;
      case "followPaused":
        setFollowPaused(true);
        break;
    }
  }, []);

  const retry = useCallback(() => {
    setPhase("loading");
    setTilesDown(false);
    setFollowPaused(false);
    setAttempt((value) => value + 1);
  }, []);

  const recenter = useCallback(() => {
    setFollowPaused(false);
    webViewRef.current?.injectJavaScript(RECENTER_SCRIPT);
  }, []);

  const size: ViewStyle = props.fill
    ? styles.fill
    : { height: props.height ?? 240 };
  const testID = props.testID ?? "osm-map";
  const selfMarker = props.markers?.find((marker) => marker.kind === "self");
  const textAlign = flipRows ? "right" : "left";

  if (phase === "failed") {
    return (
      <View
        style={[styles.frame, size, styles.fallback, props.style]}
        testID={`${testID}-unavailable`}
      >
        <Ionicons name="map-outline" size={28} color={colors.textMuted} />
        <AppText variant="bodyStrong" align="center">
          {t("map.unavailableTitle")}
        </AppText>
        <AppText
          variant="secondary"
          color={colors.textSecondary}
          align="center"
        >
          {selfMarker
            ? t("map.yourPosition", {
                position: formatPoint(selfMarker.position),
              })
            : t("map.unavailableBody")}
        </AppText>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={styles.fallbackButton}
          testID={`${testID}-retry`}
        >
          <AppText variant="bodyStrong" align="center">
            {t("map.retry")}
          </AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.frame, size, props.style]} testID={testID}>
      <WebView
        key={attempt}
        ref={webViewRef}
        testID={`${testID}-webview`}
        originWhitelist={["*"]}
        // OSM's tile usage policy requires a Referer from browser-based
        // clients; an inline page has none, so it gets the backend's origin
        // as its base URL (same choice as the rider map, M6-T4).
        source={{ html, baseUrl: pageBaseUrl }}
        onMessage={onMessage}
        onError={() => setPhase("failed")}
        // Never navigate the map page away; open real links outside.
        onShouldStartLoadWithRequest={(request) => {
          if (
            request.url.startsWith("about:") ||
            request.url.startsWith("data:")
          ) {
            return true;
          }
          // iOS reports loading the inline page itself as a navigation to its base URL.
          if (request.url === pageBaseUrl) return true;
          if (request.isTopFrame === false) return true;
          Linking.openURL(request.url).catch(() => {});
          return false;
        }}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        style={styles.webview}
      />
      {phase === "loading" ? (
        <View style={styles.overlay} testID={`${testID}-loading`}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      {tilesDown ? (
        <View
          style={[
            styles.tilesBanner,
            props.overlayTop !== undefined && { top: props.overlayTop },
          ]}
          testID={`${testID}-tiles-down`}
        >
          <AppText variant="caption" color={colors.warning} align={textAlign}>
            {t("map.tilesUnavailable")}
          </AppText>
        </View>
      ) : null}
      {followPaused && props.followMe ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("map.recenter")}
          onPress={recenter}
          style={[styles.recenter, flipRows ? styles.recenterRtl : null]}
          testID={`${testID}-recenter`}
        >
          <Ionicons name="locate" size={22} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: "stretch",
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceMap,
  },
  fill: { flex: 1, borderRadius: 0 },
  webview: { flex: 1, backgroundColor: colors.surfaceMap },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceMap,
  },
  fallback: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    padding: spacing.md,
  },
  fallbackButton: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  tilesBanner: {
    position: "absolute",
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  recenter: {
    position: "absolute",
    bottom: spacing.lg,
    right: spacing.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    ...shadows.floating,
  },
  recenterRtl: { right: undefined, left: spacing.md },
});
