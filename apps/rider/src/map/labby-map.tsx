/**
 * Reusable OSM-tile map (M6-T4, ES-04): the base the M7 booking screen
 * builds on. Renders a Leaflet page in a WebView (see map-bridge.ts for why)
 * with the tile URL template from runtime config, the provider attribution
 * always visible, and explicit loading / tiles-unreachable / failed states
 * (NFR-A3 — a dead tile server degrades, it never crashes the screen).
 *
 * Props
 * - `center`    where the map looks; with `followMe` every change re-centres
 *               the map, without it only the first one does (the user pans).
 * - `markers`   points to draw (`self` = the rider's own position).
 * - `route`     optional GeoJSON LineString straight from the routing API —
 *               converted to map points in geo.ts only.
 * - `routeApproximate` draws the route dashed (straight-line estimate).
 * - `onCenterChange` pin picking: called with the map centre after every
 *               pan/zoom (the page reports it only while this is set).
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";

import { getAppConfig } from "../config/app-config";
import { useLocale } from "../i18n/locale-context";
import { AppText, SecondaryButton } from "../components/ui";
import { colors, radius, spacing } from "../theme/tokens";
import {
  type GeoJsonLineString,
  type LatLng,
  lineStringToLatLngs,
} from "./geo";
import {
  buildApplyScript,
  buildMapHtml,
  buildRelayoutScript,
  type MapMarker,
  parseMapEvent,
  toMapViewState,
} from "./map-bridge";

export const DEFAULT_MAP_ZOOM = 15;

export interface LabbyMapProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  route?: GeoJsonLineString | null;
  routeApproximate?: boolean;
  followMe?: boolean;
  onCenterChange?: (center: LatLng) => void;
  /** Distance of the tiles-unavailable notice from the top (clears floating buttons). */
  noticeTop?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type PageState = "loading" | "ready" | "failed";

const NO_MARKERS: MapMarker[] = [];

export function LabbyMap({
  center,
  zoom = DEFAULT_MAP_ZOOM,
  markers = NO_MARKERS,
  route = null,
  routeApproximate = false,
  followMe = false,
  onCenterChange,
  noticeTop = spacing.sm,
  style,
  testID = "labby-map",
}: LabbyMapProps) {
  const { t, flipRows } = useLocale();
  const webView = useRef<WebView>(null);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [tilesOk, setTilesOk] = useState(true);
  /** Bumped by "try again" to remount the WebView (fresh page load). */
  const [reloadKey, setReloadKey] = useState(0);

  const routePoints = useMemo(() => lineStringToLatLngs(route), [route]);
  const reportCenter = !!onCenterChange;
  const centerListener = useRef(onCenterChange);
  useEffect(() => {
    centerListener.current = onCenterChange;
  }, [onCenterChange]);
  const state = useMemo(
    () =>
      toMapViewState({
        center,
        zoom,
        followMe,
        markers,
        route: routePoints,
        routeApproximate,
        reportCenter,
      }),
    // center is compared by value so a re-created object with the same
    // coordinates does not re-apply the page state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      center.lat,
      center.lng,
      zoom,
      followMe,
      markers,
      routePoints,
      routeApproximate,
      reportCenter,
    ],
  );
  // The page is built from the first state only; every later state (and the
  // current one after a reload) is injected once the page reports ready, so
  // the map never reloads and never loses the user's pan/zoom.
  const [initialState] = useState(state);
  const config = getAppConfig();
  const html = useMemo(
    () =>
      buildMapHtml({
        tileUrlTemplate: config.mapTileUrlTemplate,
        initialState,
      }),
    [config.mapTileUrlTemplate, initialState],
  );

  useEffect(() => {
    if (pageState === "ready") {
      webView.current?.injectJavaScript(buildApplyScript(state));
    }
  }, [state, pageState]);

  // L-W3: the page lays out before the WebView has its final size. Once it
  // is ready, and on every container resize, it re-measures and re-frames
  // the route and markers.
  const [size, setSize] = useState<string | null>(null);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize(`${Math.round(width)}x${Math.round(height)}`);
  }, []);
  useEffect(() => {
    if (pageState === "ready") {
      webView.current?.injectJavaScript(buildRelayoutScript());
    }
  }, [size, pageState]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseMapEvent(event.nativeEvent.data);
    if (!message) return;
    if (message.type === "ready") setPageState("ready");
    else if (message.type === "tiles") setTilesOk(message.ok);
    else if (message.type === "center")
      centerListener.current?.({ lat: message.lat, lng: message.lng });
    else setPageState("failed");
  }, []);

  const reload = useCallback(() => {
    setPageState("loading");
    setTilesOk(true);
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <View style={[styles.container, style]} testID={testID} onLayout={onLayout}>
      {pageState === "failed" ? (
        <View style={styles.failed} testID={`${testID}-failed`}>
          <AppText variant="bodyStrong" align="center">
            {t("map.failedTitle")}
          </AppText>
          <AppText variant="secondary" tone="secondary" align="center">
            {t("map.failedBody")}
          </AppText>
          <SecondaryButton
            label={t("map.retry")}
            onPress={reload}
            testID={`${testID}-retry`}
          />
        </View>
      ) : (
        <WebView
          key={reloadKey}
          ref={webView}
          testID={`${testID}-webview`}
          style={styles.webView}
          originWhitelist={["*"]}
          // OSM's tile usage policy requires a Referer for browser-based
          // clients; an inline page has none, so it is given the backend's
          // origin as its base URL.
          source={{ html, baseUrl: `${config.apiBaseUrl}/` }}
          onMessage={onMessage}
          onError={() => setPageState("failed")}
          javaScriptEnabled
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          accessibilityLabel={t("map.accessibilityLabel")}
        />
      )}

      {pageState === "loading" ? (
        <View
          style={styles.loading}
          pointerEvents="none"
          testID={`${testID}-loading`}
        >
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}

      {pageState === "ready" && !tilesOk ? (
        <View
          style={[styles.notice, { top: noticeTop }]}
          pointerEvents="none"
          testID={`${testID}-tiles-unavailable`}
        >
          <AppText variant="caption" tone="secondary" align="center">
            {t("map.tilesUnavailable")}
          </AppText>
        </View>
      ) : null}

      {pageState !== "failed" ? (
        <View
          style={[styles.attribution, flipRows && styles.attributionRtl]}
          pointerEvents="none"
          testID={`${testID}-attribution`}
        >
          <AppText
            variant="caption"
            weight={400}
            tone="secondary"
            style={styles.attributionText}
          >
            {config.mapTileAttribution}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: "hidden",
    backgroundColor: colors.surfaceMap,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.surfaceMap,
  },
  loading: {
    position: "absolute",
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    position: "absolute",
    start: spacing.sm,
    end: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    opacity: 0.95,
  },
  attribution: {
    position: "absolute",
    bottom: 0,
    end: 0,
    backgroundColor: "rgba(255,255,255,0.8)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderTopStartRadius: radius.sm,
  },
  attributionRtl: {
    end: undefined,
    start: 0,
    borderTopStartRadius: 0,
    borderTopEndRadius: radius.sm,
  },
  attributionText: {
    fontSize: 11,
    textAlign: undefined,
  },
  failed: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xxl,
    gap: spacing.sm,
  },
});
