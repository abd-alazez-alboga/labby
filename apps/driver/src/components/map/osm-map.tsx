import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';

import { getConfig } from '../../config';
import { useLocale } from '../../i18n/LocaleProvider';
import { lineStringToLatLngs, toLeafletLatLng } from '../../map/geojson';
import type { GeoJsonLineString, LatLng } from '../../map/geojson';
import {
  applyStateScript,
  buildMapPage,
  parseMapMessage,
  RECENTER_SCRIPT,
} from '../../map/leaflet-bridge';
import type { MapMarkerKind, MapViewState } from '../../map/leaflet-bridge';
import { colors, radius, spacing } from '../../theme/tokens';

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
  /** Keep the `self` marker centered as it moves (until the user pans). */
  followMe?: boolean;
  height?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** No `ready` from the page within this → treat the map as unavailable. */
export const MAP_READY_TIMEOUT_MS = 15000;
const DEFAULT_ZOOM = 16;

type Phase = 'loading' | 'ready' | 'failed';

function toViewState(props: OsmMapProps): MapViewState {
  return {
    center: toLeafletLatLng(props.center),
    zoom: props.zoom ?? DEFAULT_ZOOM,
    markers: (props.markers ?? []).map((marker) => ({
      id: marker.id,
      kind: marker.kind ?? 'point',
      position: toLeafletLatLng(marker.position),
    })),
    route: props.route ? lineStringToLatLngs(props.route) : null,
    followMe: !!props.followMe,
  };
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
  const { direction } = useLocale();
  const webViewRef = useRef<WebView>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [tilesDown, setTilesDown] = useState(false);
  const [followPaused, setFollowPaused] = useState(false);
  /** Bumped by "retry" to remount the WebView with a fresh page. */
  const [attempt, setAttempt] = useState(0);

  const viewState = toViewState(props);
  const viewStateJson = JSON.stringify(viewState);
  const latestState = useRef(viewState);
  latestState.current = viewState;

  // The page is built once per attempt; later prop changes go through the
  // bridge (a new `source` would reload the WebView and lose the map).
  const html = useMemo(() => {
    const config = getConfig();
    return buildMapPage(
      {
        tileUrl: config.mapTileUrl,
        attribution: config.mapAttribution,
        rtl: direction === 'rtl',
        colors: {
          self: colors.purple700,
          selfBorder: colors.white,
          point: colors.purple400,
          route: colors.purple500,
          background: colors.lavender100,
        },
      },
      latestState.current,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt per attempt/direction only
  }, [attempt, direction]);

  useEffect(() => {
    if (phase !== 'loading') return undefined;
    const timer = setTimeout(() => setPhase('failed'), MAP_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phase, attempt]);

  useEffect(() => {
    if (phase === 'ready') {
      webViewRef.current?.injectJavaScript(applyStateScript(latestState.current));
    }
  }, [phase, viewStateJson]);

  useEffect(() => {
    if (!props.followMe) setFollowPaused(false);
  }, [props.followMe]);

  const onMessage = useCallback((event: WebViewMessageEvent) => {
    const message = parseMapMessage(event.nativeEvent.data);
    if (!message) return;
    switch (message.type) {
      case 'ready':
        setPhase('ready');
        break;
      case 'loadFailed':
        setPhase('failed');
        break;
      case 'tiles':
        setTilesDown(!message.ok);
        break;
      case 'followPaused':
        setFollowPaused(true);
        break;
    }
  }, []);

  const retry = useCallback(() => {
    setPhase('loading');
    setTilesDown(false);
    setFollowPaused(false);
    setAttempt((value) => value + 1);
  }, []);

  const recenter = useCallback(() => {
    setFollowPaused(false);
    webViewRef.current?.injectJavaScript(RECENTER_SCRIPT);
  }, []);

  const height = props.height ?? 240;
  const testID = props.testID ?? 'osm-map';
  const selfMarker = props.markers?.find((marker) => marker.kind === 'self');
  const textAlign = direction === 'rtl' ? 'right' : 'left';

  if (phase === 'failed') {
    return (
      <View
        style={[styles.frame, styles.fallback, { height }, props.style]}
        testID={`${testID}-unavailable`}
      >
        <Ionicons name="map-outline" size={28} color={colors.textMuted} />
        <Text style={styles.fallbackTitle}>{t('map.unavailableTitle')}</Text>
        <Text style={styles.fallbackBody}>
          {selfMarker
            ? t('map.yourPosition', { position: formatPoint(selfMarker.position) })
            : t('map.unavailableBody')}
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={retry}
          style={styles.fallbackButton}
          testID={`${testID}-retry`}
        >
          <Text style={styles.fallbackButtonLabel}>{t('map.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.frame, { height }, props.style]} testID={testID}>
      <WebView
        key={attempt}
        ref={webViewRef}
        testID={`${testID}-webview`}
        originWhitelist={['*']}
        source={{ html }}
        onMessage={onMessage}
        onError={() => setPhase('failed')}
        // Never navigate the map page away; open real links outside.
        onShouldStartLoadWithRequest={(request) => {
          if (request.url.startsWith('about:') || request.url.startsWith('data:')) {
            return true;
          }
          if (request.isTopFrame === false) return true;
          Linking.openURL(request.url).catch(() => {});
          return false;
        }}
        setSupportMultipleWindows={false}
        scrollEnabled={false}
        style={styles.webview}
      />
      {phase === 'loading' ? (
        <View style={styles.overlay} testID={`${testID}-loading`}>
          <ActivityIndicator color={colors.purple700} />
        </View>
      ) : null}
      {tilesDown ? (
        <View style={styles.tilesBanner} testID={`${testID}-tiles-down`}>
          <Text style={[styles.tilesBannerText, { textAlign }]}>
            {t('map.tilesUnavailable')}
          </Text>
        </View>
      ) : null}
      {followPaused && props.followMe ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('map.recenter')}
          onPress={recenter}
          style={[styles.recenter, direction === 'rtl' ? styles.recenterRtl : null]}
          testID={`${testID}-recenter`}
        >
          <Ionicons name="locate" size={24} color={colors.purple700} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.lavender100,
  },
  webview: { flex: 1, backgroundColor: colors.lavender100 },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.lavender100,
  },
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  fallbackTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  fallbackBody: { color: colors.textSecondary, fontSize: 14, textAlign: 'center' },
  fallbackButton: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.purple700,
    backgroundColor: colors.white,
  },
  fallbackButtonLabel: { color: colors.purple700, fontSize: 15, fontWeight: '600' },
  tilesBanner: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
    backgroundColor: colors.warningBg,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  tilesBannerText: { color: colors.warning, fontSize: 13, fontWeight: '600' },
  recenter: {
    position: 'absolute',
    bottom: spacing.lg,
    right: spacing.sm,
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.lilac200,
  },
  recenterRtl: { right: undefined, left: spacing.sm },
});
