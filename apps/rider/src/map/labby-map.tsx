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
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { getAppConfig } from '../config/app-config';
import { useLocale } from '../i18n/locale-context';
import { colors, fontSize, radius, spacing } from '../theme/tokens';
import { type GeoJsonLineString, type LatLng, lineStringToLatLngs } from './geo';
import {
  buildApplyScript,
  buildMapHtml,
  type MapMarker,
  parseMapEvent,
  toMapViewState,
} from './map-bridge';

export const DEFAULT_MAP_ZOOM = 15;

export interface LabbyMapProps {
  center: LatLng;
  zoom?: number;
  markers?: MapMarker[];
  route?: GeoJsonLineString | null;
  routeApproximate?: boolean;
  followMe?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

type PageState = 'loading' | 'ready' | 'failed';

const NO_MARKERS: MapMarker[] = [];

export function LabbyMap({
  center,
  zoom = DEFAULT_MAP_ZOOM,
  markers = NO_MARKERS,
  route = null,
  routeApproximate = false,
  followMe = false,
  style,
  testID = 'labby-map',
}: LabbyMapProps) {
  const { t, isRTL, flipRows } = useLocale();
  const webView = useRef<WebView>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [tilesOk, setTilesOk] = useState(true);
  /** Bumped by "try again" to remount the WebView (fresh page load). */
  const [reloadKey, setReloadKey] = useState(0);

  const routePoints = useMemo(() => lineStringToLatLngs(route), [route]);
  const state = useMemo(
    () =>
      toMapViewState({ center, zoom, followMe, markers, route: routePoints, routeApproximate }),
    // center is compared by value so a re-created object with the same
    // coordinates does not re-apply the page state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [center.lat, center.lng, zoom, followMe, markers, routePoints, routeApproximate],
  );
  // The page is built from the first state only; every later state (and the
  // current one after a reload) is injected once the page reports ready, so
  // the map never reloads and never loses the user's pan/zoom.
  const [initialState] = useState(state);
  const config = getAppConfig();
  const html = useMemo(
    () => buildMapHtml({ tileUrlTemplate: config.mapTileUrlTemplate, initialState }),
    [config.mapTileUrlTemplate, initialState],
  );

  useEffect(() => {
    if (pageState === 'ready') {
      webView.current?.injectJavaScript(buildApplyScript(state));
    }
  }, [state, pageState]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseMapEvent(event.nativeEvent.data);
    if (!message) return;
    if (message.type === 'ready') setPageState('ready');
    else if (message.type === 'tiles') setTilesOk(message.ok);
    else setPageState('failed');
  }, []);

  const reload = useCallback(() => {
    setPageState('loading');
    setTilesOk(true);
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <View style={[styles.container, style]} testID={testID}>
      {pageState === 'failed' ? (
        <View style={styles.failed} testID={`${testID}-failed`}>
          <Text style={[styles.failedTitle, isRTL && styles.textRtl]}>{t('map.failedTitle')}</Text>
          <Text style={[styles.failedBody, isRTL && styles.textRtl]}>{t('map.failedBody')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={reload}
            style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
            testID={`${testID}-retry`}
          >
            <Text style={styles.retryLabel}>{t('map.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <WebView
          key={reloadKey}
          ref={webView}
          testID={`${testID}-webview`}
          style={styles.webView}
          originWhitelist={['*']}
          // OSM's tile usage policy requires a Referer for browser-based
          // clients; an inline page has none, so it is given the backend's
          // origin as its base URL.
          source={{ html, baseUrl: `${config.apiBaseUrl}/` }}
          onMessage={onMessage}
          onError={() => setPageState('failed')}
          javaScriptEnabled
          scrollEnabled={false}
          setSupportMultipleWindows={false}
          accessibilityLabel={t('map.accessibilityLabel')}
        />
      )}

      {pageState === 'loading' ? (
        <View style={styles.loading} pointerEvents="none" testID={`${testID}-loading`}>
          <ActivityIndicator color={colors.purple700} />
        </View>
      ) : null}

      {pageState === 'ready' && !tilesOk ? (
        <View
          style={styles.notice}
          pointerEvents="none"
          testID={`${testID}-tiles-unavailable`}
        >
          <Text style={[styles.noticeText, isRTL && styles.textRtl]}>{t('map.tilesUnavailable')}</Text>
        </View>
      ) : null}

      {pageState !== 'failed' ? (
        <View
          style={[styles.attribution, flipRows && styles.attributionRtl]}
          pointerEvents="none"
          testID={`${testID}-attribution`}
        >
          <Text style={styles.attributionText}>{config.mapTileAttribution}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
    backgroundColor: colors.bgTint,
  },
  webView: {
    flex: 1,
    backgroundColor: colors.bgTint,
  },
  loading: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    position: 'absolute',
    top: spacing.sm,
    start: spacing.sm,
    end: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    opacity: 0.95,
  },
  noticeText: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  attribution: {
    position: 'absolute',
    bottom: 0,
    end: 0,
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: spacing.xs + 2,
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
    color: colors.textSecondary,
    fontSize: 11,
  },
  failed: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  failedTitle: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  failedBody: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  textRtl: {
    writingDirection: 'rtl',
  },
  retry: {
    marginTop: spacing.xs,
    backgroundColor: colors.purple700,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  retryPressed: {
    backgroundColor: colors.purple500,
  },
  retryLabel: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
});
