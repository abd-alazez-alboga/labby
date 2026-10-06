/**
 * Home map panel: the rider's own position on the OSM map (M6-T4), with an
 * explicit state for every way it can fail to show it. The M7 booking
 * screen builds on the same LabbyMap.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '../../components/form';
import { useLocale } from '../../i18n/locale-context';
import type { CurrentPosition } from '../../location/use-current-position';
import { LabbyMap } from '../../map/labby-map';
import type { MapMarker } from '../../map/map-bridge';
import { colors, fontSize, spacing } from '../../theme/tokens';

export function PositionMap({
  current,
  showPermissionActions,
}: {
  current: CurrentPosition;
  /** False when the screen already explains the denied permission elsewhere. */
  showPermissionActions: boolean;
}) {
  const { t, isRTL } = useLocale();
  const { status, position } = current;

  const markers = useMemo<MapMarker[]>(
    () => (position ? [{ id: 'self', kind: 'self', position }] : []),
    [position],
  );

  if (position && status === 'ready') {
    return (
      <LabbyMap
        center={position}
        markers={markers}
        followMe
        style={styles.fill}
        testID="home-map"
      />
    );
  }

  if (status === 'locating') {
    return (
      <View style={[styles.fill, styles.placeholder]} testID="map-locating">
        <ActivityIndicator color={colors.purple700} />
        <Text style={[styles.body, isRTL && styles.textRtl]}>{t('map.locating')}</Text>
      </View>
    );
  }

  const denied = status === 'permissionDenied';
  return (
    <View
      style={[styles.fill, styles.placeholder]}
      testID={denied ? 'map-permission-denied' : 'map-unavailable'}
    >
      <Ionicons
        name={denied ? 'location-outline' : 'navigate-circle-outline'}
        size={36}
        color={colors.textSubtle}
      />
      <Text style={[styles.title, isRTL && styles.textRtl]}>
        {t(denied ? 'map.permissionDeniedTitle' : 'map.unavailableTitle')}
      </Text>
      <Text style={[styles.body, isRTL && styles.textRtl]}>
        {t(denied ? 'map.permissionDeniedBody' : 'map.unavailableBody')}
      </Text>
      {!denied || showPermissionActions ? (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            label={t('map.retry')}
            onPress={current.retry}
            testID="map-retry"
          />
          {denied ? (
            <Button
              variant="link"
              label={t('region.openSettings')}
              onPress={current.openLocationSettings}
              testID="map-open-settings"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
    backgroundColor: colors.bgTint,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.md,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
  textRtl: {
    writingDirection: 'rtl',
  },
  actions: {
    marginTop: spacing.xs,
    alignItems: 'center',
    gap: spacing.xs,
  },
});
