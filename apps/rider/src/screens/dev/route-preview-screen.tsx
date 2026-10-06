/**
 * DEV-ONLY route preview (M6-T4): proves the routing contract end-to-end —
 * two points → `POST /api/v1/routing/route` → polyline + distance/duration,
 * with the "approximate" label when the backend fell back to a straight
 * line (NFR-A3). Reachable only in __DEV__ builds (the home entry and the
 * route both check it); it is NOT the M7 booking UI.
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { failureKind } from '../../api/http-client';
import { getRoute, type Route } from '../../api/routing';
import { Button, ErrorBanner, FormField } from '../../components/form';
import { useLocale } from '../../i18n/locale-context';
import { isValidLatLng, type LatLng } from '../../map/geo';
import { LabbyMap } from '../../map/labby-map';
import type { MapMarker } from '../../map/map-bridge';
import { colors, fontSize, radius, spacing } from '../../theme/tokens';

/** Demo points in Damascus (the launch region's seed data). */
const DEFAULT_ORIGIN = '33.5138, 36.2765';
const DEFAULT_DESTINATION = '33.5132, 36.3159';

/** "lat, lng" → point, or null when malformed / out of range. */
export function parseLatLngInput(input: string): LatLng | null {
  const parts = input.split(',').map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part === '')) return null;
  const point = { lat: Number(parts[0]), lng: Number(parts[1]) };
  return isValidLatLng(point) ? point : null;
}

type Result =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; messageKey: string }
  | { kind: 'ready'; route: Route; origin: LatLng; destination: LatLng };

export default function RoutePreviewScreen() {
  const { t, isRTL } = useLocale();
  const [originText, setOriginText] = useState(DEFAULT_ORIGIN);
  const [destinationText, setDestinationText] = useState(DEFAULT_DESTINATION);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ kind: 'idle' });

  const submit = async () => {
    const origin = parseLatLngInput(originText);
    const destination = parseLatLngInput(destinationText);
    if (!origin || !destination) {
      setInputError(t('routePreview.invalidPoint'));
      return;
    }
    setInputError(null);
    setResult({ kind: 'loading' });
    try {
      const route = await getRoute([origin, destination]);
      setResult({ kind: 'ready', route, origin, destination });
    } catch (error) {
      setResult({
        kind: 'error',
        messageKey:
          failureKind(error) === 'network' ? 'common.networkErrorBody' : 'routePreview.failed',
      });
    }
  };

  const markers: MapMarker[] =
    result.kind === 'ready'
      ? [
          { id: 'origin', kind: 'origin', position: result.origin },
          { id: 'destination', kind: 'destination', position: result.destination },
        ]
      : [];

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.container}
      testID="route-preview-screen"
    >
      <Text style={[styles.devNote, isRTL && styles.textRtl]}>{t('routePreview.devNote')}</Text>
      <FormField
        label={t('routePreview.origin')}
        value={originText}
        onChangeText={setOriginText}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        testID="route-origin"
      />
      <FormField
        label={t('routePreview.destination')}
        value={destinationText}
        onChangeText={setDestinationText}
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        error={inputError}
        testID="route-destination"
      />
      <Button
        label={t('routePreview.submit')}
        onPress={() => void submit()}
        loading={result.kind === 'loading'}
        testID="route-submit"
      />

      {result.kind === 'error' ? (
        <ErrorBanner message={t(result.messageKey)} testID="route-error" />
      ) : null}

      {result.kind === 'ready' ? (
        <View style={styles.result} testID="route-result">
          <View style={styles.stats}>
            <Text style={[styles.stat, isRTL && styles.textRtl]} testID="route-distance">
              {t('routePreview.distance', {
                km: (result.route.distanceMeters / 1000).toFixed(1),
              })}
            </Text>
            <Text style={[styles.stat, isRTL && styles.textRtl]} testID="route-duration">
              {t('routePreview.duration', {
                minutes: Math.max(1, Math.round(result.route.durationSeconds / 60)),
              })}
            </Text>
            {result.route.approximate ? (
              <Text style={[styles.approximate, isRTL && styles.textRtl]} testID="route-approximate">
                {t('routePreview.approximate')}
              </Text>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: colors.bgLight,
  },
  container: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  devNote: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  textRtl: {
    writingDirection: 'rtl',
    textAlign: 'right',
  },
  result: {
    gap: spacing.sm,
  },
  stats: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
  },
  stat: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '600',
  },
  approximate: {
    color: '#B26A00',
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  map: {
    height: 320,
    borderRadius: radius.md,
  },
});
